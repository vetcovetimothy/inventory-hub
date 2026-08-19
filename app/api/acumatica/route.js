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
  "recon-tp":      "HD%20PO%20Tracker%20-%20TP",
  "recon-ggm":     "HD%20PO%20Tracker%20-%20GGM",
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
    { label: "OnHandQty",     keys: ["OnHandQty", "OnHand", "QtyOnHand", "OnHandQuantity", "OnHandQty_2"] },
    { label: "Price",         keys: ["Price", "UnitCost", "LastCost"] },
    { label: "MovementClass", keys: ["MovementClass", "MovementClassDescr"] },
    { label: "InventoryID",   keys: ["InventoryID", "InventoryID_2", "InventoryId", "InventoryCD", "InventoryCd"] },
    { label: "OrderDate",     keys: ["Date", "OrderDate", "PODate", "TranDate", "DocDate", "DocumentDate"] },
    { label: "PromisedDate",  keys: ["PromisedDate", "Promised Date", "Promised", "ExpectedDate", "PromiseDate"] },
    { label: "UOM",           keys: ["UOM", "UOM_2", "Unit", "PurchaseUnit", "UnitOfMeasure", "OrderUOM"] },
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
    { label: "InventoryID",   keys: ["InventoryID", "InventoryID_2", "InventoryId", "InventoryCD", "InventoryCd"] },
    { label: "OrderDate",     keys: ["Date", "OrderDate", "PODate", "TranDate", "DocDate", "DocumentDate"] },
    { label: "PromisedDate",  keys: ["PromisedDate", "Promised Date", "Promised", "ExpectedDate", "PromiseDate"] },
    { label: "UOM",           keys: ["UOM", "UOM_2", "Unit", "PurchaseUnit", "UnitOfMeasure", "OrderUOM"] },
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
    { label: "ReorderPoint",      keys: ["ReorderPoint", "Reorder_Point", "Reorder Point", "ReorderPt", "MinQty"] },
    { label: "SafetyStock",       keys: ["SafetyStock", "Safety_Stock", "Safety Stock"] },
    { label: "MaxQty",            keys: ["MaxQty", "Max_Qty", "Max Qty", "Max Qty.", "MaxQty.", "MaxQuantity"] },
    { label: "MovementClass",     keys: ["MovementClass", "Movement_Class", "Movement Class", "MovementClassID"] },
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
  // Reconciliation GIs (HD PO Tracker – TP / GGM): richer feed used to catch
  // manually-created Acumatica POs missing from the receiving trackers.
  "recon-tp": [
    { label: "VendorName",   keys: ["Vendor Name", "VendorName"] },
    { label: "SKUNDC",       keys: ["SKU NDC", "SKUNDC"] },
    { label: "Description",  keys: ["Description", "InventoryID_Description"] },
    { label: "BOHPackSize",  keys: ["BOH Pack Size", "BOHPackSize", "BOHPKSIZE", "BOHPKSIZE_Attributes"] },
    { label: "OrderQty",     keys: ["Order Qty.", "OrderQty"] },
    { label: "VendorRef",    keys: ["Vendor Ref.", "VendorRef", "VendorRefNbr"] },
    { label: "OrderDate",    keys: ["POLine_orderDate", "POLineorderDate", "OrderDate", "Date"] },
    { label: "PromisedDate", keys: ["Promised", "PromisedDate"] },
    { label: "InventoryID",  keys: ["Inventory ID", "InventoryID"] },
    { label: "OrderNbr",     keys: ["Order Nbr.", "OrderNbr"] },
    { label: "Warehouse",    keys: ["Warehouse", "SiteID"] },
    { label: "UOM",          keys: ["UOM", "Unit"] },
    { label: "AltID",        keys: ["Alternate ID", "AlternateID", "Alt ID", "AltID", "POLineAlternateID", "AlternateNbr"] },
  ],
  "recon-ggm": [
    { label: "VendorName",   keys: ["Vendor Name", "VendorName"] },
    { label: "SKUNDC",       keys: ["SKU NDC", "SKUNDC"] },
    { label: "Description",  keys: ["Description", "InventoryID_Description"] },
    { label: "BOHPackSize",  keys: ["BOH Pack Size", "BOHPackSize", "BOHPKSIZE", "BOHPKSIZE_Attributes"] },
    { label: "OrderQty",     keys: ["Order Qty.", "OrderQty"] },
    { label: "VendorRef",    keys: ["Vendor Ref.", "VendorRef", "VendorRefNbr"] },
    { label: "OrderDate",    keys: ["POLine_orderDate", "POLineorderDate", "OrderDate", "Date"] },
    { label: "PromisedDate", keys: ["Promised", "PromisedDate"] },
    { label: "InventoryID",  keys: ["Inventory ID", "InventoryID"] },
    { label: "OrderNbr",     keys: ["Order Nbr.", "OrderNbr"] },
    { label: "Warehouse",    keys: ["Warehouse", "SiteID"] },
    { label: "UOM",          keys: ["UOM", "Unit"] },
    { label: "AltID",        keys: ["Alternate ID", "AlternateID", "Alt ID", "AltID", "POLineAlternateID", "AlternateNbr"] },
  ],
};

