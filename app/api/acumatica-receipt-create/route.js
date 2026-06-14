// Create an UNRELEASED purchase receipt for selected lines of one PO.
// Two-step: (1) create the receipt shell with vendor context, (2) add the PO lines.
// Created on hold — the tool never releases; the user reviews and releases in Acumatica.
const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";

function json(o) {
  return new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
}

// Pull a human-readable reason (incl. nested field errors) out of a contract-API error/422 body.
function parseErr(txt) {
  let detail = "";
  try {
    const ej = JSON.parse(txt);
    detail = ej.exceptionMessage || ej.message || ej.error || "";
    let inner = ej.innerException || ej.InnerException; let depth = 0;
    while (inner && depth < 6) { const m = inner.exceptionMessage || inner.message; if (m) detail += " | inner: " + m; inner = inner.innerException || inner.InnerException; depth++; }
    const fieldErrs = [];
    const walk = (o, path) => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) { o.forEach((v, i) => walk(v, path + "[" + i + "]")); return; }
      for (const k of Object.keys(o)) {
        if (k === "error" && typeof o[k] === "string" && o[k] && path) fieldErrs.push(path + ": " + o[k]);
        else if (o[k] && typeof o[k] === "object") walk(o[k], path ? path + "." + k : k);
      }
    };
    walk(ej, "");
    if (fieldErrs.length) detail += " | FIELD ERRORS: " + fieldErrs.slice(0, 10).join("  ;  ");
  } catch {}
  return String(detail).slice(0, 1400);
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return json({ ok: false, stage: "parse-body", error: "Invalid JSON body" }); }
  const { username, password, vendorID, vendorRef, orderNbr, orderType, lines } = body || {};
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

  const putReceipt = async (payload) => {
    const resp = await fetch(`${BASE}/entity/Default/${API_VERSION}/PurchaseReceipt`, {
      method: "PUT",
      headers: { "Cookie": cookies, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload)
    });
    const txt = await resp.text();
    return { ok: resp.ok, status: resp.status, txt };
  };

  // ── Create (try/finally so we always log out) ──
  try {
    const details = lines.map((l) => ({
      POOrderNbr: { value: String(orderNbr) },
      POOrderType: { value: String(orderType || "Normal") },
      POLineNbr: { value: Number(l.poLineNbr) },
      ReceiptQty: { value: Number(l.receiptQty) }
    }));

    // Step 1: shell with vendor context (no lines yet).
    const shell = { Type: { value: "Receipt" }, Hold: { value: true } };
    if (vendorID) shell.VendorID = { value: String(vendorID) };
    if (vendorRef) shell.VendorRef = { value: String(vendorRef) };
    const s1 = await putReceipt(shell);
    if (!s1.ok) return json({ ok: false, stage: "create-shell", status: s1.status, error: parseErr(s1.txt), body: s1.txt.slice(0, 1500), payloadSent: shell });
    let o1; try { o1 = JSON.parse(s1.txt); } catch { o1 = null; }
    const receiptNbr = o1 && o1.ReceiptNbr ? o1.ReceiptNbr.value : null;
    if (!receiptNbr) return json({ ok: false, stage: "create-shell-no-nbr", body: s1.txt.slice(0, 1000) });

    // Step 2: add the PO lines to the now vendor-scoped receipt.
    const step2 = { Type: { value: "Receipt" }, ReceiptNbr: { value: receiptNbr }, Details: details };
    const s2 = await putReceipt(step2);
    if (!s2.ok) return json({ ok: false, stage: "add-lines", status: s2.status, error: parseErr(s2.txt), body: s2.txt.slice(0, 1500), receiptNbr: receiptNbr, payloadSent: step2 });
    let o2; try { o2 = JSON.parse(s2.txt); } catch { o2 = null; }
    return json({ ok: true, receiptNbr: receiptNbr, status: o2 && o2.Status ? o2.Status.value : null, hold: o2 && o2.Hold ? o2.Hold.value : null, lineCount: details.length });
  } catch (err) {
    return json({ ok: false, stage: "create", error: String(err) });
  } finally {
    try { await fetch(`${BASE}/entity/auth/logout`, { method: "POST", headers: { "Cookie": cookies } }); } catch {}
  }
}
