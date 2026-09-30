import crypto from "crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── Weekly discontinued-items job ───────────────────────────────────────────
// Every Friday: for each vendor, pull its discontinued/supersession GI, assign a
// permanent discontinue date to any newly-seen item (shared KV with the hub tab),
// append genuinely-new items to that vendor's OWN Google Sheet (running log), and
// if any new items appeared, post to that vendor's OWN Slack channel with a link
// to that vendor's sheet. Vendors only ever see their own sheet/channel.
//
// Required env vars (per vendor: sheet id + webhook), plus shared creds:
//   ACUMATICA_CRON_USERNAME / ACUMATICA_CRON_PASSWORD
//   GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY  (service account, share each sheet with it)
//   KV_REST_API_URL / KV_REST_API_TOKEN
//   DISC_SHEET_FUZE / DISC_SHEET_GGM / DISC_SHEET_CGP / DISC_SHEET_CT   (spreadsheet IDs)
//   DISC_SLACK_FUZE / DISC_SLACK_GGM / DISC_SLACK_CGP / DISC_SLACK_CT   (incoming webhook URLs)
//   SITE_URL (optional; defaults to the prod URL)

const SITE_URL = process.env.SITE_URL || "https://inventory-hub-two.vercel.app";
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const SHEET_TAB = "Discontinued Items"; // the tab name inside each vendor sheet
const SHEET_HEADER = ["Inventory ID", "NDC", "Description", "Discontinued Date", "Replaced By"];

// One entry per vendor. type = GI endpoint; sheetEnv/slackEnv = env var names.
const VENDORS = [
  { key: "fuze", label: "Fuze",                 type: "disc-fuze", sheetEnv: "DISC_SHEET_FUZE", slackEnv: "DISC_SLACK_FUZE" },
  { key: "ggm",  label: "GogoMeds",             type: "disc-ggm",  sheetEnv: "DISC_SHEET_GGM",  slackEnv: "DISC_SLACK_GGM" },
  { key: "cgp",  label: "Central Garden & Pet", type: "disc-cgp",  sheetEnv: "DISC_SHEET_CGP",  slackEnv: "DISC_SLACK_CGP" },
  { key: "ct",   label: "Caretria",             type: "disc-ct",   sheetEnv: "DISC_SHEET_CT",   slackEnv: "DISC_SLACK_CT" },
];

