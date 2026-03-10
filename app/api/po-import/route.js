/**
 * POST /api/po-import
 *
 * Parses PO PDFs to extract NDCs and line item data using unpdf.
 * No AI/Claude API — pure PDF text extraction + pattern matching.
 *
 * Body: { pdfs: [{ data: base64, name: string }] }
 */

export const maxDuration = 60;

const WAREHOUSE_MAP = { hayward: "TP-CA", brooklyn: "TP-NY", "seven hills": "TP-OH", ohio: "TP-OH" };
const NDC_INLINE = /(\d{4,5}-\d{3,4}-\d{1,2})/g;

function detectWarehouse(text) {
  var lower = text.toLowerCase();
  for (var key in WAREHOUSE_MAP) { if (lower.includes(key)) return WAREHOUSE_MAP[key]; }
  return "";
}

function detectVendor(text) {
  var lower = text.toLowerCase();
  if (lower.includes("mckesson")) return "McKesson";
  if (lower.includes("keysource")) return "Keysource";
  if (lower.includes("anda")) return "Anda";
  if (lower.includes("bloodworth")) return "Bloodworth";
  return "";
}

function parsePdfText(text) {
  var lines = text.split("\n");

  // Detect header info from first ~10 lines
  var headerText = lines.slice(0, 10).join(" ");
  var warehouse = detectWarehouse(headerText);
  var vendorSource = detectVendor(headerText);
  var poMatch = headerText.match(/PO#:\s*(\d+)/);
  var poNumber = poMatch ? poMatch[1] : "";
  var storeMatch = headerText.match(/Store Name:\s*(.*?)(?=Original|$)/i);
  var storeName = storeMatch ? storeMatch[1].trim() : "";

  var items = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var ndcMatch = line.match(NDC_INLINE);
    if (!ndcMatch) continue;

    // Skip header line
    if (line.toLowerCase().includes("drug name")) continue;

    for (var m = 0; m < ndcMatch.length; m++) {
      var ndc = ndcMatch[m];
      var ndcPos = line.indexOf(ndc);
      var drugBefore = line.substring(0, ndcPos).trim();
      var afterNdc = line.substring(ndcPos + ndc.length).trim();

      // If drug name is empty or short, look at previous lines
      if (!drugBefore || drugBefore.length < 3) {
        var prevParts = [];
        for (var j = i - 1; j >= Math.max(0, i - 3); j--) {
          var prev = lines[j].trim();
          if (!prev || prev === "Non EDI)" || /^\d+\s+\d+$/.test(prev)) break;
          if (prev.toLowerCase().includes("vetcove")) break;
          if (prev.toLowerCase().includes("drug name")) break;
          prevParts.unshift(prev);
        }
        drugBefore = prevParts.join(" ") + (drugBefore ? " " + drugBefore : "");
        drugBefore = drugBefore.trim();
      }

      // Clean up drug name — remove vendor info that bleeds in
      drugBefore = drugBefore.replace(/\s*Vetcove\s*-.*$/i, "").trim();

      // Parse numbers after NDC: qty, totalPrice, unitPrice
      var afterClean = afterNdc.replace(/Vetcove\s*-.*$/i, "").trim();
      var nums = afterClean.match(/[\d.]+/g);

      var qty = nums && nums.length >= 1 ? parseInt(nums[0]) : null;
      var totalPrice = nums && nums.length >= 2 ? parseFloat(nums[1]) : null;
      var unitPrice = nums && nums.length >= 3 ? parseFloat(nums[2]) : null;

      // Compute real unit cost = totalPrice / qty
      var computedUnitCost = (qty && totalPrice && qty > 0)
        ? Math.round((totalPrice / qty) * 10000) / 10000
        : unitPrice;

      // Vendor item # is on a later line: "0 XXXXXXX"
      var vendorItemId = "";
      for (var k = i + 1; k <= Math.min(i + 3, lines.length - 1); k++) {
        var vidMatch = lines[k].match(/^0\s+(\d{5,7})$/);
        if (vidMatch) { vendorItemId = vidMatch[1]; break; }
      }

      items.push({
        ndc: ndc,
        drugName: drugBefore,
        qty: qty,
        totalPrice: totalPrice,
        unitPrice: computedUnitCost,
        warehouse: warehouse,
        vendorSource: vendorSource,
        vendorItemId: vendorItemId,
        poNumber: poNumber,
        storeName: storeName,
      });
    }
  }

  return { items: items, warehouse: warehouse, vendorSource: vendorSource, poNumber: poNumber, storeName: storeName };
}

export async function POST(req) {
  try {
    var body = await req.json();
    var pdfs = body.pdfs;

    if (!pdfs || pdfs.length === 0) {
      return Response.json({ error: "No PDFs provided" }, { status: 400 });
    }

    var allItems = [];
    var warehouse = "";
    var vendorSource = "";
    var poNumber = "";
    var storeName = "";

    for (var i = 0; i < pdfs.length; i++) {
      try {
        var { extractText } = await import("unpdf");
        var buffer = Buffer.from(pdfs[i].data, "base64");
        var result = await extractText(new Uint8Array(buffer));
        var text = Array.isArray(result.text) ? result.text.join("\n") : result.text;

        var parsed = parsePdfText(text);
        if (parsed.warehouse && !warehouse) warehouse = parsed.warehouse;
        if (parsed.vendorSource && !vendorSource) vendorSource = parsed.vendorSource;
        if (parsed.poNumber && !poNumber) poNumber = parsed.poNumber;
        if (parsed.storeName && !storeName) storeName = parsed.storeName;

        parsed.items.forEach(function(item) { item.sourceFile = pdfs[i].name; });
        allItems = allItems.concat(parsed.items);
      } catch (err) {
        console.error("Failed to parse PDF:", pdfs[i].name, err.message, err.stack);
        if (allItems.length === 0) {
          return Response.json({ error: "PDF parse failed: " + err.message, items: [], count: 0 }, { status: 500 });
        }
      }
    }

    return Response.json({
      items: allItems,
      warehouse: warehouse,
      vendorSource: vendorSource,
      poNumber: poNumber,
      storeName: storeName,
      count: allItems.length,
    });
  } catch (err) {
    console.error("PO Import error:", err);
    return Response.json({ error: err.message || "Parse error" }, { status: 500 });
  }
}
