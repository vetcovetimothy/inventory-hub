/**
 * POST /api/acumatica-check-po
 *
 * Checks whether Purchase Orders already exist in Acumatica, matched by
 * VendorRef (the vendor's own PO number parsed from the PDF). Used by the
 * Generic PO Translator BEFORE creating POs, so an already-created PO is never
 * created a second time.
 *
 * Read-only: it only GETs PurchaseOrder records; it never writes or deletes.
 *
 * Body:
 *   { username, password, vendorRefs: ["16933015", "PO628", ...] }
 *
 * Response:
 *   { ok, stage: "done", existing: [ { vendorRef, orderNbr, status } ],
 *     checked: <n>, existingRefs: ["16933015"] }
 *
 * existing[] contains one entry per already-present PO (a ref can appear more
 * than once if Acumatica has multiple POs with that VendorRef). existingRefs is
 * the de-duplicated list of refs that matched at least one PO.
 */

const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, stage: "parse-body", error: "Invalid JSON body" });
  }

  const { username, password, vendorRefs } = body || {};
  if (!username || !password) {
    return json({ ok: false, stage: "validate-input", error: "username and password required" });
  }
  if (!Array.isArray(vendorRefs) || vendorRefs.length === 0) {
    return json({ ok: false, stage: "validate-input", error: "vendorRefs must be a non-empty array" });
  }

  // De-duplicate + clean the refs before querying.
  const refs = [];
  const seen = {};
  for (let i = 0; i < vendorRefs.length; i++) {
    const r = String(vendorRefs[i] == null ? "" : vendorRefs[i]).trim();
    if (r && !seen[r]) { seen[r] = true; refs.push(r); }
  }
  if (refs.length === 0) {
    return json({ ok: false, stage: "validate-input", error: "no non-empty vendorRefs after cleaning" });
  }

  // -- Login ----------------------------------------------------------------
  let cookies = "";
  try {
    const loginRes = await fetch(`${BASE}/entity/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ name: username, password: password })
    });
    if (!loginRes.ok) {
      const text = await loginRes.text();
      return json({ ok: false, stage: "login", status: loginRes.status, body: text.slice(0, 500) });
    }
    const setCookie = loginRes.headers.get("set-cookie") || "";
    cookies = setCookie.split(",").map(c => c.split(";")[0].trim()).filter(Boolean).join("; ");
  } catch (err) {
    return json({ ok: false, stage: "login", error: String(err) });
  }

  // -- Check each ref, always logging out at the end ------------------------
  const existing = [];
  let checkError = null;
  try {
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      // OData string literals escape a single quote by doubling it.
      const safe = ref.replace(/'/g, "''");
      const filter = `VendorRef eq '${safe}'`;
      const url =
        `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder` +
        `?$filter=${encodeURIComponent(filter)}&$select=OrderNbr,Status,VendorRef&$top=50`;
      let res;
      try {
        res = await fetch(url, { method: "GET", headers: { "Accept": "application/json", "Cookie": cookies } });
      } catch (err) {
        checkError = { stage: "lookup-network", ref, error: String(err) };
        break;
      }
      if (!res.ok) {
        const text = await res.text();
        checkError = { stage: "lookup-failed", ref, status: res.status, body: text.slice(0, 500) };
        break;
      }
      let list;
      try { list = await res.json(); }
      catch { checkError = { stage: "lookup-parse", ref, error: "Acumatica returned non-JSON on lookup" }; break; }
      if (Array.isArray(list)) {
        for (let k = 0; k < list.length; k++) {
          const po = list[k] || {};
          existing.push({
            vendorRef: ref,
            orderNbr: po.OrderNbr && po.OrderNbr.value != null ? po.OrderNbr.value : null,
            status: po.Status && po.Status.value != null ? po.Status.value : null
          });
        }
      }
    }
  } finally {
    await logout(cookies);
  }

  // If we couldn't complete the check, report failure so the caller can decide
  // NOT to proceed blindly (fail closed for a create-guard).
  if (checkError) {
    return json({ ok: false, stage: "check-incomplete", detail: checkError, existing, checked: refs.length });
  }

  const existingRefs = [];
  const seenRef = {};
  existing.forEach(function (e) { if (e.vendorRef && !seenRef[e.vendorRef]) { seenRef[e.vendorRef] = true; existingRefs.push(e.vendorRef); } });

  return json({ ok: true, stage: "done", checked: refs.length, existing, existingRefs });
}

async function logout(cookies) {
  try {
    await fetch(`${BASE}/entity/auth/logout`, { method: "POST", headers: { "Cookie": cookies } });
  } catch {}
}

function json(payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
