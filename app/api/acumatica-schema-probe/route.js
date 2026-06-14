// Read-only field-name probe. Fetches a 1-record sample of one or more entities
// (with Details expanded) and returns their field names, so the receipt-write
// payload can be built against the instance's real field names. No writes.
const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";

function json(o) {
  return new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
}
function flatten(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((k) => {
    const v = obj[k];
    if (v && typeof v === "object" && !Array.isArray(v) && "value" in v) out[k] = v.value;
    else out[k] = v;
  });
  return out;
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return json({ ok: false, stage: "parse-body", error: "Invalid JSON body" }); }
  const { username, password } = body || {};
  const entities = Array.isArray(body && body.entities) && body.entities.length ? body.entities : ["PurchaseReceipt", "PurchaseOrder"];
  if (!username || !password) return json({ ok: false, stage: "validate-input", error: "username and password required" });

  let cookies = "";
  try {
    const loginRes = await fetch(`${BASE}/entity/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ name: username, password: password })
    });
    if (!loginRes.ok) { const t = await loginRes.text(); return json({ ok: false, stage: "login", status: loginRes.status, body: t.slice(0, 500) }); }
    const sc = loginRes.headers.get("set-cookie") || "";
    cookies = sc.split(",").map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
  } catch (err) {
    return json({ ok: false, stage: "login", error: String(err) });
  }

  const results = {};
  try {
    for (let i = 0; i < entities.length; i++) {
      const ent = String(entities[i]).replace(/[^A-Za-z]/g, "");
      const url = `${BASE}/entity/Default/${API_VERSION}/${ent}?$top=5&$expand=Details`;
      try {
        const r = await fetch(url, { method: "GET", headers: { "Cookie": cookies, "Accept": "application/json" } });
        const text = await r.text();
        if (!r.ok) { results[ent] = { error: "HTTP " + r.status, body: text.slice(0, 300) }; continue; }
        let arr; try { arr = JSON.parse(text); } catch { results[ent] = { error: "parse", body: text.slice(0, 300) }; continue; }
        if (!Array.isArray(arr)) arr = arr ? [arr] : [];
        if (!arr.length) { results[ent] = { note: "no records to sample" }; continue; }
        const pick = (obj, fields) => { const o = {}; fields.forEach((f) => { if (obj && obj[f] != null && obj[f] !== "") o[f] = obj[f]; }); return o; };
        const headerSampleFields = ent === "PurchaseReceipt" ? ["Type", "Status", "Hold", "VendorID", "Branch", "Warehouse", "Location"] : ["Type", "Status", "VendorID", "Branch"];
        const lineSampleFields = ent === "PurchaseReceipt" ? ["POOrderNbr", "POOrderType", "POLineNbr", "ReceiptQty", "Location", "LotSerialNbr", "InventoryID", "Warehouse", "UOM"] : ["OrderType", "OrderNbr", "LineNbr", "AlternateID", "InventoryID"];
        // For receipts, prefer a record whose lines reference a PO.
        let rec = arr[0];
        if (ent === "PurchaseReceipt") {
          const withPO = arr.find((x) => Array.isArray(x.Details) && x.Details.some((d) => { const fd = flatten(d); return fd.POOrderNbr != null && fd.POOrderNbr !== ""; }));
          if (withPO) rec = withPO;
        }
        const flatH = flatten(rec);
        const headerKeys = Object.keys(flatH).filter((k) => k !== "Details");
        let lineObj = {};
        if (Array.isArray(rec.Details) && rec.Details.length) {
          const flatLines = rec.Details.map(flatten);
          lineObj = (ent === "PurchaseReceipt" ? (flatLines.find((d) => d.POOrderNbr != null && d.POOrderNbr !== "") || flatLines[0]) : flatLines[0]);
        }
        const lineKeys = Object.keys(lineObj);
        results[ent] = { headerKeys: headerKeys, lineKeys: lineKeys, headerSample: pick(flatH, headerSampleFields), lineSample: pick(lineObj, lineSampleFields) };
      } catch (e) {
        results[ent] = { error: String(e) };
      }
    }
    return json({ ok: true, results: results });
  } finally {
    try { await fetch(`${BASE}/entity/auth/logout`, { method: "POST", headers: { "Cookie": cookies } }); } catch {}
  }
}
