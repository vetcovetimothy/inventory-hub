// Create an UNRELEASED purchase receipt for selected lines of one PO.
// Created on hold — the tool never releases; the user reviews and releases in Acumatica.
const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";

function json(o) {
  return new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return json({ ok: false, stage: "parse-body", error: "Invalid JSON body" }); }
  const { username, password, vendorID, orderNbr, orderType, lines } = body || {};
  if (!username || !password) return json({ ok: false, stage: "validate-input", error: "username and password required" });
  if (!orderNbr) return json({ ok: false, stage: "validate-input", error: "orderNbr required" });
  if (!Array.isArray(lines) || !lines.length) return json({ ok: false, stage: "validate-input", error: "lines must be a non-empty array" });
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.poLineNbr == null || l.poLineNbr === "") return json({ ok: false, stage: "validate-input", error: `lines[${i}].poLineNbr required` });
    const q = Number(l.receiptQty);
    if (!isFinite(q) || q <= 0) return json({ ok: false, stage: "validate-input", error: `lines[${i}].receiptQty must be > 0 (got ${l.receiptQty})` });
  }

  // ── Login ──
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

  // ── Create receipt (try/finally so we always log out) ──
  try {
    const details = lines.map((l) => {
      const d = {
        POOrderNbr: { value: String(orderNbr) },
        POOrderType: { value: String(orderType || "Normal") },
        POLineNbr: { value: Number(l.poLineNbr) },
        ReceiptQty: { value: Number(l.receiptQty) }
      };
      if (l.location && String(l.location).trim()) d.Location = { value: String(l.location).trim() };
      return d;
    });
    const payload = { Type: { value: "Receipt" }, Hold: { value: true }, Details: details };
    if (vendorID) payload.VendorID = { value: String(vendorID) };

    const r = await fetch(`${BASE}/entity/Default/${API_VERSION}/PurchaseReceipt`, {
      method: "PUT",
      headers: { "Cookie": cookies, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload)
    });
    const text = await r.text();
    if (!r.ok) return json({ ok: false, stage: "create", status: r.status, body: text.slice(0, 1500), payloadSent: payload });
    let obj; try { obj = JSON.parse(text); } catch { obj = null; }
    const receiptNbr = obj && obj.ReceiptNbr ? obj.ReceiptNbr.value : null;
    const status = obj && obj.Status ? obj.Status.value : null;
    const hold = obj && obj.Hold ? obj.Hold.value : null;
    return json({ ok: true, receiptNbr: receiptNbr, status: status, hold: hold, lineCount: details.length });
  } catch (err) {
    return json({ ok: false, stage: "create", error: String(err) });
  } finally {
    try { await fetch(`${BASE}/entity/auth/logout`, { method: "POST", headers: { "Cookie": cookies } }); } catch {}
  }
}
