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

// Warehouse → vendor Location mapping (1:1 at Vetcove)
const WAREHOUSE_TO_LOCATION = {
  "HILL-CP-CA": "HILL-CP-CA",
  "HILL-CP-NJ": "HILL-CP-NJ"
  // "HILL-CP-TX": "HILL-CP-TX",  // not yet in Acumatica
  // "HILL-CP-FL": "HILL-CP-FL",  // not yet in Acumatica
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
  const succeeded = [];
  let failure = null;

  for (let i = 0; i < trucks.length; i++) {
    const truck = trucks[i];
    const description = `${shortCode} ${truck.label}`;

    // Step A: create the PO
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

    // Step B: set VendorRef = OrderNbr using the id we just got
    const refResult = await setVendorRefById(cookies, createResult.id, createResult.orderNbr);

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

  await logout(cookies);

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
// Create ONE purchase order with all its lines. Returns the id GUID too.
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
      errorDetails = extractLineErrors(parsed);
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
// Update an existing PO's VendorRef using its id GUID.
// PUT /PurchaseOrder/{id} treats the call as an update, not a create.
// ─────────────────────────────────────────────────────────────────────────
async function setVendorRefById(cookies, id, orderNbr) {
  if (!id) {
    return { ok: false, status: 0, rawBody: "createOnePO returned no id" };
  }
  if (!orderNbr) {
    return { ok: false, status: 0, rawBody: "createOnePO returned no OrderNbr" };
  }

  const url = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder/${id}`;
  const payload = {
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
    return { ok: false, status: res.status, rawBody: text.slice(0, 1500) };
  }

  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  return { ok: true, vendorRef: parsed?.VendorRef?.value };
}

// ─────────────────────────────────────────────────────────────────────────
function extractLineErrors(parsed) {
  const errors = [];
  if (parsed?.error) errors.push({ scope: "header", message: parsed.error });
  if (Array.isArray(parsed?.Details)) {
    parsed.Details.forEach((d, idx) => {
      Object.keys(d || {}).forEach(k => {
        const v = d[k];
        if (v && typeof v === "object" && v.error) {
          errors.push({
            scope: "line",
            lineIndex: idx,
            inventoryID: d?.InventoryID?.value,
            field: k,
            message: v.error
          });
        }
      });
    });
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
