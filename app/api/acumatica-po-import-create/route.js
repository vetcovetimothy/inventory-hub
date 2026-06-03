/**
 * POST /api/acumatica-po-import-create
 *
 * Creates Acumatica POs in batch from the Generic PO Translator (POImportTool).
 * Each input PO becomes one Acumatica PO; the route stops on the first failure
 * (same pattern as the Truckloader auto-create route).
 *
 * All POs are created with Hold:false (Open), which differs from the Truckloader
 * pattern. This matches what the user does manually today for these vendors:
 * Keysource/Anda/Bloodworth, McKesson, and GGM POs all get released immediately.
 *
 * Body:
 *   {
 *     username, password,
 *     pos: [
 *       {
 *         vendorId:    string,         // e.g. "VID0041" (Vetcove Generics) or "VID0016" (Bloodworth)
 *         location:    string,         // e.g. "TP-OH" — typically matches the warehouse code
 *         description: string,         // e.g. "Keysource", "McKesson", "" for GGM
 *         vendorRef:   string,         // vendor's own PO number, parsed from PDF
 *         lines: [
 *           { inventoryId: string, warehouse: string, orderQty: number, unitCost: number, uom: string, alternateId?: string }
 *           // alternateId is the vendor's NDC the line was matched on; when present,
 *           // the route sets it on the created line so the PO shows that NDC instead
 *           // of the stock item's default cross-reference.
 *         ]
 *       },
 *       ...
 *     ]
 *   }
 *
 * Per-PO steps:
 *   1. PUT a new PurchaseOrder with VendorID + Description + VendorRef + Hold:false + lines
 *   2. Capture the returned OrderNbr / id / status / total
 *
 * Note: Unlike the Truckloader (which does create then a separate PUT for VendorRef),
 * we set VendorRef in the initial PUT. Acumatica accepts that pattern fine.
 */

