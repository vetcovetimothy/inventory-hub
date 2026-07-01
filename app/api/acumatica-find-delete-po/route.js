/**
 * POST /api/acumatica-find-delete-po
 *
 * Finds and deletes "dummy" On-Hold POs, enforcing an EXACTLY-ONE match per
 * target so it can never delete the wrong PO.
 *
 * Used by the GoGoMeds crossover flow in the Generic PO Translator: after the
 * real Bloodworth PO is created from scratch (via /api/acumatica-po-import-create),
 * the placeholder "dummy" PO is removed. The dummy is always:
 *   - Vendor:    VID0041 (Vetcove Generics)
 *   - Status:    On Hold
 *   - Warehouse: GGM-KY or GGM-AZ (on its Location and/or its lines)
 *
 * NOTE ON MATCHING: the dummy's PO-header Description field is BLANK. The
 * "GOGOMEDS KY" text visible in Acumatica's PO list is the *location* description,
 * not the PO.Description field — so we do NOT filter on Description. We match on
 * Vendor + Hold, then confirm the GoGoMeds warehouse on the PO Location or any line.
 *
 * Body:
 *   { username, password, targets: [ { vendorId, warehouse, description? }, ... ] }
 *
 * Response:
 *   { ok, stage: "done", results: [ { vendorId, warehouse, matched, deleted, orderNbr, id, status, reason, error?, hint?, candidates? } ] }
 *
 * Safety model:
 *   - Filter narrows to On-Hold POs for the vendor (Hold eq true).
 *   - Keep only those whose Location or a line WarehouseID equals the target GGM warehouse.
 *   - 0 matches  => skip, reason "not-found" (nothing deleted).
 *   - >1 matches => skip, reason "ambiguous" (lists them; nothing deleted).
 *   - exactly 1  => DELETE that single PO by its id.
 */

const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";
const REQUIRED_STATUS = "On Hold";

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, stage: "parse-body", error: "Invalid JSON body" });
  }

  const { username, password, targets } = body || {};
  if (!username || !password) {
    return json({ ok: false, stage: "validate-input", error: "username and password required" });
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    return json({ ok: false, stage: "validate-input", error: "targets must be a non-empty array" });
  }
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (!t || typeof t !== "object") return json({ ok: false, stage: "validate-input", error: `targets[${i}] is not an object` });
    if (!t.vendorId)  return json({ ok: false, stage: "validate-input", error: `targets[${i}].vendorId is required` });
    if (!t.warehouse) return json({ ok: false, stage: "validate-input", error: `targets[${i}].warehouse is required` });
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

  // -- Find + delete each target, always logging out at the end -------------
  const results = [];
  try {
    for (let i = 0; i < targets.length; i++) {
      results.push(await findDeleteOne(cookies, targets[i]));
    }
  } finally {
    await logout(cookies);
  }

  const anyProblem = results.some(r => !r.deleted);
  return json({ ok: !anyProblem, stage: "done", results });
}

// --------------------------------------------------------------------------
async function findDeleteOne(cookies, t) {
  const vendorId = String(t.vendorId);
  const warehouse = String(t.warehouse);
  const description = t.description ? String(t.description) : "";
  const base = { vendorId, warehouse, description, matched: 0, deleted: false };

  // On-Hold POs for this vendor, with lines expanded so we can confirm the GGM warehouse.
  const filter = `VendorID eq '${vendorId}' and Hold eq true`;
  const findUrl =
    `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder` +
    `?$filter=${encodeURIComponent(filter)}&$expand=Details&$top=50`;

  let list;
  try {
    const res = await fetch(findUrl, { method: "GET", headers: { "Accept": "application/json", "Cookie": cookies } });
    const text = await res.text();
    if (!res.ok) {
      return Object.assign(base, { reason: "find-failed", status: res.status, error: `Lookup failed (HTTP ${res.status}) for On-Hold ${vendorId}`, rawBody: text.slice(0, 800) });
    }
    try { list = JSON.parse(text); }
    catch { return Object.assign(base, { reason: "find-parse", error: "Acumatica returned non-JSON on lookup", rawBody: text.slice(0, 500) }); }
  } catch (err) {
    return Object.assign(base, { reason: "find-network", error: String(err) });
  }
  if (!Array.isArray(list)) list = [];

  const wh = warehouse.trim().toUpperCase();
  const matches = list.filter(po => {
    if ((po && po.Status && po.Status.value) !== REQUIRED_STATUS) return false; // belt-and-suspenders
    const loc = String(po?.Location?.value || "").trim().toUpperCase();
    if (loc === wh) return true;
    const details = Array.isArray(po?.Details) ? po.Details : [];
    return details.some(d => String(d?.WarehouseID?.value || "").trim().toUpperCase() === wh);
  }).map(po => ({ orderNbr: po?.OrderNbr?.value, id: po?.id, status: po?.Status?.value, location: po?.Location?.value }));

  if (matches.length === 0) {
    return Object.assign(base, {
      reason: "not-found",
      error: `No On-Hold ${vendorId} PO in warehouse ${warehouse} found — nothing to delete.` + (list.length ? ` (${list.length} On-Hold ${vendorId} PO(s) scanned.)` : "")
    });
  }
  if (matches.length > 1) {
    return Object.assign(base, {
      matched: matches.length, reason: "ambiguous", candidates: matches,
      error: `${matches.length} On-Hold ${vendorId} POs match warehouse ${warehouse} (${matches.map(c => c.orderNbr).join(", ")}). Refusing to delete — resolve manually.`
    });
  }

  // Exactly one — delete by id (same pattern as acumatica-remove-po-lines).
  const only = matches[0];
  const delUrl = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder/${encodeURIComponent(only.id)}`;
  try {
    const dres = await fetch(delUrl, { method: "DELETE", headers: { "Accept": "application/json", "Cookie": cookies } });
    if (dres.status === 204 || dres.status === 200) {
      return Object.assign(base, { matched: 1, deleted: true, orderNbr: only.orderNbr, id: only.id, status: only.status, reason: "deleted" });
    }
    const dtext = await dres.text();
    let hint = "";
    if (dres.status === 403) hint = "The login lacks delete rights on the Purchase Orders form.";
    else if (dres.status === 500) hint = "Acumatica refused the delete — usually a receipt/bill or workflow rule blocking it.";
    return Object.assign(base, {
      matched: 1, deleted: false, orderNbr: only.orderNbr, id: only.id, reason: "delete-failed",
      status: dres.status, hint,
      error: `Found dummy ${only.orderNbr} but Acumatica rejected the delete (HTTP ${dres.status}).`,
      rawBody: dtext.slice(0, 1200)
    });
  } catch (err) {
    return Object.assign(base, { matched: 1, deleted: false, orderNbr: only.orderNbr, id: only.id, reason: "delete-network", error: String(err) });
  }
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
