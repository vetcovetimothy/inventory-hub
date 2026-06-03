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
        lineResults: result.lineResults,
        altUpdatesAttempted: result.altUpdatesAttempted,
        altSkipped: result.altSkipped,
        altUpdateError: result.altUpdateError
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
//   Step 1. Create the PO from InventoryID (clean, guaranteed-valid lines).
//           Acumatica stamps each line's AlternateID with the item's DEFAULT
//           cross-reference NDC at this point.
//   Step 2. For each created line whose AlternateID is not already the NDC we
//           ordered against (line.alternateId), set it via an update-by-id PUT
//           — the same pattern the line-removal route uses. This mirrors a user
//           changing the Alternate ID dropdown on the line by hand.
//   Step 3. Read the lines back and report what actually landed, so we can see
//           whether the NDC stuck or Acumatica reverted it to the default.
async function createOnePO(cookies, p) {
  const url = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder?$expand=Details`;

  const payload = {
    VendorID:    { value: String(p.vendorId) },
    Location:    { value: String(p.location) },
    Branch:      { value: BRANCH },
    Hold:        { value: false },                  // Open immediately
    VendorRef:   { value: String(p.vendorRef) },
    Description: { value: String(p.description || "") },
    Details: p.lines.map(line => ({
      BranchID:    { value: BRANCH },
      InventoryID: { value: String(line.inventoryId) },
      WarehouseID: { value: String(line.warehouse) },
      OrderQty:    { value: Number(line.orderQty) },
      UOM:         { value: String(line.uom) },
      UnitCost:    { value: Number(line.unitCost) || 0 }
    }))
  };

  let res, text;
  try {
    res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Cookie": cookies
      },
      body: JSON.stringify(payload)
    });
    text = await res.text();
  } catch (err) {
    return { ok: false, stage: "create-po", error: String(err), payloadSent: payload };
  }

  if (!res.ok) {
    let errorDetails = null;
    try {
      const parsed = JSON.parse(text);
      errorDetails = extractAllErrors(parsed);
    } catch {}
    return {
      ok: false,
      stage: "create-po",
      status: res.status,
      errorDetails,
      rawBody: text.slice(0, 2500),
      payloadSent: payload
    };
  }

  let created;
  try {
    created = JSON.parse(text);
  } catch {
    return { ok: false, stage: "parse-create-response", status: 200, rawBody: text.slice(0, 1000), payloadSent: payload };
  }

  const orderNbr  = created?.OrderNbr?.value;
  const orderType = created?.Type?.value || "Normal";
  const createdDetails = Array.isArray(created?.Details) ? created.Details : [];

  // ── Step 2: set the line AlternateID (NDC) where it isn't already correct ──
  const norm = v => String(v == null ? "" : v).trim();
  const altUpdates = [];
  const altSkipped = [];
  createdDetails.forEach((d, i) => {
    const inLine = p.lines[i];
    if (!inLine) return;
    const wantNdc = norm(inLine.alternateId);
    if (!wantNdc) return;                                  // no NDC to set for this line
    const lineInv = norm(d?.InventoryID?.value);
    const wantInv = norm(inLine.inventoryId);
    // Safety: only touch a line whose resolved item matches what we sent
    if (wantInv && lineInv && wantInv.toUpperCase() !== lineInv.toUpperCase()) {
      altSkipped.push({ index: i, reason: "inventory-mismatch", expected: wantInv, got: lineInv });
      return;
    }
    if (norm(d?.AlternateID?.value) === wantNdc) return;   // already correct (NDC is the default)
    if (!d?.id) { altSkipped.push({ index: i, reason: "no-line-id" }); return; }
    altUpdates.push({ id: d.id, AlternateID: { value: wantNdc } });
  });

  let altUpdateError = null;
  let finalDetails = createdDetails;
  if (altUpdates.length > 0) {
    const updatePayload = {
      id: created?.id,
      OrderType: { value: orderType },
      OrderNbr:  { value: orderNbr },
      Details: altUpdates
    };
    try {
      const ures = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Cookie": cookies
        },
        body: JSON.stringify(updatePayload)
      });
      const utext = await ures.text();
      if (!ures.ok) {
        let ed = null;
        try { ed = extractAllErrors(JSON.parse(utext)); } catch {}
        altUpdateError = { status: ures.status, errorDetails: ed, rawBody: utext.slice(0, 1500) };
      } else {
        try {
          const u = JSON.parse(utext);
          if (Array.isArray(u?.Details)) finalDetails = u.Details;
        } catch {}
      }
    } catch (err) {
      altUpdateError = { error: String(err) };
    }
  }

  // ── Step 3: self-diagnosing readback — what each line actually ended up with
  const lineResults = finalDetails.map(d => ({
    inventoryID: d?.InventoryID?.value,
    alternateID: d?.AlternateID?.value,
    orderQty:    d?.OrderQty?.value,
    uom:         d?.UOM?.value
  }));

  return {
    ok: true,
    id: created?.id,
    orderNbr,
    status: created?.Status?.value,
    hold: created?.Hold?.value,
    lineCount: finalDetails.length,
    orderTotal: created?.OrderTotal?.value,
    lineResults,
    altUpdatesAttempted: altUpdates.length,
    altSkipped: altSkipped.length ? altSkipped : undefined,
    altUpdateError: altUpdateError || undefined
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