// === Cache TTLs (ms) ===
// Only cache types where stale-by-a-few-minutes/hours is acceptable.
// PO drafts, short-dating, hills-pawtree, replenishment data are intentionally NOT cached
// because users expect them to reflect current Acumatica state.
const CACHE_TTL = {
  "ndc-lookup":       6 * 60 * 60 * 1000,  // 6h — generic NDCs change slowly
  "stock-cross-ref":  6 * 60 * 60 * 1000,  // 6h — formulary cross-ref changes slowly
  "item-xref":        6 * 60 * 60 * 1000,  // 6h — item cross-ref changes slowly
  "uom-conversions": 24 * 60 * 60 * 1000,  // 24h — UOM conversions basically never change
  "gen-pricing":      4 * 60 * 60 * 1000,  // 4h — generics avg cost
  "gen-pricing-3prx": 4 * 60 * 60 * 1000,  // 4h — per-3PRx avg cost
  "open-po-lines":    5 * 60 * 1000,       // 5min — used by OOS+Backorder, changes often but tolerates short staleness
  "backorder":        5 * 60 * 1000,       // 5min — same
};

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function getCached(cacheKey) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const resp = await fetch(KV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(["GET", cacheKey]),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!json.result) return null;
    return JSON.parse(json.result);
  } catch { return null; }
}

