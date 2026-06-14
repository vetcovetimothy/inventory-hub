// Create an UNRELEASED purchase receipt for selected lines of one PO.
// Single PUT per the documented "Create a Purchase Receipt from a Purchase Order":
// header VendorID + Location, Details referencing the PO line(s). Created on hold —
// the tool never releases; the user reviews and releases in Acumatica.
const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";
const BRANCH = "VETCOVE";

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
  const { username, password, vendorID, vendorRef, orderNbr, orderType, lines, location } = body || {};
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

  // ── Create (try/finally so we always log out) ──
  try {
    // Documented "Create a Purchase Receipt from a Purchase Order": reference the PO
    // with only OrderNbr + Type, which pulls all of its open lines at full qty.
    // (Per-line POLineNbr/ReceiptQty selectivity is rejected by the order selector;
    // selective qty/skip will be layered on as a follow-up adjustment step.)
    const details = [{
      POOrderNbr: { value: String(orderNbr) },
      POOrderType: { value: String(orderType || "Normal") }
    }];

    const payload = {
      Type: { value: "Receipt" },
      Hold: { value: true },
      Branch: { value: BRANCH },
      Location: { value: String(location || "MAIN") },
      Details: details
    };
    if (vendorID) payload.VendorID = { value: String(vendorID) };
    if (vendorRef) payload.VendorRef = { value: String(vendorRef) };

    const r = await fetch(`${BASE}/entity/Default/${API_VERSION}/PurchaseReceipt?$expand=Details`, {
      method: "PUT",
      headers: { "Cookie": cookies, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload)
    });
    const text = await r.text();
    if (!r.ok) {
      let verify = "";
      try {
        const vr = await fetch(`${BASE}/entity/Default/${API_VERSION}/PurchaseOrder?$filter=OrderNbr eq '${String(orderNbr).replace(/'/g, "''")}'&$top=1`, { headers: { "Cookie": cookies, "Accept": "application/json" } });
        const vt = await vr.text();
        if (vr.ok) {
          const va = JSON.parse(vt);
          const po = Array.isArray(va) && va.length ? va[0] : null;
          if (po) {
            const gv = (f) => (po[f] && typeof po[f] === "object" && "value" in po[f]) ? po[f].value : (po[f] != null ? po[f] : "");
            verify = ` || PO CHECK (create session sees it): Type="${gv("Type")}" Status="${gv("Status")}" Hold=${gv("Hold")} VendorID="${gv("VendorID")}" Branch="${gv("Branch")}"`;
          } else {
            verify = ` || PO CHECK: create session does NOT see OrderNbr ${orderNbr} (company/tenant mismatch?)`;
          }
        } else { verify = ` || PO CHECK failed HTTP ${vr.status}`; }
      } catch (e) { verify = " || PO CHECK error: " + String(e); }
      return json({ ok: false, stage: "create", status: r.status, error: parseErr(text) + verify, body: text.slice(0, 1200), payloadSent: payload });
    }
    let o; try { o = JSON.parse(text); } catch { o = null; }
    const receiptNbr = o && o.ReceiptNbr ? o.ReceiptNbr.value : null;
    return json({ ok: true, receiptNbr: receiptNbr, status: o && o.Status ? o.Status.value : null, hold: o && o.Hold ? o.Hold.value : null, lineCount: details.length });
  } catch (err) {
    return json({ ok: false, stage: "create", error: String(err) });
  } finally {
    try { await fetch(`${BASE}/entity/auth/logout`, { method: "POST", headers: { "Cookie": cookies } }); } catch {}
  }
}
