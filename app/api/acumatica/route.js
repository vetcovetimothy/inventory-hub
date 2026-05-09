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
  "item-xref":     "ITEM%20-%20Non-Stock%20Cross%20Reference",
  "short-dating":  "INV%20-%20Short-Dating%20Tracker",
  "backorder":     "INV%20-%20Backorder%20Item%20Review",
  "hills-pawtree": "PURCH%20-%20Open%20Hills%20and%20Pawtree",
  "replenishment-needs": "PURCH%20-%20Replenishment%20Needs%20-%20Hills",
  "whse-replenish": "Stock%20Item%20Whse%20Replenish",
  "gen-pricing":   "PRICING%20-%20Generics%20-%20Avg%20Cost",
  "gen-pricing-3prx": "PRICING%20-%20Generics%20Avg%20Cost%20Per%203PRx",
  "uom-conversions": "Stock%20Item%20UOM%20Conversions",
  "stock-cross-ref": "FORMULARY%20-%20Stock%20Item%20Cross%20Ref",
  "open-po-lines": "Open%20PO%20Lines",
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
  "item-xref": [
    { label: "InventoryID",   keys: ["InventoryID", "InventoryId", "InventoryCd", "InventoryCD", "Inventory ID"] },
    { label: "Description",   keys: ["Description", "Descr", "ItemDescription"] },
    { label: "AlternateID",   keys: ["AlternateID", "AlternateId", "Alternate ID"] },
    { label: "UOM",           keys: ["UOM", "Uom", "BaseUnit", "BaseUOM"] },
    { label: "DefaultPrice",  keys: ["DefaultPrice", "Default Price", "Price", "UnitPrice"] },
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
  "hills-pawtree": [
    { label: "PONumber",        keys: ["PONumber", "OrderNbr", "PONbr", "PO Number"] },
    { label: "DateOrdered",     keys: ["DateOrdered", "Date", "OrderDate", "Date Ordered"] },
    { label: "Vendor",          keys: ["Vendor", "VendorID", "VendorName"] },
    { label: "Warehouse",       keys: ["Warehouse", "WarehouseID"] },
  ],
  "replenishment-needs": [
    { label: "InventoryID",     keys: ["InventoryID", "InventoryCd", "InventoryCD", "Inventory_ID", "Inventory ID"] },
    { label: "Description",     keys: ["Description", "Descr"] },
    { label: "Warehouse",       keys: ["Warehouse", "SiteID", "WarehouseID"] },
    { label: "QtyAvailable",    keys: ["QtyAvailable", "Qty_Available", "QtyAvail", "Qty Available"] },
    { label: "ReorderPoint",    keys: ["ReorderPoint", "Reorder_Point", "MinQty", "Reorder Point"] },
    { label: "MaxQty",          keys: ["MaxQty", "Max_Qty", "Max Qty"] },
    { label: "SafetyStock",     keys: ["SafetyStock", "Safety_Stock", "Safety Stock"] },
    { label: "OnSupply",        keys: ["OnSupply", "On_Supply", "QtyINAssemblySupply", "On Supply"] },
    { label: "OnPO",            keys: ["OnPO", "On_PO", "QtyPOOrders", "On PO"] },
    { label: "SODemand",        keys: ["SODemand", "SO_Demand", "QtySOBooked", "SO Demand"] },
  ],
  "whse-replenish": [
    { label: "InventoryID",       keys: ["InventoryID", "InventoryCd", "InventoryCD", "Inventory ID", "Inventory_ID"] },
    { label: "Warehouse",         keys: ["Warehouse", "WarehouseID", "SiteID"] },
    { label: "ReplenishmentClass", keys: ["ReplenishmentClass", "Replenishment_Class", "Replenishment Class", "ReplenishmentClassID"] },
    { label: "ItemStatus",        keys: ["ItemStatus", "Item_Status", "Item Status", "Status"] },
  ],
  "gen-pricing": [
    { label: "InventoryID",   keys: ["InventoryID", "InventoryId", "InventoryCd", "InventoryCD", "Inventory ID", "Inventory_ID"] },
    { label: "Description",   keys: ["Description", "Descr", "ItemDescription"] },
    { label: "BaseUnit",      keys: ["BaseUnit", "Base Unit", "BaseUOM"] },
    { label: "SalesUnit",     keys: ["SalesUnit", "Sales Unit", "SalesUOM"] },
    { label: "AverageCost",   keys: ["AverageCost", "Average Cost", "AvgCost", "Avg Cost", "Average_Cost"] },
    { label: "Multiplier",    keys: ["Multiplier", "UOMMultiplier", "ConvFactor", "ConversionFactor"] },
    { label: "DefaultPrice",  keys: ["DefaultPrice", "Default Price", "Default_Price", "Price"] },
    { label: "ItemClass",     keys: ["ItemClass", "Item Class", "ItemClassID"] },
  ],
  "uom-conversions": [
    { label: "InventoryID",      keys: ["InventoryID", "InventoryId", "InventoryCd", "InventoryCD", "Inventory ID", "Inventory_ID"] },
    { label: "BaseUnit",         keys: ["BaseUnit", "Base Unit", "BaseUOM"] },
    { label: "FromUnit",         keys: ["FromUnit", "From Unit", "FromUOM"] },
    { label: "ToUnit",           keys: ["ToUnit", "To Unit", "ToUOM"] },
    { label: "MultiplyDivide",   keys: ["MultiplyDivide", "Multiply/Divide", "MultiplyDivideOp", "ConvOp"] },
    { label: "ConversionFactor", keys: ["ConversionFactor", "Conversion Factor", "Conv Factor", "ConvFactor"] },
  ],
  "gen-pricing-3prx": [
    { label: "InventoryID",   keys: ["InventoryID", "InventoryId", "InventoryCd", "InventoryCD", "Inventory ID", "Inventory_ID"] },
    { label: "TPNYAvgCost",   keys: ["TPNYAvgCost", "TP-NY Avg Cost", "TP-NYAvgCost", "TP_NY_Avg_Cost", "TPNY_AvgCost"] },
    { label: "TPOHAvgCost",   keys: ["TPOHAvgCost", "TP-OH Avg Cost", "TP-OHAvgCost", "TP_OH_Avg_Cost", "TPOH_AvgCost"] },
    { label: "TPCAAvgCost",   keys: ["TPCAAvgCost", "TP-CA Avg Cost", "TP-CAAvgCost", "TP_CA_Avg_Cost", "TPCA_AvgCost"] },
    { label: "TPMIAvgCost",   keys: ["TPMIAvgCost", "TP-MI Avg Cost", "TP-MIAvgCost", "TP_MI_Avg_Cost", "TPMI_AvgCost"] },
    { label: "TPFLAvgCost",   keys: ["TPFLAvgCost", "TP-FL Avg Cost", "TP-FLAvgCost", "TP_FL_Avg_Cost", "TPFL_AvgCost"] },
    { label: "GGMAvgCost",    keys: ["GGMAvgCost", "GGM Avg Cost", "GGM_AvgCost", "GGMAVGCost"] },
    { label: "GGMKYAvgCost",  keys: ["GGMKYAvgCost", "GGM-KY Avg Cost", "GGM-KYAvgCost", "GGM_KY_Avg_Cost"] },
    { label: "GGMAZAvgCost",  keys: ["GGMAZAvgCost", "GGM-AZ Avg Cost", "GGM-AZAvgCost", "GGM_AZ_Avg_Cost"] },
  ],
  "stock-cross-ref": [
    { label: "InventoryID",   keys: ["InventoryID", "InventoryId", "InventoryCd", "InventoryCD", "Inventory ID", "Inventory_ID"] },
    { label: "Description",   keys: ["Description", "Descr", "ItemDescription"] },
    { label: "NDC",           keys: ["NDC", "AlternateID", "Alternate ID", "AltID", "CrossReference", "Cross Reference", "Cross_Reference"] },
    { label: "VendorName",    keys: ["VendorName", "Vendor Name", "Vendor"] },
  ],
  "open-po-lines": [
    { label: "OrderNbr",      keys: ["OrderNbr", "Order Nbr.", "Order Nbr", "OrderNbr_", "PONbr", "PO Nbr"] },
    { label: "VendorRef",     keys: ["VendorRef", "Vendor Ref.", "Vendor Ref", "VendorRefNbr"] },
    { label: "InventoryID",   keys: ["InventoryID", "InventoryId", "InventoryCd", "InventoryCD", "Inventory ID", "Inventory_ID"] },
    { label: "Description",   keys: ["Description", "Descr", "ItemDescription"] },
    { label: "OrderQty",      keys: ["OrderQty", "Order Qty.", "Order Qty", "OrderQuantity"] },
    { label: "OrderDate",     keys: ["OrderDate", "POLine_orderDate", "POLine_orderdate", "POLineOrderDate", "Order Date"] },
    { label: "QtyOnReceipts", keys: ["QtyOnReceipts", "Qty. On Receipts", "Qty On Receipts", "QtyReceived"] },
    { label: "VendorName",    keys: ["VendorName", "Vendor Name", "Vendor"] },
    { label: "Warehouse",     keys: ["Warehouse", "WarehouseID", "SiteID"] },
  ],
};

