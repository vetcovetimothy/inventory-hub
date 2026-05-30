/**
 * POST /api/acumatica-create-po
 *
 * Creates one or more Purchase Orders in Acumatica for the Truckloader workflow.
 *
 * Body:
 *   {
 *     username, password,
 *     warehouse: string,                    // e.g. "HILL-CP-CA"
 *     trucks: [
 *       { label: string, lines: [ { inventoryID, orderQty } ] }
 *     ]
 *   }
 *
 * Behavior:
 *   - Logs in once. For each truck: create PO (Hold=true), then set VendorRef=OrderNbr.
 *   - STOPS on first failure. Returns which trucks succeeded, which failed, and why.
 *
 * Safety: All POs created with Hold=true.
 */

const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";

const HILLS_VENDOR_ID = "VID0024";

const WAREHOUSE_TO_LOCATION = {
  "HILL-CP-CA": "MAIN",          // CA uses the "Primary Location" / MAIN code on the vendor
  "HILL-CP-NJ": "HILL-CP-NJ",
  "HILL-CP-FL": "HILL-CP-FL",
  "HILL-CP-TX": "HILL-CP-TX"
};

const BRANCH = "VETCOVE";

function shortCodeFor(warehouse) {
  const m = /HILL-CP-([A-Z]{2})$/.exec(warehouse || "");
  return m ? m[1] : warehouse;
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, stage: "parse-body", error: "Invalid JSON body" });
  }

  const { username, password, warehouse, trucks } = body || {};
  if (!username || !password) {
    return json({ ok: false, stage: "validate-input", error: "username and password required" });
  }
  if (!warehouse || !WAREHOUSE_TO_LOCATION[warehouse]) {
    return json({
      ok: false,
      stage: "validate-input",
      error: `warehouse '${warehouse}' is not mapped. Known: ${Object.keys(WAREHOUSE_TO_LOCATION).join(", ")}`
    });
  }
  if (!Array.isArray(trucks) || trucks.length === 0) {
    return json({ ok: false, stage: "validate-input", error: "trucks must be a non-empty array" });
  }
  for (let i = 0; i < trucks.length; i++) {
    const t = trucks[i];
    if (!t || !t.label || !Array.isArray(t.lines) || t.lines.length === 0) {
      return json({
        ok: false,
        stage: "validate-input",
        error: `truck[${i}] must have label and non-empty lines[]`
      });
    }
  }

  const location = WAREHOUSE_TO_LOCATION[warehouse];
  const shortCode = shortCodeFor(warehouse);

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

  // ── Process trucks ──────────────────────────────────────────────────────
  // Wrapped in try/finally so logout always fires even on uncaught exceptions.
  // Without this, an error mid-loop leaks the session against the user's
  // concurrent login limit until Acumatica times it out.
  const succeeded = [];
  let failure = null;

  try {
    for (let i = 0; i < trucks.length; i++) {
      const truck = trucks[i];
      const description = `${shortCode} ${truck.label}`;

      const createResult = await createOnePO(cookies, {
        location, warehouse, description, lines: truck.lines
      });

      if (!createResult.ok) {
        failure = {
          truckIndex: i,
          truckLabel: truck.label,
          stage: createResult.stage,
          status: createResult.status,
          errorDetails: createResult.errorDetails,
          rawBody: createResult.rawBody,
          payloadSent: createResult.payloadSent
        };
        break;
      }

      const refResult = await setVendorRef(cookies, {
        id: createResult.id,
        orderNbr: createResult.orderNbr
      });

      if (!refResult.ok) {
        failure = {
          truckIndex: i,
          truckLabel: truck.label,
          stage: "set-vendor-ref",
          partialPO: {
            orderNbr: createResult.orderNbr,
            note: "PO was created but VendorRef was not set. Set it manually in Acumatica, or delete the PO and re-run."
          },
          status: refResult.status,
          errorDetails: refResult.errorDetails,
          rawBody: refResult.rawBody
        };
        break;
      }

      succeeded.push({
        truckIndex: i,
        truckLabel: truck.label,
        orderNbr: createResult.orderNbr,
        vendorRefSet: refResult.vendorRef,
        status: createResult.status,
        hold: createResult.hold,
        lineCount: createResult.lineCount,
        orderTotal: createResult.orderTotal
      });
    }
  } finally {
    await logout(cookies);
  }

  return json({
    ok: failure === null,
    stage: failure === null ? "all-done" : "stopped-on-failure",
    warehouse,
    location,
    shortCode,
    succeeded,
    failure
  });
}

