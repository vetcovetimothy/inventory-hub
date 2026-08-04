// /app/api/cron/po-eod-clear/route.js
// Nightly end-of-day auto-clear for PO Tools warehouses.
// A warehouse's PO Tools view is cleared ONLY IF every vendor in its saved
// shipNotes is marked done (which is also what visually "hides" vendors on the
// shipping tab). If ANY vendor is unchecked, or the warehouse has no data, it is
// left untouched. This can only clear fully-completed warehouses — it will never
// wipe open work.
//
// Reads/writes Upstash Redis directly using the same env vars as /api/kv.
// Intended to be invoked by Vercel Cron (see vercel.json) once nightly.

export const runtime = "edge";
export const dynamic = "force-dynamic";

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// Must match the WH keys in page.js
var WH_KEYS = ["TP-NY", "TP-OH", "TP-CA", "TP-TX", "TP-LI", "TP-SD", "GGM-KY", "GGM-AZ"];

async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  var resp = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + KV_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(["GET", key]),
    cache: "no-store",
  });
  if (!resp.ok) return null;
  var json = await resp.json();
  if (json.result === null || json.result === undefined) return null;
  try { return JSON.parse(json.result); } catch (e) { return json.result; }
}

async function kvSet(key, value) {
  if (!KV_URL || !KV_TOKEN) throw new Error("KV not configured");
  var resp = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + KV_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(["SET", key, JSON.stringify(value)]),
    cache: "no-store",
  });
  if (!resp.ok) throw new Error("KV save failed: " + resp.status + " " + (await resp.text()));
  var json = await resp.json();
  if (json.error) throw new Error("KV error: " + json.error);
  return json;
}

// A warehouse is "fully done" when it has at least one vendor group and every
// vendor key in shipNotes is marked done. shipNotes is keyed by "Vendor || PO".
function isFullyDone(payload) {
  if (!payload || !Array.isArray(payload.data) || payload.data.length === 0) return false;
  var notes = payload.shipNotes || {};
  var keys = Object.keys(notes);
  // Derive the set of vendor groups actually present in the data, so we don't
  // clear a warehouse where a vendor exists in data but was never checked.
  var groupsInData = {};
  payload.data.forEach(function (r) {
    var v = String((r && r.VendorName) || "").trim();
    var po = String((r && r.OrderNbr) || "").trim();
    if (v) groupsInData[v + " || " + po] = true;
  });
  var groupKeys = Object.keys(groupsInData);
  if (groupKeys.length === 0) return false;
  // Every vendor group present in the data must have a done note.
  for (var i = 0; i < groupKeys.length; i++) {
    var g = groupKeys[i];
    if (!notes[g] || notes[g].done !== true) return false;
  }
  return true;
}

async function run() {
  var results = [];
  for (var i = 0; i < WH_KEYS.length; i++) {
    var wh = WH_KEYS[i];
    var key = "po:" + wh;
    var entry = { wh: wh, action: "skipped", reason: "" };
    try {
      var payload = await kvGet(key);
      if (!payload || !Array.isArray(payload.data) || payload.data.length === 0) {
        entry.reason = "no data";
      } else if (isFullyDone(payload)) {
        await kvSet(key, { data: [], emailSent: false, runBy: null, runTime: null, shipNotes: {} });
        entry.action = "cleared";
        entry.reason = payload.data.length + " lines were all done";
      } else {
        entry.reason = "open items remain";
      }
    } catch (e) {
      entry.action = "error";
      entry.reason = String((e && e.message) || e);
    }
    results.push(entry);
  }
  return { ok: true, ranAt: new Date().toISOString(), cleared: results.filter(function (r) { return r.action === "cleared"; }).map(function (r) { return r.wh; }), detail: results };
}

export async function GET() {
  try { return Response.json(await run()); }
  catch (e) { return Response.json({ ok: false, error: String((e && e.message) || e) }, { status: 500 }); }
}
export async function POST() { return GET(); }
