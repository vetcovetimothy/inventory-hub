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
  if (lower.includes("toprx") || lower.includes("top rx")) return "TopRX";
  if (lower.includes("keysource")) return "Keysource";
  if (lower.includes("anda")) return "Anda";
  if (lower.includes("bloodworth")) return "Bloodworth";
  return "";
}

function parseGgmCrossoverText(text) {
  var lines = text.split("\n").map(function(l) { return l.trim(); });
  var fullText = lines.join("\n");

  // PO Number (e.g., "PO #:\nPO455")
  var poNumber = "";
  var poInline = fullText.match(/PO\s*#:\s*([A-Z0-9]+)/i);
  if (poInline) poNumber = poInline[1];

  // Warehouse: default KY, detect AZ from address
  var warehouse = "GGM-KY";
  if (/\bAZ\s+\d{5}\b/.test(fullText)) warehouse = "GGM-AZ";

  // Create/PO date (e.g., "DATE:\n7/16/2026")
  var createDate = "";
  var ggmDateMatch = fullText.match(/\bDATE:\s*\n?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if (ggmDateMatch) createDate = ggmDateMatch[1];

  // Stated total ("TOTAL $9,486.87")
  var statedAmount = null;
  var totalMatch = fullText.match(/TOTAL\s*\$?([\d,]+\.\d{2})/i);
  if (totalMatch) { var amt = parseFloat(totalMatch[1].replace(/,/g, "")); if (!isNaN(amt)) statedAmount = amt; }

  var items = [];
  var pricePattern = /^(\d+)\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})\s*$/;
  var inlinePricePattern = /^(.*?)\s+(\d+)\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})\s*$/;

  for (var i = 0; i < lines.length; i++) {
    // Each row starts with "GGM Crossover NNNNNNN" (first 7 digits of NDC)
    var headerMatch = lines[i].match(/GGM\s+Crossover\s+(\d{7})\s*$/i);
    if (!headerMatch) continue;
    var ndcPart1 = headerMatch[1];

    // Next line starts with NNNN (last 4 digits of NDC), then optional description+price
    var nextLine = (lines[i + 1] || "").trim();
    var pMatch = nextLine.match(/^(\d{4})(?:\s+(.*))?$/);
    if (!pMatch) continue;
    var ndcPart2 = pMatch[1];
    var restOfLine = (pMatch[2] || "").trim();
    var part2Idx = i + 1;

    // Combine 7+4 digits and format as 5-4-2 NDC
    var ndcRaw = ndcPart1 + ndcPart2;
    if (ndcRaw.length !== 11) continue;
    var ndc = ndcRaw.slice(0, 5) + "-" + ndcRaw.slice(5, 9) + "-" + ndcRaw.slice(9, 11);

    var descParts = [];
    var qty = null, unitPrice = null, totalPrice = null;
    var endIdx = part2Idx;

    // Process the rest of the NDC line (description start, optionally with inline price)
    if (restOfLine) {
      var im0 = restOfLine.match(inlinePricePattern);
      if (im0) {
        if (im0[1].trim()) descParts.push(im0[1].trim());
        qty = parseInt(im0[2]);
        unitPrice = parseFloat(im0[3].replace(/,/g, ""));
        totalPrice = parseFloat(im0[4].replace(/,/g, ""));
      } else {
        descParts.push(restOfLine);
      }
    }

    // Scan subsequent lines for description continuation / price
    if (qty == null) {
      for (var j = part2Idx + 1; j < Math.min(lines.length, part2Idx + 12); j++) {
        var l = lines[j];
        if (!l) continue;
        if (/^TOTAL/i.test(l)) break;
        if (/GGM\s+Crossover\s+\d{7}/i.test(l)) break;

        var pm = l.match(pricePattern);
        if (pm) {
          qty = parseInt(pm[1]);
          unitPrice = parseFloat(pm[2].replace(/,/g, ""));
          totalPrice = parseFloat(pm[3].replace(/,/g, ""));
          endIdx = j;
          break;
        }
        var im = l.match(inlinePricePattern);
        if (im) {
          if (im[1].trim()) descParts.push(im[1].trim());
          qty = parseInt(im[2]);
          unitPrice = parseFloat(im[3].replace(/,/g, ""));
          totalPrice = parseFloat(im[4].replace(/,/g, ""));
          endIdx = j;
          break;
        }
        descParts.push(l);
      }
    }

    if (qty == null) continue;
    var drugName = descParts.join(" ").replace(/\s+/g, " ").trim();

    items.push({
      ndc: ndc,
      drugName: drugName,
      qty: qty,
      totalPrice: totalPrice != null ? Math.round(totalPrice * 100) / 100 : null,
      unitPrice: unitPrice != null ? Math.round(unitPrice * 100) / 100 : null,
      warehouse: warehouse,
      vendorSource: "GoGoMeds Crossover",
      vendorItemId: "",
      poNumber: poNumber,
      storeName: "",
      createDate: createDate,
    });

    i = endIdx;
  }

  return { items: items, warehouse: warehouse, vendorSource: "GoGoMeds Crossover", poNumber: poNumber, storeName: "", statedAmount: statedAmount, createDate: createDate };
}

