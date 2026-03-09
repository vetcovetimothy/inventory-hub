/**
 * POST /api/acumatica
 *
 * Proxies requests to Acumatica OData endpoints.
 * The browser can't call Acumatica directly (CORS), so this
 * serverless function does it on behalf of the frontend.
 *
 * Body: { type: "po" | "short-dating" | "backorder", warehouse?: string, username: string, password: string }
 */

const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const PREFIX = process.env.ACUMATICA_ODATA_PREFIX || "/(W(89))/odata/VetCove";

// OData view names — match whatever is configured in your Acumatica instance
const ENDPOINTS = {
  "po":            "PURCH%20-%20TP%20PO%20Export%20with%20Replen",
  "po-ggm":        "PURCH%20-%20Export%20PO%20Lines%20GGM",
  "ndc-lookup":    "PURCH%20-%20Generic%20Current%20NDCs",
  "short-dating":  "INV%20-%20Short-Dating%20Tracker",
  "backorder":     "INV%20-%20Backorder%20Item%20Review",
};

// Which columns to extract for each type (keyGroup = possible OData field names)
const COLUMN_MAP = {
  "po": [
    { label: "SKUNDC",        keys: ["SKUNDC", "SkuNDC", "SKU_NDC"] },
    { label: "Description",   keys: ["Description", "Descr"] },
    { label: "OrderQty",      keys: ["OrderQty", "SuggestedQty"] },
    { label: "VendorName",    keys: ["VendorName"] },
    { label: "OrderNbr",      keys: ["OrderNbr", "PONbr"] },
    { label: "Warehouse",     keys: ["Warehouse", "WarehouseID"] },
    { label: "ReorderPoint",  keys: ["ReorderPoint", "ReorderPt"] },
    { label: "MaxQty",        keys: ["MaxQty"] },
    { label: "LeadTime",      keys: ["LeadTime", "LeadTimeDays", "VendorLeadTimeDays"] },
    { label: "MinOrderQty",   keys: ["MinOrderQty"] },
    { label: "QtyAvailable",  keys: ["QtyAvailable", "QtyAvail"] },
    { label: "Price",         keys: ["Price", "UnitCost", "LastCost"] },
    { label: "MovementClass", keys: ["MovementClass", "MovementClassDescr"] },
  ],
  "po-ggm": [
    { label: "SKUNDC",        keys: ["SKUNDC", "SkuNDC", "SKU_NDC", "InventoryID", "InventoryCd", "InventoryCD"] },
    { label: "Description",   keys: ["Description", "Descr", "ItemDescription", "TranDesc", "InventoryDescription", "LineDescription"] },
    { label: "OrderQty",      keys: ["OrderQty", "Order Qty", "Qty", "Quantity"] },
    { label: "VendorName",    keys: ["VendorName", "Vendor", "Vendor Name"] },
    { label: "OrderNbr",      keys: ["OrderNbr", "Order Nbr.", "OrderNbr."] },
    { label: "Warehouse",     keys: ["Warehouse", "WarehouseID", "WarehouseId"] },
    { label: "ReorderPoint",  keys: ["ReorderPoint"] },
    { label: "MaxQty",        keys: ["MaxQty"] },
    { label: "LeadTime",      keys: ["VendorLeadTimeDays", "LeadTime", "LeadTimeDays"] },
    { label: "MinOrderQty",   keys: ["MinOrderQty"] },
    { label: "QtyAvailable",  keys: ["QtyAvailable", "QtyAvail"] },
    { label: "Price",         keys: ["Price", "UnitCost", "LastCost"] },
    { label: "MovementClass", keys: ["MovementClass", "Movement Class"] },
  ],
  "ndc-lookup": [
    { label: "InventoryID",   keys: ["InventoryID", "InventoryId", "InventoryCd", "InventoryCD"] },
    { label: "AlternateID",   keys: ["AlternateID", "AlternateId", "NDC", "Ndc", "SKUNDC", "SkuNDC", "UsrSKUNDC", "SKU_NDC"] },
    { label: "Description",   keys: ["Description", "Descr", "ItemDescription"] },
  ],
  "short-dating": [
    { label: "ItemStatus",      keys: ["ItemStatus", "Status"] },
    { label: "MovementClass",   keys: ["MovementClass"] },
    { label: "Description",     keys: ["Description", "Descr"] },
    { label: "VendorName",      keys: ["VendorName"] },
    { label: "InventoryID",     keys: ["InventoryID", "InventoryCd", "InventoryCD"] },
    { label: "SKUNDC",          keys: ["SKUNDC", "SkuNDC", "UsrSKUNDC"] },
    { label: "BestKnownDating", keys: ["BestKnownDating", "BestDating", "ExpirationDate"] },
    { label: "NoteText",        keys: ["NoteText", "Note"] },
    { label: "QtyOnHand",       keys: ["QtyOnHand", "QtyAvail"] },
    { label: "BaseUnit",        keys: ["BaseUnit", "UOM", "BaseUOM"] },
    { label: "OpenQty",         keys: ["OpenQty"] },
  ],
  "backorder": [
    { label: "ItemStatus",      keys: ["ItemStatus", "Status"] },
    { label: "MovementClass",   keys: ["MovementClass", "MovementClassDescr"] },
    { label: "Description",     keys: ["Description", "Descr"] },
    { label: "PreferredVendor", keys: ["PreferredVendor", "PreferredVendorID"] },
    { label: "VendorName",      keys: ["VendorName"] },
    { label: "InventoryID",     keys: ["InventoryID", "InventoryCd", "InventoryCD"] },
    { label: "SKUNDC",          keys: ["SKUNDC", "SkuNDC", "UsrSKUNDC"] },
    { label: "BaseUnit",        keys: ["BaseUnit", "UOM", "BaseUOM"] },
    { label: "QtyOnHand",       keys: ["QtyOnHand", "QtyAvail"] },
    { label: "OpenQty",         keys: ["OpenQty", "OpenQtyBackordered"] },
    { label: "RecoveryDate",    keys: ["RecoveryDate", "EstimatedRecoveryDate"] },
  ],
};