// KV keys — dates key is SHARED with the hub tab so both agree on discontinue dates.
const DATES_KEY = "discontinued-dates";        // { "disc-<vendor>||<invId>": "YYYY-MM-DD" }
const SHEETED_KEY = "discontinued-sheeted";    // { "<vendorKey>||<invId>": true } — already appended

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  const resp = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` }, cache: "no-store" });
  if (!resp.ok) return null;
  const j = await resp.json();
  if (!j || j.result == null) return null;
  try { return JSON.parse(j.result); } catch { return j.result; }
}
async function kvSet(key, value) {
  if (!KV_URL || !KV_TOKEN) return;
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

async function getServiceAccountToken() {
  const email = process.env.GOOGLE_SA_EMAIL || "";
  const rawKey = process.env.GOOGLE_SA_PRIVATE_KEY || "";
  if (!email || !rawKey) throw new Error("Missing GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY");
  const pem = rawKey.indexOf("-----BEGIN") >= 0 ? rawKey.replace(/\\n/g, "\n") : Buffer.from(rawKey, "base64").toString("utf8");
  const privKey = crypto.createPrivateKey({ key: pem });
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signingInput = header + "." + claim;
  const assertion = signingInput + "." + b64url(crypto.sign("RSA-SHA256", Buffer.from(signingInput), privKey));
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!resp.ok) throw new Error("SA token exchange failed: " + (await resp.text()));
  const j = await resp.json();
  return j.access_token;
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
function fmtDate(iso) { if (!iso) return ""; const p = String(iso).split("-"); return p.length === 3 ? (p[1] + "/" + p[2] + "/" + p[0]) : iso; }

// Ensure the sheet's tab exists and has a header row; returns nothing (throws on hard error).
async function ensureSheetHeader(token, sheetId) {
  const base = "https://sheets.googleapis.com/v4/spreadsheets/" + sheetId;
  // Read row 1 of the target tab.
  const readUrl = base + "/values/" + encodeURIComponent(SHEET_TAB + "!A1:E1");
  const rr = await fetch(readUrl, { headers: { Authorization: "Bearer " + token }, cache: "no-store" });
  if (rr.ok) {
    const rd = await rr.json();
    const row = (rd.values && rd.values[0]) || [];
    if (row.length) return; // header already present
    // Tab exists but empty → write header.
    await fetch(base + "/values/" + encodeURIComponent(SHEET_TAB + "!A1") + "?valueInputOption=RAW", {
      method: "PUT", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [SHEET_HEADER] }),
    });
    return;
  }
  // Tab may not exist → create it, then header.
  await fetch(base + ":batchUpdate", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEET_TAB } } }] }),
  }).catch(function () {});
  await fetch(base + "/values/" + encodeURIComponent(SHEET_TAB + "!A1") + "?valueInputOption=RAW", {
    method: "PUT", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [SHEET_HEADER] }),
  });
}

async function appendRows(token, sheetId, rows) {
  if (!rows.length) return;
  const base = "https://sheets.googleapis.com/v4/spreadsheets/" + sheetId;
  const url = base + "/values/" + encodeURIComponent(SHEET_TAB + "!A1") + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS";
  const resp = await fetch(url, {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows }),
  });
  if (!resp.ok) throw new Error("Sheet append failed: " + resp.status + " " + (await resp.text()));
}

async function postSlack(webhookUrl, text) {
  const resp = await fetch(webhookUrl, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!resp.ok) throw new Error("Slack post failed: " + resp.status + " " + (await resp.text()));
}

function sheetLink(sheetId) { return "https://docs.google.com/spreadsheets/d/" + sheetId + "/edit"; }

function buildMessage(vendorLabel, newItems, link) {
  const lines = newItems.map(function (it) {
    const rep = it.replacedBy ? (" \u2192 replaced by " + it.replacedBy) : "";
    return "\u2022 " + it.inventoryId + " \u2014 " + (it.description || "") + rep;
  });
  const header = newItems.length === 1
    ? ("1 item was discontinued this week for " + vendorLabel + ":")
    : (newItems.length + " items were discontinued this week for " + vendorLabel + ":");
  return header + "\n\n" + lines.join("\n") + "\n\nFull list: " + link;
}

export async function GET(request) {
  // Optional auth: if CRON_SECRET is set, require it (Vercel Cron sends it as a Bearer).
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization") || "";
    if (auth !== "Bearer " + secret) return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = process.env.ACUMATICA_CRON_USERNAME, pass = process.env.ACUMATICA_CRON_PASSWORD;
  if (!user || !pass) return Response.json({ error: "Missing ACUMATICA_CRON_USERNAME / ACUMATICA_CRON_PASSWORD" }, { status: 500 });

  const results = [];
  let saToken = null;

  // Shared discontinue-date map (same key as the hub tab) and the sheeted tracker.
  const dates = (await kvGet(DATES_KEY)) || {};
  const sheeted = (await kvGet(SHEETED_KEY)) || {};
  let datesChanged = false, sheetedChanged = false;

  // Build the supersession map once (shared across vendors).
  let superMap = {};
  try {
    const sRows = await pullGI("supersessions", user, pass);
    sRows.forEach(function (r) {
      const oldId = String(r.OldItem || "").trim();
      if (oldId) superMap[oldId] = { newId: String(r.NewItemID || "").trim(), newDesc: String(r.NewItemDesc || "").trim() };
    });
  } catch (e) { /* supersession lookup is best-effort; proceed without it */ }

  for (const v of VENDORS) {
    const sheetId = process.env[v.sheetEnv];
    const webhook = process.env[v.slackEnv];
    const vResult = { vendor: v.label, newItems: 0, appended: 0, slack: "n/a", errors: [] };

    if (!sheetId) { vResult.errors.push("missing " + v.sheetEnv); results.push(vResult); continue; }

    try {
      const rows = await pullGI(v.type, user, pass);
      const items = rows.map(function (r) {
        return {
          inventoryId: String(r.InventoryID || "").trim(),
          ndc: String(r.NDC || "").trim(),
          description: String(r.Description || "").trim(),
        };
      }).filter(function (r) { return r.inventoryId; });

      // Assign permanent discontinue dates to newly-seen items (shared with hub tab).
      const dateVend = v.type; // matches the tab's "disc-<vendor>" prefix
      items.forEach(function (it) {
        const dKey = dateVend + "||" + it.inventoryId;
        if (!dates[dKey]) { dates[dKey] = todayISO(); datesChanged = true; }
      });

      // Determine which items are NEW to the sheet (never appended before).
      const newItems = [];
      items.forEach(function (it) {
        const sKey = v.key + "||" + it.inventoryId;
        if (!sheeted[sKey]) {
          const sup = superMap[it.inventoryId];
          const replacedBy = sup && sup.newId ? (sup.newId + (sup.newDesc ? " (" + sup.newDesc + ")" : "")) : "";
          newItems.push(Object.assign({}, it, { discDate: dates[dateVend + "||" + it.inventoryId], replacedBy }));
        }
      });
      vResult.newItems = newItems.length;

      if (newItems.length) {
        if (!saToken) saToken = await getServiceAccountToken();
        await ensureSheetHeader(saToken, sheetId);
        const sheetRows = newItems.map(function (it) {
          return [it.inventoryId, it.ndc, it.description, fmtDate(it.discDate), it.replacedBy];
        });
        await appendRows(saToken, sheetId, sheetRows);
        vResult.appended = sheetRows.length;
        // Mark them as sheeted so we never re-append.
        newItems.forEach(function (it) { sheeted[v.key + "||" + it.inventoryId] = true; sheetedChanged = true; });

        // Post to this vendor's channel with this vendor's sheet link.
        if (webhook) {
          try { await postSlack(webhook, buildMessage(v.label, newItems, sheetLink(sheetId))); vResult.slack = "sent"; }
          catch (e) { vResult.slack = "failed"; vResult.errors.push("slack: " + String(e.message || e)); }
        } else {
          vResult.slack = "no webhook (" + v.slackEnv + ")";
        }
      } else {
        vResult.slack = "skipped (no new items)";
      }
    } catch (e) {
      vResult.errors.push(String(e.message || e));
    }
    results.push(vResult);
  }

  if (datesChanged) await kvSet(DATES_KEY, dates);
  if (sheetedChanged) await kvSet(SHEETED_KEY, sheeted);

  return Response.json({ ok: true, ranAt: new Date().toISOString(), results });
}