const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";
const BRANCH = "VETCOVE";

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, stage: "parse-body", error: "Invalid JSON body" });
  }

  const { username, password, pos } = body || {};
  if (!username || !password) {
    return json({ ok: false, stage: "validate-input", error: "username and password required" });
  }
  if (!Array.isArray(pos) || pos.length === 0) {
    return json({ ok: false, stage: "validate-input", error: "pos must be a non-empty array" });
  }

  // Validate each PO before doing any work — fail fast on bad input
  for (let i = 0; i < pos.length; i++) {
    const p = pos[i];
    if (!p || typeof p !== "object") {
      return json({ ok: false, stage: "validate-input", error: `pos[${i}] is not an object` });
    }
    if (!p.vendorId)   return json({ ok: false, stage: "validate-input", error: `pos[${i}].vendorId is required` });
    if (!p.location)   return json({ ok: false, stage: "validate-input", error: `pos[${i}].location is required` });
    if (!p.vendorRef)  return json({ ok: false, stage: "validate-input", error: `pos[${i}].vendorRef is required` });
    if (!Array.isArray(p.lines) || p.lines.length === 0) {
      return json({ ok: false, stage: "validate-input", error: `pos[${i}].lines must be a non-empty array` });
    }
    for (let li = 0; li < p.lines.length; li++) {
      const l = p.lines[li];
      if (!l.inventoryId) return json({ ok: false, stage: "validate-input", error: `pos[${i}].lines[${li}].inventoryId is required` });
      if (!l.warehouse)   return json({ ok: false, stage: "validate-input", error: `pos[${i}].lines[${li}].warehouse is required` });
      const qty = Number(l.orderQty);
      if (!isFinite(qty) || qty <= 0) {
        return json({ ok: false, stage: "validate-input", error: `pos[${i}].lines[${li}].orderQty must be a positive number (got ${l.orderQty})` });
      }
      // unitCost can be 0 (the create will still work; some line items have zero cost legitimately)
      // uom is required because Acumatica defaults to the stock item's base UOM if omitted,
      // but our PDFs deliberately specify what UOM was ordered (e.g. BT, EA), so we pass it through.
      if (!l.uom) return json({ ok: false, stage: "validate-input", error: `pos[${i}].lines[${li}].uom is required` });
    }
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

  // ── Process POs sequentially, stopping on first failure ─────────────────
  // Wrapped in try/finally so we always log out (session leak protection).
  const succeeded = [];
  let failure = null;
  try {
    for (let i = 0; i < pos.length; i++) {
      const p = pos[i];
      const result = await createOnePO(cookies, p);
      if (!result.ok) {
        failure = {
          poIndex: i,
          vendorRef: p.vendorRef,
          description: p.description || "",
          stage: result.stage,
          status: result.status,
          errorDetails: result.errorDetails,
          rawBody: result.rawBody,
          payloadSent: result.payloadSent
        };
        break;
      }
      succeeded.push({
        poIndex: i,
        vendorRef: p.vendorRef,
        description: p.description || "",
        orderNbr: result.orderNbr,
        status: result.status,
        hold: result.hold,
        lineCount: result.lineCount,
        orderTotal: result.orderTotal,
        method: result.method,
        createAltError: result.createAltError,
        lineResults: result.lineResults
      });
    }
  } finally {
    await logout(cookies);
  }

  return json({
    ok: failure === null,
    stage: failure === null ? "all-done" : "stopped-on-failure",
    succeeded,
    failure
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Per-PO flow:
//   Put AlternateID (the vendor NDC) in the SAME create payload as every other
//   line field — keyed so it resolves the item, with NO InventoryID, because the
//   grid-import test showed that when both are present InventoryID wins and the
//   line falls back to the item's default cross-reference. If a line can't be
//   resolved from its NDC, fall back to creating that PO by InventoryID (the old
//   behavior) so a usable PO is always produced. The response reports which
//   method was used and the resulting NDC per line.
async function createOnePO(cookies, p) {
  const url = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder?$expand=Details`;

  const header = {
    VendorID:    { value: String(p.vendorId) },
    Location:    { value: String(p.location) },
    Branch:      { value: BRANCH },
    Hold:        { value: false },                  // Open immediately
    VendorRef:   { value: String(p.vendorRef) },
    Description: { value: String(p.description || "") }
  };

  // Lines with BOTH InventoryID and AlternateID (the vendor NDC) in one create.
  const detailsByBoth = () => p.lines.map(line => ({
    BranchID:    { value: BRANCH },
    InventoryID: { value: String(line.inventoryId) },
    AlternateID: { value: String(line.alternateId) },
    WarehouseID: { value: String(line.warehouse) },
    OrderQty:    { value: Number(line.orderQty) },
    UOM:         { value: String(line.uom) },
    UnitCost:    { value: Number(line.unitCost) || 0 }
  }));

  // Fallback: lines keyed by InventoryID only (NDC will be the item default)
  const detailsByInventory = () => p.lines.map(line => ({
    BranchID:    { value: BRANCH },
    InventoryID: { value: String(line.inventoryId) },
    WarehouseID: { value: String(line.warehouse) },
    OrderQty:    { value: Number(line.orderQty) },
    UOM:         { value: String(line.uom) },
    UnitCost:    { value: Number(line.unitCost) || 0 }
  }));

  async function putCreate(details) {
    const payload = Object.assign({}, header, { Details: details });
    let res, text;
    try {
      res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Accept": "application/json", "Cookie": cookies },
        body: JSON.stringify(payload)
      });
      text = await res.text();
    } catch (err) {
      return { ok: false, networkError: String(err), payloadSent: payload };
    }
    if (!res.ok) {
      let errorDetails = null;
      try { errorDetails = extractAllErrors(JSON.parse(text)); } catch {}
      return { ok: false, status: res.status, errorDetails, rawBody: text.slice(0, 2500), payloadSent: payload };
    }
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { return { ok: false, parseError: true, status: 200, rawBody: text.slice(0, 1000), payloadSent: payload }; }
    return { ok: true, parsed };
  }

  const norm = v => String(v == null ? "" : v).trim();
  const allHaveAlt = p.lines.every(l => norm(l.alternateId));

  // 1) Try creating with InventoryID + AlternateID together in one payload.
  let attempt = null, method = null, createAltError = null;
  if (allHaveAlt) {
    const a = await putCreate(detailsByBoth());
    if (a.ok) { attempt = a; method = "both"; }
    else { createAltError = { status: a.status, errorDetails: a.errorDetails, rawBody: a.rawBody, networkError: a.networkError }; }
  } else {
    createAltError = { reason: "not-all-lines-have-an-ndc" };
  }

  // 2) Fall back to InventoryID-only create if the combined create was rejected.
  if (!attempt) {
    const b = await putCreate(detailsByInventory());
    if (!b.ok) {
      return {
        ok: false, stage: "create-po",
        status: b.status, errorDetails: b.errorDetails, rawBody: b.rawBody, error: b.networkError,
        createAltError: createAltError || undefined,
        payloadSent: b.payloadSent
      };
    }
    attempt = b; method = "inventory";
  }

  const created = attempt.parsed;
  const details = Array.isArray(created?.Details) ? created.Details : [];

  // Self-diagnosing readback: what each line actually ended up with.
  const lineResults = details.map(d => ({
    inventoryID: d?.InventoryID?.value,
    alternateID: d?.AlternateID?.value,
    orderQty:    d?.OrderQty?.value,
    uom:         d?.UOM?.value
  }));

  return {
    ok: true,
    id: created?.id,
    orderNbr: created?.OrderNbr?.value,
    status: created?.Status?.value,
    hold: created?.Hold?.value,
    lineCount: details.length,
    orderTotal: created?.OrderTotal?.value,
    method,
    createAltError: (method === "inventory" && createAltError) ? createAltError : undefined,
    lineResults
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Walks Acumatica's error response shape and collects every error message found.
// Acumatica returns errors in several places: top-level error, exceptionMessage,
// modelState errors keyed by field path, and per-field error objects.
function extractAllErrors(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const errors = [];
  if (typeof parsed.message === "string") errors.push({ scope: "top", message: parsed.message });
  if (typeof parsed.exceptionMessage === "string") errors.push({ scope: "exception", message: parsed.exceptionMessage });
  if (parsed.modelState && typeof parsed.modelState === "object") {
    Object.keys(parsed.modelState).forEach(k => {
      const v = parsed.modelState[k];
      if (Array.isArray(v)) v.forEach(m => errors.push({ scope: "modelState", field: k, message: String(m) }));
      else errors.push({ scope: "modelState", field: k, message: String(v) });
    });
  }
  // Per-field error: { "FieldName": { "value": "...", "error": "Required" } }
  walkForFieldErrors(parsed, "", errors);
  if (errors.length === 0 && typeof parsed.error === "string") {
    errors.push({ scope: "wrapper", message: parsed.error });
  }
  return errors;
}

function walkForFieldErrors(obj, path, out) {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => walkForFieldErrors(item, `${path}[${i}]`, out));
    return;
  }
  if (typeof obj.error === "string" && obj.error) {
    out.push({ scope: "field", field: path || "(root)", message: obj.error });
  }
  Object.keys(obj).forEach(k => {
    if (k === "error") return;
    walkForFieldErrors(obj[k], path ? `${path}.${k}` : k, out);
  });
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
