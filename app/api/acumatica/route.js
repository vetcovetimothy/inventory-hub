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
const PREFIX = process.env.ACUMATICA_ODATA_PREFIX || "/odata/VetCove";

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
    { label: "SKUNDC",        keys: ["SKUNDC", "SkuNDC", "SKU_NDC", "SKU/NDC", "SKU", "NDC", "InventoryID", "InventoryId", "InventoryCd", "InventoryCD", "ItemID", "ItemId", "Inventory ID"] },
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
    { label: "UOM",           keys: ["UOM", "Uom", "BaseUnit", "BaseUOM"] },
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

    // For PO fetches, filter by warehouse in OData
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
    let rawRows = json.value || [];
    let debugInfo = null;

    // For PO fetches, filter to today's date only and exclude certain vendors
    if ((type === "po" || type === "po-ggm") && rawRows.length > 0) {
      // Get today in US Eastern time (Acumatica's likely timezone)
      const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const todayStr = nowET.getFullYear() + "-" + String(nowET.getMonth() + 1).padStart(2, "0") + "-" + String(nowET.getDate()).padStart(2, "0");

      const dateKeys = ["Date", "OrderDate", "TranDate", "DocumentDate", "DocDate"];
      const vendorKeys = ["VendorName", "Vendor", "Vendor Name"];

      // Debug: track why rows are filtered
      const debug = { today: todayStr, type, totalRaw: rawRows.length, kept: 0, filteredDate: 0, filteredVendor: 0, vendors: {} };

      rawRows = rawRows.filter(row => {
        // Find vendor name
        let vendorName = "";
        for (const k of vendorKeys) { if (row[k]) { vendorName = String(row[k]).toLowerCase(); break; } }
        
        // Track all vendors seen
        const vKey = vendorName || "(empty)";
        if (!debug.vendors[vKey]) debug.vendors[vKey] = { total: 0, kept: 0, filteredDate: 0, filteredVendor: 0 };
        debug.vendors[vKey].total++;

        // Find and check date value
        let dateVal = null;
        for (const k of dateKeys) { if (row[k] != null) { dateVal = row[k]; break; } }
        if (dateVal) {
          const dateStr = String(dateVal).slice(0, 10);
          if (dateStr !== todayStr) { debug.filteredDate++; debug.vendors[vKey].filteredDate++; return false; }
        }

        // Exclude certain vendors (GGM-KY keeps Vetcove Generics)
        if (vendorName.includes("truepill") || vendorName.includes("bloodworth")) { debug.filteredVendor++; debug.vendors[vKey].filteredVendor++; return false; }
        if (vendorName.includes("vetcove generics") && type !== "po-ggm") { debug.filteredVendor++; debug.vendors[vKey].filteredVendor++; return false; }

        debug.kept++;
        debug.vendors[vKey].kept++;
        return true;
      });

      debugInfo = debug;
    }

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

    return Response.json({ data, count: data.length, _debug: debugInfo });
  } catch (err) {
    console.error("Acumatica proxy error:", err);
    return Response.json({ error: "Server error", detail: err.message }, { status: 500 });
  }
}
