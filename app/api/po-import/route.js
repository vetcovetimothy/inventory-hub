/**
 * POST /api/po-import
 *
 * Parses PO PDFs to extract NDCs and line item data.
 * No AI/Claude API — pure PDF text extraction + regex parsing.
 *
 * Body: { pdfs: [{ data: base64, name: string }], pastedText?: string }
 * Returns: { items: [{ ndc, drugName, qty, unitPrice, totalPrice, warehouse, rawLine, source }], warehouse, count }
 */

export const maxDuration = 60;

const WAREHOUSE_MAP = { hayward: "TP-CA", brooklyn: "TP-NY", "seven hills": "TP-OH", ohio: "TP-OH" };

function detectWarehouse(text) {
  var lower = text.toLowerCase();
  for (var key in WAREHOUSE_MAP) { if (lower.includes(key)) return WAREHOUSE_MAP[key]; }
  return "";
}

var NDC_REGEX = /\b(\d{4,5}-\d{3,4}-\d{1,2})\b/g;
var PRICE_REGEX = /\$?\d{1,6}\.\d{2,4}/g;

function parsePdfText(text, fileName) {
  var lines = text.split("\n").map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
  var headerText = lines.slice(0, 30).join(" ");
  var warehouse = detectWarehouse(headerText);
  var items = [];
  var seenNdcs = {};

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var ndcMatches = line.match(NDC_REGEX);
    if (!ndcMatches) continue;

    for (var j = 0; j < ndcMatches.length; j++) {
      var ndc = ndcMatches[j].trim();
      if (seenNdcs[ndc]) continue;
      seenNdcs[ndc] = true;

      var prevLine = i > 0 ? lines[i - 1] : "";
      var beforeNdc = (line.split(ndc)[0] || "").replace(NDC_REGEX, "").replace(PRICE_REGEX, "").replace(/\b\d{1,3}\b/g, "").replace(/[|$]/g, "").replace(/\s+/g, " ").trim();
      var afterNdc = (line.split(ndc)[1] || "").replace(NDC_REGEX, "").replace(PRICE_REGEX, "").replace(/\b\d{1,3}\b/g, "").replace(/[|$]/g, "").replace(/\s+/g, " ").trim();
      var drugName = (beforeNdc && beforeNdc.length >= 4) ? beforeNdc : (afterNdc && afterNdc.length >= 4) ? afterNdc : prevLine.replace(NDC_REGEX, "").replace(PRICE_REGEX, "").replace(/\b\d{1,3}\b/g, "").replace(/\s+/g, " ").trim();

      var prices = (line.match(PRICE_REGEX) || []).map(function(p) { return parseFloat(p.replace("$", "")); });
      var numLine = line.replace(NDC_REGEX, "").replace(PRICE_REGEX, "");
      var qtyNums = [];
      var qm;
      var qr = /\b(\d{1,4})\b/g;
      while ((qm = qr.exec(numLine)) !== null) { var n = parseInt(qm[1]); if (n > 0 && n < 10000) qtyNums.push(n); }

      items.push({
        ndc: ndc,
        drugName: drugName || "",
        qty: qtyNums.length > 0 ? qtyNums[0] : null,
        unitPrice: prices.length > 0 ? prices[0] : null,
        totalPrice: prices.length > 1 ? prices[prices.length - 1] : null,
        warehouse: warehouse,
        rawLine: line,
        source: fileName || "pdf",
      });
    }
  }

  return { items: items, warehouse: warehouse };
}

function parsePastedText(text) {
  var lines = text.split("\n").map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
  var items = [];
  var seenNdcs = {};

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var ndcMatches = line.match(NDC_REGEX);
    if (!ndcMatches) continue;

    for (var j = 0; j < ndcMatches.length; j++) {
      var ndc = ndcMatches[j].trim();
      if (seenNdcs[ndc]) continue;
      seenNdcs[ndc] = true;

      var cleanLine = line.replace(NDC_REGEX, "").replace(PRICE_REGEX, "").replace(/\b\d{1,3}\b/g, "").replace(/\s+/g, " ").trim();
      var prices = (line.match(PRICE_REGEX) || []).map(function(p) { return parseFloat(p.replace("$", "")); });

      items.push({
        ndc: ndc,
        drugName: cleanLine.slice(0, 120) || "",
        qty: null,
        unitPrice: prices.length > 0 ? prices[0] : null,
        totalPrice: prices.length > 1 ? prices[prices.length - 1] : null,
        warehouse: "",
        rawLine: line,
        source: "pasted",
      });
    }
  }

  return items;
}

export async function POST(req) {
  try {
    var body = await req.json();
    var pdfs = body.pdfs;
    var pastedText = body.pastedText;

    if ((!pdfs || pdfs.length === 0) && !pastedText) {
      return Response.json({ error: "No PDFs or pasted text provided" }, { status: 400 });
    }

    var allItems = [];
    var warehouse = "";

    if (pdfs && pdfs.length > 0) {
      var pdfParse = (await import("pdf-parse")).default;
      for (var i = 0; i < pdfs.length; i++) {
        try {
          var buffer = Buffer.from(pdfs[i].data, "base64");
          var data = await pdfParse(buffer);
          var result = parsePdfText(data.text, pdfs[i].name);
          if (result.warehouse && !warehouse) warehouse = result.warehouse;
          allItems = allItems.concat(result.items);
        } catch (err) {
          console.error("Failed to parse PDF:", pdfs[i].name, err.message);
        }
      }
    }

    if (pastedText && pastedText.trim()) {
      allItems = allItems.concat(parsePastedText(pastedText));
    }

    var seen = {};
    var uniqueItems = allItems.filter(function(item) {
      if (seen[item.ndc]) return false;
      seen[item.ndc] = true;
      return true;
    });

    return Response.json({ items: uniqueItems, warehouse: warehouse, count: uniqueItems.length });
  } catch (err) {
    console.error("PO Import error:", err);
    return Response.json({ error: err.message || "Parse error" }, { status: 500 });
  }
}