async function setCached(cacheKey, value, ttlMs) {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    // SET with PX (expire after TTL ms) — Upstash auto-evicts on expiry
    await fetch(KV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(["SET", cacheKey, JSON.stringify(value), "PX", String(ttlMs)]),
    });
  } catch { /* cache write failure is non-fatal */ }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { type, warehouse, username, password, useServiceAccount } = body;

    if (!type || !ENDPOINTS[type]) {
      return Response.json({ error: "Invalid type. Use: po, po-ggm, ndc-lookup, item-xref, short-dating, backorder, hills-pawtree, replenishment-needs, whse-replenish, gen-pricing, gen-pricing-3prx, uom-conversions, stock-cross-ref, open-po-lines" }, { status: 400 });
    }

    // Check cache before doing anything expensive (skip if ?refresh=1 in URL)
    const url0 = new URL(request.url);
    const skipCache = url0.searchParams.get("refresh") === "1";
    const ttl = CACHE_TTL[type];
    // Only cache types listed in CACHE_TTL, and only when no warehouse filter is applied
    // (per-warehouse PO fetches and warehouse-filtered queries shouldn't share a cache key)
    const cacheable = ttl && !warehouse;
    // Bump the suffix to invalidate a stale cached copy after a query change
    // (uom-conversions:v2 abandons the old truncated entry from before the $top fix).
    const cacheKey = cacheable ? `acu-cache:${type}${type === "uom-conversions" ? ":v2" : ""}` : null;
    if (cacheable && !skipCache) {
      const cached = await getCached(cacheKey);
      if (cached && cached.data) {
        return Response.json({ data: cached.data, count: cached.data.length, _cache: "hit", _cachedAt: cached.cachedAt });
      }
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

    // For whse replenish, fetch all rows (current ROP / Safety Stock / Max Qty per item-warehouse)
    if (type === "whse-replenish") {
      url += `?$top=15000`;
    }

    // For cross reference, get all records
    if (type === "item-xref") {
      url += `?$top=10000`;
    }

    // For UOM conversions, fetch all (no warehouse filter; many rows per item, so
    // without an explicit cap the GI gets truncated and some items lose their
    // conversion factor — which breaks per-UOM avg-cost scaling downstream).
    if (type === "uom-conversions") {
      url += `?$top=100000`;
    }

    // For open PO lines, fetch all (a specific PO's lines can be anywhere in the
    // set; without a cap the GI truncates and recent/scattered POs go missing).
    if (type === "open-po-lines") {
      url += `?$top=100000`;
    }

    // Reconciliation GIs: pull everything (all warehouses); the hub applies the
    // 6-day window and warehouse routing client-side.
    if (type === "recon-tp" || type === "recon-ggm") {
      url += `?$top=100000`;
    }

    // Call Acumatica
    const authHeader = "Basic " + Buffer.from(authUser + ":" + authPass).toString("base64");

    // The HD PO Tracker GIs may use a plain hyphen, en-dash, or em-dash in their
    // title. Try each until one resolves (a 404 means "wrong title"), so a stray
    // en-dash in the inquiry name doesn't break the pull.
    let urlsToTry = [url];
    if (type === "recon-tp" || type === "recon-ggm") {
      const qIdx = url.indexOf("?");
      const suffix = qIdx >= 0 ? url.slice(qIdx) : "";
      const site = type === "recon-tp" ? "TP" : "GGM";
      urlsToTry = ["-", "%E2%80%93", "%E2%80%94"].map(function(dash) {
        return `${BASE}${PREFIX}/HD%20PO%20Tracker%20${dash}%20${site}${suffix}`;
      });
    }

    let resp;
    for (let ui = 0; ui < urlsToTry.length; ui++) {
      resp = await fetch(urlsToTry[ui], {
        method: "GET",
        headers: { "Authorization": authHeader, "Accept": "application/json" },
      });
      if (resp.ok || resp.status !== 404) break; // success, or a real (non-title) error
    }

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
      if (cacheable) await setCached(cacheKey, { data: [], cachedAt: Date.now() }, ttl);
      return Response.json({ data: [], count: 0, _cache: "miss" });
    }

    // Resolve column names (Acumatica field names vary between instances)
    const sample = rawRows.find(r => r && Object.keys(r).length) || rawRows[0];
    const sampleKeys = Object.keys(sample);
    const normKey = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
    const colDefs = COLUMN_MAP[type] || [];
    const resolved = colDefs.map(col => {
      // 1) exact match against candidate names
      let found = col.keys.find(k => k in sample);
      // 2) fallback: match ignoring spaces, dots, and case
      if (!found) {
        const wanted = col.keys.map(normKey);
        found = sampleKeys.find(k => wanted.indexOf(normKey(k)) !== -1) || null;
      }
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

    if (cacheable) await setCached(cacheKey, { data, cachedAt: Date.now() }, ttl);
    return Response.json({ data, count: data.length, _cache: "miss" });
  } catch (err) {
    console.error("Acumatica proxy error:", err);
    return Response.json({ error: "Server error", detail: err.message }, { status: 500 });
  }
}