export async function POST(request) {
  try {
    const body = await request.json();
    const { type, warehouse, username, password, useServiceAccount } = body;

    if (!type || !ENDPOINTS[type]) {
      return Response.json({ error: "Invalid type. Use: po, po-ggm, ndc-lookup, short-dating, backorder" }, { status: 400 });
    }

    // Use service account credentials from env vars, or user-provided credentials
    let authUser, authPass;
    if (useServiceAccount) {
      authUser = process.env.ACUMATICA_SERVICE_USER;
      authPass = process.env.ACUMATICA_SERVICE_PASS;
      if (!authUser || !authPass) {
        return Response.json({ error: "Service account not configured" }, { status: 500 });
      }
    } else {
      authUser = username;
      authPass = password;
      if (!authUser || !authPass) {
        return Response.json({ error: "Missing credentials" }, { status: 401 });
      }
    }

    // Build OData URL
    let url = `${BASE}${PREFIX}/${ENDPOINTS[type]}`;

    // For PO fetches, filter by warehouse if provided
    if ((type === "po" || type === "po-ggm") && warehouse) {
      url += `?$filter=Warehouse eq '${warehouse}'`;
    }

    // Call Acumatica
    const authHeader = "Basic " + Buffer.from(authUser + ":" + authPass).toString("base64");
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": authHeader,
        "Accept": "application/json",
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      return Response.json(
        { error: `Acumatica returned ${resp.status}`, detail: text.slice(0, 500) },
        { status: resp.status }
      );
    }

    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return Response.json(
        { error: "Expected JSON from Acumatica, got: " + contentType },
        { status: 502 }
      );
    }

    const json = await resp.json();
    const rawRows = json.value || [];

    if (rawRows.length === 0) {
      return Response.json({ data: [], count: 0 });
    }

    // Resolve column names (Acumatica field names vary between instances)
    const sample = rawRows.find(r => r && Object.keys(r).length) || rawRows[0];
    const colDefs = COLUMN_MAP[type] || [];
    const resolved = colDefs.map(col => {
      const found = col.keys.find(k => k in sample);
      return { label: col.label, key: found || null };
    });

    // Map rows to normalized objects
    const data = rawRows.map(row => {
      const obj = {};
      for (const col of resolved) {
        let val = col.key ? row[col.key] : "";
        if (val == null) val = "";
        // Clean up Inventory IDs (strip whitespace)
        if (col.label === "InventoryID" && typeof val === "string") {
          val = val.replace(/\s+/g, "");
        }
        obj[col.label] = val;
      }
      return obj;
    });

    return Response.json({ data, count: data.length });
  } catch (err) {
    console.error("Acumatica proxy error:", err);
    return Response.json({ error: "Server error", detail: err.message }, { status: 500 });
  }
}
