/**
 * POST /api/acumatica-po-test
 *
 * Acumatica contract-based REST API tester.
 *
 * Body:
 *   { username, password }                          — reads first PO (any vendor)
 *   { username, password, vendorID }                — reads first PO for vendor with details
 *   { username, password, mode: "create-test-po" }  — creates ONE held test PO for Hill's
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

  const { username, password, vendorID, mode } = body || {};
  if (!username || !password) {
    return json({ ok: false, stage: "validate-input", error: "username and password required" });
  }

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

  let result;
  try {
    if (mode === "create-test-po") {
      result = await createTestPO(cookies);
    } else if (vendorID) {
      result = await readPOByVendor(cookies, vendorID);
    } else {
      result = await readAnyPO(cookies);
    }
  } catch (err) {
    await logout(cookies);
    return json({ ok: false, stage: "operation", error: String(err) });
  }

  await logout(cookies);
  return json(result);
}

// ─────────────────────────────────────────────────────────────────────────
// CREATE: a single held test PO for Hill's
// Values match the recent real PO008480 to minimize variables.
// ─────────────────────────────────────────────────────────────────────────
async function createTestPO(cookies) {
  const url = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder?$expand=Details`;

  const payload = {
    VendorID: { value: "VID0024" },
    Location: { value: "HILL-CP-NJ" },
    Branch:   { value: "VETCOVE" },
    Hold:     { value: true },
    Description: { value: "TEST PO via Inventory Hub — safe to delete" },
    Details: [
      {
        BranchID:    { value: "VETCOVE" },
        InventoryID: { value: "10404" },
        WarehouseID: { value: "HILL-CP-NJ" },
        OrderQty:    { value: 1 },
        UOM:         { value: "BAG" }
      }
    ]
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
    return {
      ok: false,
      stage: "create-po",
      status: res.status,
      statusText: res.statusText,
      payloadSent: payload,
      body: text.slice(0, 2500)
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, stage: "parse-create-response", body: text.slice(0, 1000) };
  }

  return {
    ok: true,
    stage: "create-po-done",
    apiVersion: API_VERSION,
    created: {
      OrderNbr: parsed?.OrderNbr?.value,
      Type: parsed?.Type?.value,
      Status: parsed?.Status?.value,
      Hold: parsed?.Hold?.value,
      VendorID: parsed?.VendorID?.value,
      Location: parsed?.Location?.value,
      Branch: parsed?.Branch?.value,
      Date: parsed?.Date?.value,
      LineTotal: parsed?.LineTotal?.value,
      Details: Array.isArray(parsed?.Details) ? parsed.Details.map(d => ({
        LineNbr: d?.LineNbr?.value,
        InventoryID: d?.InventoryID?.value,
        WarehouseID: d?.WarehouseID?.value,
        OrderQty: d?.OrderQty?.value,
        UOM: d?.UOM?.value,
        UnitCost: d?.UnitCost?.value,
        ExtendedCost: d?.ExtendedCost?.value,
        OrderType: d?.OrderType?.value,
        LineType: d?.LineType?.value
      })) : []
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────
async function readPOByVendor(cookies, vendorID) {
  const filter = encodeURIComponent(`VendorID eq '${vendorID}'`);
  const url = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder?$filter=${filter}&$top=1&$expand=Details`;
  return await readAndSummarize(cookies, url);
}

async function readAnyPO(cookies) {
  const url = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder?$top=1`;
  return await readAndSummarize(cookies, url);
}

async function readAndSummarize(cookies, url) {
  const res = await fetch(url, {
    method: "GET",
    headers: { "Accept": "application/json", "Cookie": cookies }
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, stage: "read-po", status: res.status, body: text.slice(0, 1000) };
  }
  const data = JSON.parse(text);
  const first = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (!first) return { ok: true, stage: "done", note: "No POs returned", queryUrl: url };

  const headerValues = {};
  Object.keys(first).forEach(k => {
    const v = first[k];
    if (v && typeof v === "object" && "value" in v) headerValues[k] = v.value;
  });
  const details = Array.isArray(first.Details) ? first.Details.map(d => {
    const out = {};
    Object.keys(d).forEach(k => {
      const v = d[k];
      if (v && typeof v === "object" && "value" in v) out[k] = v.value;
    });
    return out;
  }) : [];

  return {
    ok: true,
    stage: "done",
    apiVersion: API_VERSION,
    queryUrl: url,
    headerValues,
    detailLineCount: details.length,
    firstDetailValues: details[0] || null
  };
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
