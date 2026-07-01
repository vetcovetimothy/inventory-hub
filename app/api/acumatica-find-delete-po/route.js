/**
 * POST /api/acumatica-find-delete-po
 *
 * Finds and deletes "dummy" On-Hold POs by VendorID + Description, enforcing an
 * EXACTLY-ONE match per target so it can never delete the wrong PO.
 *
 * Used by the GoGoMeds crossover flow in the Generic PO Translator: after the
 * real Bloodworth PO is created from scratch (via /api/acumatica-po-import-create),
 * the placeholder "dummy" PO is removed. The dummy is always:
 *   - Vendor:      VID0041 (Vetcove Generics)
 *   - Description: "GOGOMEDS KY" or "GOGOMEDS AZ"
 *   - Status:      On Hold
 * This mirrors what the user did by hand: create the new PO, then delete the dummy.
 *
 * Body:
 *   {
 *     username, password,
 *     targets: [ { vendorId, description, warehouse? }, ... ]
 *   }
 *
 * Response:
 *   {
 *     ok,                       // false if any target errored or was ambiguous
 *     stage: "done",
 *     results: [
 *       { vendorId, description, warehouse, matched, deleted, orderNbr, id, status, reason, error?, hint?, candidates? }
 *     ]
 *   }
 *
 * Safety model:
 *   - Narrows by VendorID + Description in the $filter (VID0041 alone has far too
 *     many POs — McKesson, Keysource, etc. — so Description is what isolates the
 *     GGM dummy), then keeps only On-Hold rows in code.
 *   - 0 On-Hold matches  => skip, reason "not-found" / "none-on-hold" (nothing deleted).
 *   - >1 On-Hold matches => skip, reason "ambiguous" (lists them; nothing deleted).
 *   - exactly 1          => DELETE that single PO by its id.
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
    if (!t.vendorId)    return json({ ok: false, stage: "validate-input", error: `targets[${i}].vendorId is required` });
    if (!t.description) return json({ ok: false, stage: "validate-input", error: `targets[${i}].description is required` });
  }

  // ── Login ───────────────────────────────────────────────────────────────
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

  // ── Find + delete each target, always logging out at the end ─────────────
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

// ─────────────────────────────────────────────────────────────────────────
async function findDeleteOne(cookies, t) {
  const vendorId = String(t.vendorId);
  const description = String(t.description);
  const warehouse = t.warehouse ? String(t.warehouse) : null;
  const base = { vendorId, description, warehouse, matched: 0, deleted: false };

  // Narrow by VendorID + Description. Exact match — the caller guarantees the
  // "GOGOMEDS KY"/"GOGOMEDS AZ" convention. No $select (avoids field-name risk);
  // we only read OrderNbr / Status / id off each row.
  const filter = `VendorID eq '${vendorId}' and Description eq '${description}'`;
  const findUrl =
    `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder` +
    `?$filter=${encodeURIComponent(filter)}&$top=20`;

  let list;
  try {
    const res = await fetch(findUrl, { method: "GET", headers: { "Accept": "application/json", "Cookie": cookies } });
    const text = await res.text();
    if (!res.ok) {
      return Object.assign(base, { reason: "find-failed", status: res.status, error: `Lookup failed (HTTP ${res.status}) for ${vendorId} / "${description}"`, rawBody: text.slice(0, 800) });
    }
    try { list = JSON.parse(text); }
    catch { return Object.assign(base, { reason: "find-parse", error: "Acumatica returned non-JSON on lookup", rawBody: text.slice(0, 500) }); }
  } catch (err) {
    return Object.assign(base, { reason: "find-network", error: String(err) });
  }
  if (!Array.isArray(list)) list = [];

  // Keep only On-Hold rows — the dummy is always On Hold, and the freshly created
  // Bloodworth PO is a different vendor/description AND is Open, so it can't appear here.
  const onHold = list
    .filter(po => (po && po.Status && po.Status.value) === REQUIRED_STATUS)
    .map(po => ({ orderNbr: po?.OrderNbr?.value, id: po?.id, status: po?.Status?.value }));

  if (onHold.length === 0) {
    return Object.assign(base, {
      reason: list.length > 0 ? "none-on-hold" : "not-found",
      error: list.length > 0
        ? `Found ${list.length} PO(s) for ${vendorId} / "${description}" but none are On Hold — nothing deleted.`
        : `No PO found for ${vendorId} / "${description}" — nothing to delete.`
    });
  }
  if (onHold.length > 1) {
    return Object.assign(base, {
      matched: onHold.length,
      reason: "ambiguous",
      candidates: onHold,
      error: `${onHold.length} On-Hold POs match ${vendorId} / "${description}" (${onHold.map(c => c.orderNbr).join(", ")}). Refusing to delete — resolve manually.`
    });
  }

  // Exactly one — delete by id (same pattern as acumatica-remove-po-lines).
  const only = onHold[0];
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