export async function POST(request) {
  try {
    const body = await request.json();
    const { type, warehouse, username, password, useServiceAccount } = body;

    if (!type || !ENDPOINTS[type]) {
      return Response.json({ error: "Invalid type. Use: po, po-ggm, ndc-lookup, item-xref, short-dating, backorder, hills-pawtree, replenishment-needs, whse-replenish, gen-pricing, gen-pricing-3prx, uom-conversions, stock-cross-ref, open-po-lines" }, { status: 400 });
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

    // For replenishment needs, fetch all and let client filter by warehouse
    // (GI parameters don't work with OData $filter — they need to be optional)
    if (type === "replenishment-needs") {
      url += `?$top=5000`;
    }

    // For whse replenish, fetch all (we only need 4 fields so it's lightweight)
    if (type === "whse-replenish") {
      url += `?$top=15000`;
    }

    // For cross reference, get all records
    if (type === "item-xref") {
      url += `?$top=10000`;
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

    // For PO fetches, filter to today's date only and exclude certain vendors
    if ((type === "po" || type === "po-ggm") && rawRows.length > 0) {
      // Get today in US Eastern time (Acumatica's likely timezone)
      const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const todayStr = nowET.getFullYear() + "-" + String(nowET.getMonth() + 1).padStart(2, "0") + "-" + String(nowET.getDate()).padStart(2, "0");

      const dateKeys = ["Date", "OrderDate", "TranDate", "DocumentDate", "DocDate"];
      const vendorKeys = ["VendorName", "Vendor", "Vendor Name"];

      rawRows = rawRows.filter(row => {
        let dateVal = null;
        for (const k of dateKeys) { if (row[k] != null) { dateVal = row[k]; break; } }
        if (dateVal) {
          const dateStr = String(dateVal).slice(0, 10);
          if (dateStr !== todayStr) return false;
        }

        // Exclude certain vendors (GGM-KY keeps Vetcove Generics)
        let vendorName = "";
        for (const k of vendorKeys) { if (row[k]) { vendorName = String(row[k]).toLowerCase(); break; } }
        if (vendorName.includes("truepill") || vendorName.includes("bloodworth")) return false;
        if (vendorName.includes("vetcove generics") && type !== "po-ggm") return false;

        return true;
      });
    }

    if (rawRows.length === 0) {
      return Response.json({ data: [], count: 0 });
    }

    // Resolve column names (Acumatica field names vary between instances)
    const sample = rawRows.find(r => r && Object.keys(r).length) || rawRows[0];
    const colDefs = COLUMN_MAP[type] || [];
    const resolved = colDefs.map(col => {
      const found = col.keys.find(k => k in sample);
      return { label: col.label, key: found || null, keys: col.keys };
    });

    // Map rows to normalized objects
    const data = rawRows.map(row => {
      const obj = {};
      for (const col of resolved) {
        let val = col.key ? row[col.key] : "";
        if (val == null) val = "";
        // SKUNDC fallback: if primary field is empty, try all fallback keys per row
        if (col.label === "SKUNDC" && !val) {
          for (const fallbackKey of col.keys || []) {
            if (row[fallbackKey]) { val = row[fallbackKey]; break; }
          }
        }
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
