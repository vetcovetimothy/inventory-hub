export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── Daily discontinued-items cache ──────────────────────────────────────────
// Runs every morning (~6 AM ET). For each vendor, pulls its discontinued GI and
// the shared supersession map, assigns a permanent discontinue date to any newly-
// seen item (shared KV with the hub tab and the weekly Slack cron), and caches
// each vendor's mapped rows + the supersession map to KV. The Discontinued tab
// reads these caches for an instant load; its Refresh button still does a live pull.
//
// Discontinued lists are small (hundreds of rows/vendor), so each fits in one KV
// value — no chunking needed.
//
// KV layout:
//   disc-cache-<type>  -> { rows: [...], cachedAt }   (type = disc-fuze, etc.)
//   disc-cache-super   -> { map: {oldId: {newId,newDesc}}, cachedAt }
//   discontinued-dates -> shared date map (same key the tab + weekly cron use)
//
// Required env: ACUMATICA_CRON_USERNAME/PASSWORD, KV_REST_API_URL/TOKEN,
// SITE_URL (optional), CRON_SECRET (optional).

const SITE_URL = process.env.SITE_URL || "https://inventory-hub-two.vercel.app";
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const VENDOR_TYPES = ["disc-fuze", "disc-ggm", "disc-cgp", "disc-ct"];
const DATES_KEY = "discontinued-dates";
const SUPER_KEY = "disc-cache-super";
const CACHE_PREFIX = "disc-cache-";

async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  const resp = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` }, cache: "no-store" });
  if (!resp.ok) return null;
  const j = await resp.json();
  if (!j || j.result == null) return null;
  try { return JSON.parse(j.result); } catch { return j.result; }
}
async function kvSet(key, value) {
  if (!KV_URL || !KV_TOKEN) return false;
  const resp = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  return resp.ok;
}

async function pullGI(type, user, pass) {
  const resp = await fetch(SITE_URL + "/api/acumatica", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, username: user, password: pass }), cache: "no-store" });
  const j = await resp.json();
  if (!resp.ok) throw new Error(j.error || "GI fetch failed for " + type);
  return j.data || [];
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization") || "";
    if (auth !== "Bearer " + secret) return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!KV_URL || !KV_TOKEN) return Response.json({ error: "Missing KV env vars" }, { status: 500 });
  const user = process.env.ACUMATICA_CRON_USERNAME, pass = process.env.ACUMATICA_CRON_PASSWORD;
  if (!user || !pass) return Response.json({ error: "Missing ACUMATICA_CRON_USERNAME / ACUMATICA_CRON_PASSWORD" }, { status: 500 });

  const cachedAt = new Date().toISOString();
  const results = [];

  // Supersession map (shared across vendors).
  let superMap = {};
  try {
    const sRows = await pullGI("supersessions", user, pass);
    sRows.forEach(function (r) {
      const oldId = String(r.OldItem || "").trim();
      if (oldId) superMap[oldId] = { newId: String(r.NewItemID || "").trim(), newDesc: String(r.NewItemDesc || "").trim() };
    });
    await kvSet(SUPER_KEY, { map: superMap, cachedAt });
  } catch (e) {
    return Response.json({ ok: false, stage: "supersessions", error: String(e.message || e) }, { status: 502 });
  }

  // Shared discontinue-date map — add dates for newly-seen items (never overwrite).
  const dates = (await kvGet(DATES_KEY)) || {};
  let datesChanged = false;

  for (const type of VENDOR_TYPES) {
    const vResult = { type, rows: 0, newDates: 0, errors: [] };
    try {
      const raw = await pullGI(type, user, pass);
      const rows = raw.map(function (r) {
        return {
          inventoryId: String(r.InventoryID || "").trim(),
          ndc: String(r.NDC || "").trim(),
          description: String(r.Description || "").trim(),
          itemStatus: String(r.ItemStatus || "").trim(),
          abcCode: String(r.ABCCode || "").trim(),
          baseUOM: String(r.BaseUOM || "").trim(),
        };
      }).filter(function (r) { return r.inventoryId; });

      rows.forEach(function (r) {
        const key = type + "||" + r.inventoryId;
        if (!dates[key]) { dates[key] = todayISO(); datesChanged = true; vResult.newDates++; }
      });

      const ok = await kvSet(CACHE_PREFIX + type, { rows, cachedAt });
      if (!ok) vResult.errors.push("cache write failed (possibly over size limit)");
      vResult.rows = rows.length;
    } catch (e) {
      vResult.errors.push(String(e.message || e));
    }
    results.push(vResult);
  }

  if (datesChanged) await kvSet(DATES_KEY, dates);

  return Response.json({ ok: true, cachedAt, results });
}
