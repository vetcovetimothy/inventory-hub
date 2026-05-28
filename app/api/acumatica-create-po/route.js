/**
 * POST /api/acumatica-create-po
 *
 * Creates one or more Purchase Orders in Acumatica for the Truckloader workflow.
 *
 * Body:
 *   {
 *     username: string,        // Acumatica username
 *     password: string,        // Acumatica password
 *     warehouse: string,       // Truckloader warehouse code, e.g. "HILL-CP-CA"
 *     trucks: [                // 1+ trucks; each becomes one PO
 *       {
 *         label: string,       // e.g. "Truck 1" - used in PO Description
 *         lines: [
 *           { inventoryID: string, orderQty: number }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Behavior:
 *   - Logs in once, processes all trucks, logs out.
 *   - For each truck:
 *       1. PUT a new PurchaseOrder (Hold=true, VendorID=VID0024 (Hill's))
 *       2. Read OrderNbr from the response.
 *       3. PUT the same PO again to set VendorRef = OrderNbr.
 *   - STOPS on first failure. Returns which trucks succeeded and which failed.
 *
 * Safety:
 *   - All POs created with Hold=true. They cannot release, print, or email
 *     until a human reviews and clicks Remove Hold in Acumatica.
 *   - On failure mid-batch, prior POs remain in Acumatica (on hold) and are
 *     reported so the user can delete or release them.
 */

const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";

// Vetcove's Hill's vendor record. The integration is Hill's-specific by design;
// if other vendors are added later, this becomes a per-warehouse or per-truck setting.
const HILLS_VENDOR_ID = "VID0024";

// Warehouse → vendor Location mapping.
// At Vetcove, the Hill's vendor Location code equals the warehouse code
// (confirmed against PO008480 + PO008568). Add TX/FL when they go live in Acumatica.
const WAREHOUSE_TO_LOCATION = {
  "HILL-CP-CA": "HILL-CP-CA",
  "HILL-CP-NJ": "HILL-CP-NJ"
  // "HILL-CP-TX": "HILL-CP-TX",  // not yet in Acumatica
  // "HILL-CP-FL": "HILL-CP-FL",  // not yet in Acumatica
};

// Branch to charge the POs to. Matches the existing Hill's POs at Vetcove.
const BRANCH = "VETCOVE";

// Warehouse code → short location code used in the PO Description.
// e.g. "HILL-CP-CA" → "CA". Description becomes "CA Truck 1".
function shortCodeFor(warehouse) {
  const m = /HILL-CP-([A-Z]{2})$/.exec(warehouse || "");
  return m ? m[1] : warehouse;
}

export async function POST(req) {
  // ── Parse and validate input ────────────────────────────────────────────
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

  // ── Process trucks one at a time, stop on first failure ─────────────────
  const succeeded = [];
  let failure = null;

  for (let i = 0; i < trucks.length; i++) {
    const truck = trucks[i];
    const description = `${shortCode} ${truck.label}`;

    // Step A: create the PO with all lines
    const createResult = await createOnePO(cookies, {
      location, warehouse, truckLabel: truck.label, description, lines: truck.lines
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

    // Step B: set VendorRef = the new OrderNbr
    const refResult = await setVendorRef(cookies, createResult.orderNbr);

    if (!refResult.ok) {
      failure = {
        truckIndex: i,
        truckLabel: truck.label,
        stage: "set-vendor-ref",
        partialPO: {
          orderNbr: createResult.orderNbr,
          note: "PO was created but VendorRef was not set. You can set it manually in Acumatica."
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
// Create ONE purchase order with all its lines
// ─────────────────────────────────────────────────────────────────────────
async function createOnePO(cookies, { location, warehouse, truckLabel, description, lines }) {
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
    // Try to extract per-line errors from Acumatica's response body
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
    orderNbr: parsed?.OrderNbr?.value,
    status: parsed?.Status?.value,
    hold: parsed?.Hold?.value,
    lineCount: Array.isArray(parsed?.Details) ? parsed.Details.length : 0,
    orderTotal: parsed?.OrderTotal?.value
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Set VendorRef on an existing PO to equal its OrderNbr
// ─────────────────────────────────────────────────────────────────────────
async function setVendorRef(cookies, orderNbr) {
  if (!orderNbr) {
    return { ok: false, status: 0, rawBody: "createOnePO returned no OrderNbr" };
  }
  // PUT with the key fields identifies the existing PO; we only need to send what changes.
  const url = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder`;
  const payload = {
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
    return { ok: false, status: res.status, rawBody: text.slice(0, 1500) };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Extract any per-line errors from Acumatica's error response body
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

// ─────────────────────────────────────────────────────────────────────────
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
