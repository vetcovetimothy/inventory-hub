/**
 * POST /api/stockitem-write-test   — MANUAL single-item test write.
 *
 * Writes a Note and/or Movement Class (ABCCode) to ONE StockItem so you can learn
 * what Acumatica accepts before any feature is built. It:
 *   1. logs in
 *   2. reads the item's current Note + ABCCode (before)
 *   3. PUTs only the field(s) you provided (note and/or abcCode)
 *   4. reads back the result (after)
 *   5. logs out
 * Returns before/after + the raw Acumatica response so you can see exactly what happened.
 *
 * Body: { username, password, inventoryID, note?, abcCode? }
 *   - Provide `note` (string) to set the Notes pop-up. Omit to leave it alone.
 *   - Provide `abcCode` (string) to set Movement Class. Omit to leave it alone.
 *
 * NOTE: This changes real item-master data. ABCCode must be a value that exists in
 * the Movement Class list, or Acumatica will reject it.
 */

const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";

function json(payload, status) {
  return new Response(JSON.stringify(payload, null, 2), { status: status || 200, headers: { "Content-Type": "application/json" } });
}
function fieldVal(record, name) {
  if (!record || !(name in record)) return null;
  const f = record[name];
  return (f && typeof f === "object" && "value" in f) ? f.value : f;
}

export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}
  const { username, password, inventoryID } = body;
  const note = body.note;        // may be undefined (leave alone) or a string
  const abcCode = body.abcCode;  // may be undefined (leave alone) or a string
  if (!username || !password) return json({ ok: false, stage: "input", error: "username and password required" }, 400);
  if (!inventoryID) return json({ ok: false, stage: "input", error: "inventoryID required" }, 400);
  if (note === undefined && abcCode === undefined) return json({ ok: false, stage: "input", error: "provide note and/or abcCode to write" }, 400);

  // Login
  let cookies = "";
  try {
    const loginRes = await fetch(`${BASE}/entity/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ name: username, password: password }),
    });
    if (!loginRes.ok) { const t = await loginRes.text(); return json({ ok: false, stage: "login", status: loginRes.status, body: t.slice(0, 400) }); }
    const sc = loginRes.headers.get("set-cookie") || "";
    cookies = sc.split(",").map(c => c.split(";")[0].trim()).filter(Boolean).join("; ");
  } catch (err) { return json({ ok: false, stage: "login", error: String(err) }); }

  const H = { "Content-Type": "application/json", "Accept": "application/json", "Cookie": cookies };
  const itemUrl = `${BASE}/entity/Default/${API_VERSION}/StockItem/${encodeURIComponent(inventoryID)}`;

  try {
    // 1. Read BEFORE
    let before = null;
    try {
      const r = await fetch(itemUrl, { method: "GET", headers: H });
      const t = await r.text();
      if (!r.ok) return json({ ok: false, stage: "read-before", status: r.status, body: t.slice(0, 500) });
      const rec = JSON.parse(t);
      before = { note: fieldVal(rec, "note"), ABCCode: fieldVal(rec, "ABCCode") };
    } catch (e) { return json({ ok: false, stage: "read-before", error: String(e) }); }

    // 2. Build the PUT payload — only the fields provided.
    const payload = { InventoryID: { value: inventoryID } };
    if (note !== undefined) payload.note = { value: String(note) };
    if (abcCode !== undefined) payload.ABCCode = { value: String(abcCode) };

    // 3. Write
    const putRes = await fetch(itemUrl, { method: "PUT", headers: H, body: JSON.stringify(payload) });
    const putText = await putRes.text();
    if (!putRes.ok) {
      return json({ ok: false, stage: "write", status: putRes.status, before: before, sent: payload, rawResponse: putText.slice(0, 1500) });
    }

    // 4. Read back AFTER (from the PUT response itself)
    let after = null;
    try { const rec = JSON.parse(putText); after = { note: fieldVal(rec, "note"), ABCCode: fieldVal(rec, "ABCCode") }; } catch (e) {}

    return json({
      ok: true,
      inventoryID: inventoryID,
      wrote: { note: note !== undefined ? String(note) : "(unchanged)", abcCode: abcCode !== undefined ? String(abcCode) : "(unchanged)" },
      before: before,
      after: after,
      noteChanged: before && after ? (before.note !== after.note) : null,
      abcChanged: before && after ? (before.ABCCode !== after.ABCCode) : null,
    });
  } catch (err) {
    return json({ ok: false, stage: "run", error: String(err) });
  } finally {
    try { await fetch(`${BASE}/entity/auth/logout`, { method: "POST", headers: { "Cookie": cookies } }); } catch (e) {}
  }
}