// ─────────────────────────────────────────────────────────────────────────
async function createOnePO(cookies, { location, warehouse, description, lines }) {
  const url = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder?$expand=Details`;

  const payload = {
    VendorID:    { value: HILLS_VENDOR_ID },
    Location:    { value: location },
    Branch:      { value: BRANCH },
    Hold:        { value: true },
    Description: { value: description },
    Details: lines.map(line => ({
      BranchID:    { value: BRANCH },
      InventoryID: { value: String(line.inventoryID) },
      WarehouseID: { value: warehouse },
      OrderQty:    { value: Number(line.orderQty) }
    }))
  };

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Cookie": cookies
    },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
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

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, stage: "parse-create-response", status: 200, rawBody: text.slice(0, 1000), payloadSent: payload };
  }

  return {
    ok: true,
    id: parsed?.id,
    orderNbr: parsed?.OrderNbr?.value,
    status: parsed?.Status?.value,
    hold: parsed?.Hold?.value,
    lineCount: Array.isArray(parsed?.Details) ? parsed.Details.length : 0,
    orderTotal: parsed?.OrderTotal?.value
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Update VendorRef on an existing PO.
// PUT to the base entity URL with `id` in the body = update mode.
// `id` is required so Acumatica knows we're updating, not creating.
// ─────────────────────────────────────────────────────────────────────────
async function setVendorRef(cookies, { id, orderNbr }) {
  if (!id) return { ok: false, status: 0, rawBody: "createOnePO returned no id" };
  if (!orderNbr) return { ok: false, status: 0, rawBody: "createOnePO returned no OrderNbr" };

  const url = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder`;
  const payload = {
    id: id,
    OrderType: { value: "Normal" },
    OrderNbr:  { value: orderNbr },
    VendorRef: { value: orderNbr }
  };

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Cookie": cookies
    },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  if (!res.ok) {
    let errorDetails = null;
    try {
      const parsed = JSON.parse(text);
      errorDetails = extractAllErrors(parsed);
    } catch {}
    return { ok: false, status: res.status, errorDetails, rawBody: text.slice(0, 1500) };
  }
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  return { ok: true, vendorRef: parsed?.VendorRef?.value };
}

// ─────────────────────────────────────────────────────────────────────────
// Walk the entire response body and pull out every embedded `error` property.
// Acumatica puts errors on individual fields (both header and line) in addition
// to a generic top-level wrapper. We surface all of them so the UI can show
// the specific field that failed (e.g. "Location 'HILL-CP-CA' cannot be found"),
// not just the generic wrapper.
function extractAllErrors(parsed) {
  const errors = [];
  if (!parsed || typeof parsed !== "object") return errors;

  // Header-level field errors: walk top-level keys for { value, error } shapes.
  Object.keys(parsed).forEach(k => {
    if (k === "Details" || k === "_links" || k === "custom") return;
    const v = parsed[k];
    if (v && typeof v === "object" && typeof v.error === "string") {
      errors.push({
        scope: "header",
        field: k,
        value: v.value,
        message: v.error
      });
    }
  });

  // Line-level errors: same walk inside each detail row.
  if (Array.isArray(parsed.Details)) {
    parsed.Details.forEach((d, idx) => {
      Object.keys(d || {}).forEach(k => {
        const v = d[k];
        if (v && typeof v === "object" && typeof v.error === "string") {
          errors.push({
            scope: "line",
            lineIndex: idx,
            inventoryID: d?.InventoryID?.value,
            field: k,
            value: v.value,
            message: v.error
          });
        }
      });
    });
  }

  // Only add the generic wrapper if we found NO specific field errors —
  // otherwise it's just noise on top of the real messages.
  if (errors.length === 0 && typeof parsed.error === "string") {
    errors.push({ scope: "wrapper", message: parsed.error });
  }

  return errors;
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
