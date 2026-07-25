/**
 * GET /api/cron/po-recon
 *
 * Daily reconciliation: pulls the HD PO Tracker GIs (TP + GGM), keeps the last
 * 6 days, and adds any PO whose Vendor Ref isn't already in its receiving tab.
 * Server-side twin of the Settings > PO Reconciliation tool, for the Vercel cron.
 *
 * Acumatica: ACUMATICA_CRON_USERNAME / ACUMATICA_CRON_PASSWORD (same as backorder-check).
 * Trackers:  read/append via the service account (no creds needed here).
 * ?force=1 has no special meaning; the job is safe to re-run (dedupes by Vendor Ref).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SITE_URL = process.env.SITE_URL || "https://inventory-hub-two.vercel.app";

const TRACKER_MAP = {
  "TP-NY": { sheetId: "1Akzsql73Fkbkh817m4FZfHrzVqkv5cz9vyS25EofXtY", tab: "RECEIVING - BROOKLYN" },
  "TP-OH": { sheetId: "1Akzsql73Fkbkh817m4FZfHrzVqkv5cz9vyS25EofXtY", tab: "RECEIVING - SEVEN HILLS" },
  "TP-CA": { sheetId: "1Akzsql73Fkbkh817m4FZfHrzVqkv5cz9vyS25EofXtY", tab: "RECEIVING - HAYWARD" },
  "TP-TX": { sheetId: "1Akzsql73Fkbkh817m4FZfHrzVqkv5cz9vyS25EofXtY", tab: "RECEIVING - DALLAS" },
  "GGM-KY": { sheetId: "1dMZ_8VC6zaqLLWXQHFfuTXgxMfm0T4ip7To1CbXLfMk", tab: "RECEIVING - KY" },
  "GGM-AZ": { sheetId: "1dMZ_8VC6zaqLLWXQHFfuTXgxMfm0T4ip7To1CbXLfMk", tab: "RECEIVING - AZ" },
};

function json(p, s) { return new Response(JSON.stringify(p), { status: s || 200, headers: { "Content-Type": "application/json" } }); }
function uomToPkgSize(u) { var m = String(u == null ? "" : u).match(/(\d+)\s*$/); return m ? Number(m[1]) : 1; }
function fmtDate(v) { if (!v) return ""; var s = String(v).trim(); var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return Number(m[2]) + "/" + Number(m[3]) + "/" + m[1]; return s.slice(0, 10); }
function parseDate(v) { var s = String(v || "").trim(); var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); var m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m2) return new Date(Number(m2[3]), Number(m2[1]) - 1, Number(m2[2])); return null; }

async function pullGI(type, user, pass) {
  var resp = await fetch(SITE_URL + "/api/acumatica", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: type, username: user, password: pass }), cache: "no-store" });
  var data = await resp.json();
  if (!resp.ok) throw new Error(type + ": " + (data.error || resp.status));
  return data.data || [];
}
async function readRefs(dest) {
  var resp = await fetch(SITE_URL + "/api/tracker-read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sheetId: dest.sheetId, tab: dest.tab }), cache: "no-store" });
  var data = await resp.json();
  if (!data || !data.ok) throw new Error(dest.tab + ": " + ((data && data.error) || "read failed"));
  var set = {}; (data.refs || []).forEach(function (r) { set[String(r).trim()] = 1; }); return set;
}

async function run() {
  var user = process.env.ACUMATICA_CRON_USERNAME, pass = process.env.ACUMATICA_CRON_PASSWORD;
  if (!user || !pass) throw new Error("Missing ACUMATICA_CRON_USERNAME / ACUMATICA_CRON_PASSWORD");

  var tp = await pullGI("recon-tp", user, pass);
  var ggm = await pullGI("recon-ggm", user, pass);
  var rows = tp.concat(ggm);

  var cutoff = new Date(); cutoff.setHours(0, 0, 0, 0); cutoff.setDate(cutoff.getDate() - 6);
  var recent = rows.filter(function (r) { var d = parseDate(r.OrderDate); return d && d >= cutoff; });

  var groups = {};
  recent.forEach(function (r) {
    var wh = String(r.Warehouse || "").trim(), ref = String(r.VendorRef || "").trim();
    if (!wh || !ref || !TRACKER_MAP[wh]) return;
    var k = wh + "||" + ref; if (!groups[k]) groups[k] = { wh: wh, ref: ref, lines: [] }; groups[k].lines.push(r);
  });

  var whset = {}; Object.keys(groups).forEach(function (k) { whset[groups[k].wh] = 1; });
  var whs = Object.keys(whset);
  var existing = {};
  for (var i = 0; i < whs.length; i++) existing[whs[i]] = await readRefs(TRACKER_MAP[whs[i]]);

  var perWh = {};
  Object.keys(groups).forEach(function (k) {
    var g = groups[k];
    if (existing[g.wh][g.ref]) return;
    if (!perWh[g.wh]) perWh[g.wh] = { rows: [], arrival: [], refs: [] };
    g.lines.forEach(function (r) {
      var ps = Number(r.BOHPackSize); if (!ps || isNaN(ps)) ps = uomToPkgSize(r.UOM);
      var ndc = (r.SKUNDC && String(r.SKUNDC).trim()) ? String(r.SKUNDC).trim() : String(r.AltID || "").trim();
      var sup = String(r.VendorName || "").toLowerCase();
      var skipArrival = sup.indexOf("vetcove generics") >= 0 || sup.indexOf("bloodworth") >= 0;
      perWh[g.wh].rows.push([r.VendorName || "", ndc, r.Description || "", ps, r.OrderQty != null ? r.OrderQty : "", "=INDEX(D:D,ROW())*INDEX(E:E,ROW())", g.ref, fmtDate(r.OrderDate)]);
      perWh[g.wh].arrival.push(skipArrival ? "" : fmtDate(r.PromisedDate));
    });
    perWh[g.wh].refs.push(g.ref);
  });

  var results = [];
  var toAdd = Object.keys(perWh);
  for (var j = 0; j < toAdd.length; j++) {
    var w = toAdd[j], dest = TRACKER_MAP[w], pw = perWh[w];
    var resp = await fetch(SITE_URL + "/api/tracker-append", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sheetId: dest.sheetId, tab: dest.tab, rows: pw.rows, extraColumn: { header: "Expected Arrival", values: pw.arrival } }), cache: "no-store" });
    var data = await resp.json();
    results.push({ tab: dest.tab, ok: !!(data && data.ok), added: (data && data.appended) || 0, pos: pw.refs, error: (data && data.error) || null });
  }

  return { ok: true, date: new Date().toISOString().slice(0, 10), pulled: rows.length, recentWindow: recent.length, tabsUpdated: results };
}

export async function GET() {
  try { return json(await run()); }
  catch (e) { return json({ ok: false, error: String((e && e.message) || e) }, 500); }
}
export async function POST() { return GET(); }