function parsePdfText(text) {
  // Some Keysource exports (with an extra "Actual PO" column) wrap the NDC across
  // two lines, e.g. "50228-0113-" then "10". Stitch a dangling NDC back together
  // before splitting into lines. Harmless for the normal single-line format.
  text = String(text || "").replace(/(\d{4,5}-\d{3,4}-)\s*\n\s*(\d{1,2})(?!\d)/g, "$1$2");
  var lines = text.split("\n");

  // Detect header info from first ~10 lines
  var headerText = lines.slice(0, 10).join(" ");
  var warehouse = detectWarehouse(headerText);
  var vendorSource = detectVendor(headerText);
  var poMatch = headerText.match(/PO#:\s*(\d+)/);
  var poNumber = poMatch ? poMatch[1] : "";
  var dateMatch = headerText.match(/Create Date:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  var createDate = dateMatch ? dateMatch[1] : "";
  var storeMatch = headerText.match(/Store Name:\s*(.*?)(?=Original|$)/i);
  var storeName = storeMatch ? storeMatch[1].trim() : "";

  // Parse stated PO amount from header
  var statedAmount = null;
  var fullText = lines.join(" ");
  var amountMatch = fullText.match(/Amount:\s*\$?([\d,]+\.?\d*)/i);
  if (amountMatch) {
    statedAmount = parseFloat(amountMatch[1].replace(/,/g, ""));
    if (isNaN(statedAmount)) statedAmount = null;
  }

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
          if (!prev || prev === "Non EDI)" || /^\d+\s+\d+$/.test(prev) || /^\d+$/.test(prev) || prev.toLowerCase() === "item #") break;
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
      var nums = afterClean.match(/[\d.]+/g) || [];
      // Narrow-column exports wrap qty/total/unit below the NDC. Depending on the
      // extractor they land either each on their own line, or together on one line
      // that also carries the vendor name ("12 80.28 0.67 Vetcove - ..."), so strip
      // the vendor tail first, then take the leading numbers.
      if (nums.length < 2) {
        for (var g = i + 1; g < Math.min(lines.length, i + 6) && nums.length < 3; g++) {
          var gl = lines[g].trim();
          if (!gl) continue;
          if (/\d{4,5}-\d{3,4}-\d{1,2}/.test(gl)) break; // reached the next line item
          var glClean = gl.replace(/Vetcove\s*-.*$/i, "").trim();
          var gnums = glClean.match(/[\d.]+/g);
          if (gnums) { for (var gi = 0; gi < gnums.length && nums.length < 3; gi++) nums.push(gnums[gi]); }
          if (/vetcove/i.test(gl)) break; // vendor tail marks the end of this item's numbers
          if (!gnums) break;              // a non-numeric, non-vendor line ends the item
        }
      }

      var qty = nums && nums.length >= 1 ? parseInt(nums[0]) : null;
      var totalPrice = nums && nums.length >= 2 ? Math.round(parseFloat(nums[1]) * 100) / 100 : null;
      var unitPrice = nums && nums.length >= 3 ? Math.round(parseFloat(nums[2]) * 100) / 100 : null;

      // Compute real unit cost = totalPrice / qty
      var computedUnitCost = (qty && totalPrice && qty > 0)
        ? Math.round((totalPrice / qty) * 100) / 100
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
        createDate: createDate,
      });
    }
  }

  return { items: items, warehouse: warehouse, vendorSource: vendorSource, poNumber: poNumber, storeName: storeName, statedAmount: statedAmount, createDate: createDate };
}

export async function POST(req) {
  try {
    var body = await req.json();
    var pdfs = body.pdfs;
    var vendorHint = body.vendorHint || "";

    if (!pdfs || pdfs.length === 0) {
      return Response.json({ error: "No PDFs provided" }, { status: 400 });
    }

    var allItems = [];
    var warehouse = "";
    var vendorSource = "";
    var poNumber = "";
    var storeName = "";
    var statedAmount = null;

    for (var i = 0; i < pdfs.length; i++) {
      try {
        var { extractText } = await import("unpdf");
        var buffer = Buffer.from(pdfs[i].data, "base64");
        var result = await extractText(new Uint8Array(buffer));
        var text = Array.isArray(result.text) ? result.text.join("\n") : result.text;

        var parsed = vendorHint === "ggm-crossovers"
          ? parseGgmCrossoverText(text)
          : parsePdfText(text);
        if (parsed.warehouse && !warehouse) warehouse = parsed.warehouse;
        if (parsed.vendorSource && !vendorSource) vendorSource = parsed.vendorSource;
        if (parsed.poNumber && !poNumber) poNumber = parsed.poNumber;
        if (parsed.storeName && !storeName) storeName = parsed.storeName;
        if (parsed.statedAmount != null) statedAmount = (statedAmount || 0) + parsed.statedAmount;

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
      statedAmount: statedAmount,
      count: allItems.length,
    });
  } catch (err) {
    console.error("PO Import error:", err);
    return Response.json({ error: err.message || "Parse error" }, { status: 500 });
  }
}
