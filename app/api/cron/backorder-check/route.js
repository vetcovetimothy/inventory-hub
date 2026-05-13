/**
 * GET /api/cron/backorder-check
 *
 * Daily cron job that:
 *  1. Fetches INV - Backorder Item Review + Open PO Lines from Acumatica
 *  2. Computes resolved set (in backorder, not in open POs, excl. Bloodworth + Long-Term)
 *  3. Diffs against yesterday's snapshot in KV to find NEW items
 *  4. Posts a Slack message to #procurement-chat if any new items exist
 *  5. Saves today's snapshot for tomorrow's diff
 *
 * Triggered by Vercel Cron (see vercel.json). Protected by CRON_SECRET bearer token.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const PREFIX = process.env.ACUMATICA_ODATA_PREFIX || "/odata/VetCove";
const SITE_URL = process.env.SITE_URL || "https://inventory-hub-two.vercel.app";
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const SNAPSHOT_KEY = "backorder-resolver-cron-snapshot";

async function fetchGI(endpoint, username, password) {
  const url = `${BASE}${PREFIX}/${endpoint}`;
  const auth = Buffer.from(`${username}:${password}`).toString("base64");
  const resp = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`Acumatica ${endpoint} failed: ${resp.status}`);
  const json = await resp.json();
  return json.value || [];
}

async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  const resp = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(["GET", key]),
  });
  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json.result) return null;
  try { return JSON.parse(json.result); } catch { return null; }
}

async function kvSet(key, value) {
  if (!KV_URL || !KV_TOKEN) return;
  await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(["SET", key, JSON.stringify(value)]),
  });
}

async function postSlack(webhookUrl, payload) {
  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Slack post failed: ${resp.status} ${text}`);
  }
}

function buildSlackMessage(newItems, totalResolved, link) {
  // Group items by vendor
  const byVendor = {};
  newItems.forEach((r) => {
    const v = r.VendorName || "Unknown Vendor";
    if (!byVendor[v]) byVendor[v] = [];
    byVendor[v].push(r);
  });
  // Order vendors by item count (most first)
  const vendors = Object.keys(byVendor).sort((a, b) => byVendor[b].length - byVendor[a].length);

  // Across all vendors, cap total items displayed to keep message readable
  const ITEM_LIMIT = 30;
  let itemsShown = 0;
  let vendorsShown = 0;
  const vendorBlocks = [];
  for (const v of vendors) {
    if (itemsShown >= ITEM_LIMIT) break;
    const items = byVendor[v];
    const remainingCap = ITEM_LIMIT - itemsShown;
    const toShow = items.slice(0, remainingCap);
    const itemLines = toShow.map((r) => {
      const id = r.InventoryID || "(no ID)";
      const desc = (r.Description || "").substring(0, 70);
      return `   • \`${id}\` — ${desc}`;
    });
    const extra = items.length > toShow.length ? `\n   _…and ${items.length - toShow.length} more from this vendor_` : "";
    const text = `*${v}* — ${items.length} item${items.length === 1 ? "" : "s"}\n${itemLines.join("\n")}${extra}`;
    vendorBlocks.push({ type: "section", text: { type: "mrkdwn", text } });
    itemsShown += toShow.length;
    vendorsShown++;
  }
  const overflowVendors = vendors.length - vendorsShown;
  const overflowText = overflowVendors > 0 ? `\n_…and ${overflowVendors} more vendor${overflowVendors === 1 ? "" : "s"} not shown_` : "";

  const headerText = newItems.length === 1
    ? "*1 new resolved backorder*"
    : `*${newItems.length} new resolved backorders*`;

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "🔓 Backorder Resolver Update", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${headerText} since yesterday — ${totalResolved} total currently resolved (no open PO).`,
      },
    },
    { type: "divider" },
    ...vendorBlocks,
  ];
  if (overflowText) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: overflowText } });
  }
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Open Backorder Resolver", emoji: true },
        url: link,
        style: "primary",
      },
    ],
  });

  const payload = {
    username: "Backorder Resolver",
    text: `${headerText} — ${totalResolved} total currently resolved`,
    blocks,
  };
  const iconUrl = process.env.SLACK_BOT_ICON_URL;
  if (iconUrl) payload.icon_url = iconUrl;
  else payload.icon_emoji = ":parrot:";
  return payload;
}

export async function GET(request) {
  // Vercel cron sends Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization") || "";
    if (auth !== `Bearer ${cronSecret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const username = process.env.ACUMATICA_CRON_USERNAME;
  const password = process.env.ACUMATICA_CRON_PASSWORD;
  const slackUrl = process.env.SLACK_BACKORDER_WEBHOOK_URL;

  if (!username || !password) {
    return Response.json({ error: "Missing ACUMATICA_CRON_USERNAME/PASSWORD" }, { status: 500 });
  }
  if (!slackUrl) {
    return Response.json({ error: "Missing SLACK_BACKORDER_WEBHOOK_URL" }, { status: 500 });
  }

  try {
    // Fetch both GIs in parallel
    const [bo, pos] = await Promise.all([
      fetchGI("INV%20-%20Backorder%20Item%20Review", username, password),
      fetchGI("Open%20PO%20Lines", username, password),
    ]);

    // Build set of Inventory IDs with outstanding open POs
    const openIds = new Set();
    pos.forEach((p) => {
      const id = String(p.InventoryID || "").trim();
      const open = (parseFloat(p.OrderQty) || 0) - (parseFloat(p.QtyOnReceipts) || 0);
      if (id && open > 0) openIds.add(id);
    });

    // Compute resolved set (same filters as the in-app tool)
    const resolved = bo.filter((r) => {
      const id = String(r.InventoryID || "").trim();
      const vendor = String(r.VendorName || "").trim();
      const mc = String(r.MovementClass || "").trim();
      return (
        id &&
        !openIds.has(id) &&
        vendor !== "Bloodworth Wholesale Drugs" &&
        mc !== "Long-Term Backorder"
      );
    });
    const resolvedIds = new Set(resolved.map((r) => String(r.InventoryID).trim()));

    // Diff against yesterday's snapshot
    const snapshot = await kvGet(SNAPSHOT_KEY);
    const prevIds = new Set((snapshot && snapshot.ids) || []);
    const newItems = resolved.filter((r) => !prevIds.has(String(r.InventoryID).trim()));

    // Save today's snapshot regardless of whether we send a message
    // (Skip snapshot save when forcing — keeps tomorrow's diff accurate during tests)
    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";
    if (!force) {
      await kvSet(SNAPSHOT_KEY, {
        ids: Array.from(resolvedIds),
        savedAt: Date.now(),
      });
    }

    // Only send Slack if there are new items (or force=1 was passed)
    const itemsToSend = force ? resolved : newItems;
    if (itemsToSend.length === 0) {
      return Response.json({
        ok: true,
        totalResolved: resolved.length,
        newItems: 0,
        sentSlack: false,
      });
    }

    const link = `${SITE_URL}/?page=backorder-resolver`;
    const payload = buildSlackMessage(itemsToSend, resolved.length, link);
    await postSlack(slackUrl, payload);

    return Response.json({
      ok: true,
      totalResolved: resolved.length,
      newItems: itemsToSend.length,
      sentSlack: true,
      forced: force,
    });
  } catch (err) {
    return Response.json({ error: err.message || "Cron failed" }, { status: 500 });
  }
}
