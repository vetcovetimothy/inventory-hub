/**
 * GET /api/cron/oos-history  (Vercel Cron; also safe to hit manually to test)
 *
 * Once a day: pulls the current OOS rows from the existing /api/oos-allwhse-nos-oos
 * endpoint, reads the shared notes from KV, and appends one dated row per
 * warehouse-manufacturer OOS item to the OOS History Google Sheet — writing as a
 * Google service account (no user login required).
 *
 * Required env vars:
 *   GOOGLE_SA_EMAIL           service account email (…@…iam.gserviceaccount.com)
 *   GOOGLE_SA_PRIVATE_KEY     service account private key (PEM; \n escaped is fine)
 *   OOS_HISTORY_SHEET_ID      (optional) defaults to the known history sheet
 *   SITE_URL                  (optional) defaults to the prod URL
 *   KV_REST_API_URL / KV_REST_API_TOKEN   already set (used by other crons)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "crypto";

const SITE_URL = process.env.SITE_URL || "https://inventory-hub-two.vercel.app";
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const SHEET_ID = process.env.OOS_HISTORY_SHEET_ID || "1HJu5kVC-kM59ZGuBtjOGc9MBpBGgZdsdvIfZ8MLNsJs";
const HEADER = ["Snapshot Date", "Warehouse", "Vendor", "Mfr No", "Manufacturer", "Product", "Supply Status", "Note", "SD", "BO", "Order Status"];

const WH_MAP = { "TRUEPILL_BROOKLYN": "Brooklyn", "TRUEPILL_OHIO": "Ohio", "TRUEPILL_HAYWARD": "Hayward", "GOGOMEDS_KY": "Kentucky", "GOGOMEDS_AZ": "Arizona", "GOGOMEDS_KENTUCKY": "Kentucky", "GOGOMEDS_ARIZONA": "Arizona", "HILLS_CGP_WAREHOUSE_CA": "Hills CA", "HILLS_CGP_WAREHOUSE_NJ": "Hills NJ", "HILLS_CGP_WAREHOUSE_FL": "Hills FL", "HILLS_CGP_WAREHOUSE_TX": "Hills TX" };
const TAB_VENDORS = { fuzerx: ["fuzerx", "fuze"], gogomeds: ["gogomeds", "gogo"], cgp: ["central garden", "cgp"] };
const TAB_LABEL = { fuzerx: "FuzeRx", gogomeds: "GoGoMeds", cgp: "Central Garden & Pet" };

function json(payload, status) {
  return new Response(JSON.stringify(payload), { status: status || 200, headers: { "Content-Type": "application/json" } });
}
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function mapWH(slug) { return WH_MAP[slug] || slug || ""; }
function tabForVendor(vendor) {
  var v = String(vendor == null ? "" : vendor).toLowerCase();
  var keys = Object.keys(TAB_VENDORS);
  for (var i = 0; i < keys.length; i++) {
    var aliases = TAB_VENDORS[keys[i]];
    for (var j = 0; j < aliases.length; j++) { if (v.indexOf(aliases[j]) !== -1) return keys[i]; }
  }
  return null;
}

async function kvGetRaw(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  var resp = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + KV_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(["GET", key]),
    cache: "no-store",
  });
  if (!resp.ok) return null;
  var j = await resp.json();
  if (j.result === null || j.result === undefined) return null;
  try { return JSON.parse(j.result); } catch (e) { return j.result; }
}
async function kvSetRaw(key, value) {
  if (!KV_URL || !KV_TOKEN) return;
  await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + KV_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(["SET", key, JSON.stringify(value)]),
    cache: "no-store",
  });
}

// Service-account access token for the Sheets scope.
async function getServiceAccountToken() {
  var email = process.env.GOOGLE_SA_EMAIL || "";
  var rawKey = process.env.GOOGLE_SA_PRIVATE_KEY || "";
  if (!email || !rawKey) throw new Error("Missing GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY");
  var pem = rawKey.indexOf("-----BEGIN") >= 0 ? rawKey.replace(/\\n/g, "\n") : Buffer.from(rawKey, "base64").toString("utf8");
  var privKey = crypto.createPrivateKey({ key: pem });
  var now = Math.floor(Date.now() / 1000);
  var header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  var claim = b64url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  var signingInput = header + "." + claim;
  var assertion = signingInput + "." + b64url(crypto.sign("RSA-SHA256", Buffer.from(signingInput), privKey));
  var resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: assertion }),
  });
  if (!resp.ok) throw new Error("SA token exchange failed: " + (await resp.text()));
  var data = await resp.json();
  return data.access_token;
}

export async function GET(request) {
  try {
    var force = false;
    try { force = new URL(request.url).searchParams.get("force") === "1"; } catch (e) {}
    // 1. Guard against a duplicate run on the same calendar day (manual force bypasses).
    var d = new Date();
    var dateStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    var last = await kvGetRaw("oos-history-last");
    if (!force && last && last.date === dateStr) return json({ ok: true, skipped: "already snapshotted today", date: dateStr });

    // 2. Current OOS rows from the existing, tested endpoint.
    var oosResp = await fetch(SITE_URL + "/api/oos-allwhse-nos-oos", { cache: "no-store" });
    if (!oosResp.ok) return json({ ok: false, stage: "fetch-oos", error: "OOS endpoint " + oosResp.status }, 502);
    var oosData = await oosResp.json();
    var rows = (oosData && oosData.rows) || [];

    // 3. Notes: text (permanent bucket) and flags (shared bucket), keyed by "<tab>:<MANUFACTURER_NO>".
    var notes = (await kvGetRaw("oos-notes-permanent")) || {};
    var noteFlags = (await kvGetRaw("oos-notes-shared")) || {};
    // Auto SD/BO lists (Inventory IDs), stored as { data: [ {InventoryID}, ... ] }.
    var sdStored = await kvGetRaw("tracker-shared-short-dating");
    var boStored = await kvGetRaw("tracker-shared-backorder");
    var sdSet = {}, boSet = {};
    ((sdStored && sdStored.data) || []).forEach(function (x) { if (x && x.InventoryID) sdSet[String(x.InventoryID)] = true; });
    ((boStored && boStored.data) || []).forEach(function (x) { if (x && x.InventoryID) boSet[String(x.InventoryID)] = true; });

    // Order Status: open PO lines from Acumatica (normalized by the app's own endpoint),
    // matched to OOS items by Inventory ID. Simplified vs. the tracker (no ETA enrichment).
    var orderMap = {};
    try {
      var acuUser = process.env.ACUMATICA_CRON_USERNAME, acuPass = process.env.ACUMATICA_CRON_PASSWORD;
      if (acuUser && acuPass) {
        var poResp = await fetch(SITE_URL + "/api/acumatica", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "open-po-lines", username: acuUser, password: acuPass }),
        });
        if (poResp.ok) {
          var poData = await poResp.json();
          var poRows = (poData && poData.data) || [];
          poRows.forEach(function (p) {
            var id = String(p.InventoryID == null ? "" : p.InventoryID).trim();
            if (!id) return;
            var open = (parseFloat(p.OrderQty) || 0) - (parseFloat(p.QtyOnReceipts) || 0);
            if (open <= 0) return;
            if (!orderMap[id]) orderMap[id] = [];
            orderMap[id].push({ po: String(p.OrderNbr || ""), date: String(p.OrderDate || "") });
          });
        }
      }
    } catch (e) { /* order status stays blank on any failure */ }

    function orderStatusFor(mfrNo) {
      var list = orderMap[String(mfrNo)];
      if (!list || !list.length) return "";
      if (list.length === 1) return "On Order: " + list[0].po + (list[0].date ? " (" + list[0].date + ")" : "");
      return "On Order (" + list.length + "): " + list.map(function (x) { return x.po; }).join(", ");
    }
    function effectiveFlag(tab, mfrNo, field, autoSet) {
      var f = tab ? noteFlags[tab + ":" + mfrNo] : null;
      var v = (f && f[field] !== undefined) ? f[field] : autoSet[String(mfrNo)];
      return v ? "Yes" : "";
    }

    // 4. Build one flat dated row per OOS record.
    var values = rows.map(function (r) {
      var vendor = String(r.VENDOR_NAME == null ? "" : r.VENDOR_NAME);
      var tab = tabForVendor(vendor);
      var note = tab ? (notes[tab + ":" + r.MANUFACTURER_NO] || "") : "";
      var vendorLabel = tab ? TAB_LABEL[tab] : vendor;
      return [
        dateStr,
        mapWH(String(r.WAREHOUSE_SLUG == null ? "" : r.WAREHOUSE_SLUG)),
        vendorLabel,
        String(r.MANUFACTURER_NO == null ? "" : r.MANUFACTURER_NO),
        String(r.MANUFACTURER_NAME == null ? "" : r.MANUFACTURER_NAME),
        String(r.PRODUCT_LINE_NAME == null ? "" : r.PRODUCT_LINE_NAME),
        String(r.SUPPLY_STATUS == null ? "" : r.SUPPLY_STATUS),
        String(note),
        effectiveFlag(tab, r.MANUFACTURER_NO, "sd", sdSet),
        effectiveFlag(tab, r.MANUFACTURER_NO, "bo", boSet),
        orderStatusFor(r.MANUFACTURER_NO),
      ];
    });
    if (!values.length) return json({ ok: true, appended: 0, note: "no OOS rows to snapshot", date: dateStr });

    // 5. Append to the current-year tab (auto-created with a header row the first time).
    var token = await getServiceAccountToken();
    var base = "https://sheets.googleapis.com/v4/spreadsheets/" + SHEET_ID;
    var authHeaders = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    var year = String(d.getFullYear());

    var metaResp = await fetch(base + "?fields=sheets.properties.title", { headers: authHeaders });
    if (!metaResp.ok) return json({ ok: false, stage: "sheet-meta", error: await metaResp.text() }, 502);
    var meta = await metaResp.json();
    var titles = (meta.sheets || []).map(function (s) { return s.properties.title; });
    if (titles.indexOf(year) === -1) {
      var addResp = await fetch(base + ":batchUpdate", { method: "POST", headers: authHeaders, body: JSON.stringify({ requests: [{ addSheet: { properties: { title: year } } }] }) });
      if (!addResp.ok) return json({ ok: false, stage: "add-year-tab", error: await addResp.text() }, 502);
      await fetch(base + "/values/" + encodeURIComponent(year + "!A1") + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", { method: "POST", headers: authHeaders, body: JSON.stringify({ values: [HEADER] }) });
    }

    var appendResp = await fetch(base + "/values/" + encodeURIComponent(year) + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ values: values }),
    });
    if (!appendResp.ok) return json({ ok: false, stage: "append", error: await appendResp.text() }, 502);

    await kvSetRaw("oos-history-last", { date: dateStr });
    return json({ ok: true, appended: values.length, date: dateStr, tab: year });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}
