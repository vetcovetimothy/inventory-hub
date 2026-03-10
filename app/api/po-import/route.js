/**
 * POST /api/po-import
 *
 * Parses PO PDFs (Keysource/Anda/Bloodworth/McKesson) to extract line items.
 * Uses pdfjs-dist for text extraction — no AI.
 *
 * Body: { pdfs: [{ data: base64, name: string }] }
 * Returns: { items: [...], warehouse, vendorSource, poNumber, count }
 */

export const maxDuration = 60;

async function extractTextFromPdf(base64Data) {
  const pdfjsMod = await import("pdfjs-dist/legacy/build/pdf.js");
  const pdfjsLib = pdfjsMod.default || pdfjsMod;
  const getDoc = pdfjsLib.getDocument || pdfjsMod.getDocument;
  if (!getDoc) throw new Error("pdfjs-dist getDocument not found");
  const buffer = Buffer.from(base64Data, "base64");
  const data = new Uint8Array(buffer);
  const doc = await getDoc({ data, verbosity: 0 }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join("\n") + "\n";
  }
  return text;
}

function parsePO(text) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Detect warehouse and vendor from header
  let warehouse = "",
    vendorSource = "",
    poNumber = "",
    storeName = "";
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes("hayward")) warehouse = "TP-CA";
    if (lower.includes("brooklyn")) warehouse = "TP-NY";
    if (lower.includes("seven hills") || lower.includes("ohio"))
      warehouse = "TP-OH";
    if (lower.includes("mckesson") && !vendorSource) vendorSource = "McKesson";
    if (lower.includes("keysource")) vendorSource = "Keysource";
    if (lower.includes("anda")) vendorSource = "Anda";
    if (lower.includes("bloodworth")) vendorSource = "Bloodworth";
    const poMatch = lines[i].match(/^PO#:\s*(\d+)/);
    if (poMatch) poNumber = poMatch[1];
    const storeMatch = lines[i].match(/^Store Name:\s*(.+)/);
    if (storeMatch) storeName = storeMatch[1].trim();
  }

  const NDC_REGEX = /^\d{4,5}-\d{3,4}-\d{1,2}$/;

  // Find all NDC line positions
  const ndcPositions = [];
  for (let i = 0; i < lines.length; i++) {
    if (NDC_REGEX.test(lines[i])) ndcPositions.push(i);
  }

  // Noise patterns to skip when looking for drug names
  const isNoise = (s) => {
    const l = s.toLowerCase();
    return (
      l.includes("vetcove") ||
      l.includes("amount:") ||
      l.includes("invoice") ||
      l.includes("store name") ||
      l.includes("original po") ||
      l.includes("create date") ||
      /^po#/i.test(l) ||
      l === "non edi)" ||
      l === "edi)" ||
      l === "0" ||
      l === "non" ||
      /^\d{5,7}$/.test(s) ||
      /^\$[\d,.]+$/.test(s) ||
      l === "drug name" ||
      l === "ndc" ||
      l === "number" ||
      l === "of pkg" ||
      l === "total" ||
      l === "price" ||
      l === "unit price" ||
      l === "vendor name" ||
      l === "received" ||
      l === "qty" ||
      l === "vendor" ||
      l === "item #"
    );
  };

  const items = [];

  for (let n = 0; n < ndcPositions.length; n++) {
    const ndcIdx = ndcPositions[n];
    const ndc = lines[ndcIdx];

    // Look BACKWARDS for drug name
    const drugParts = [];
    const prevBoundary = n > 0 ? ndcPositions[n - 1] : -1;
    for (let j = ndcIdx - 1; j > prevBoundary; j--) {
      const l = lines[j];
      if (isNoise(l)) continue;
      if (/^\d+\.?\d*$/.test(l.replace(/[$,]/g, ""))) continue;
      drugParts.unshift(l);
      if (drugParts.length >= 3) break;
    }
    const drugName = drugParts.join(" ").trim();

    // Look FORWARDS for numeric values
    const nextBoundary =
      n < ndcPositions.length - 1 ? ndcPositions[n + 1] : lines.length;
    const nums = [];
    for (let j = ndcIdx + 1; j < nextBoundary; j++) {
      const val = lines[j].replace(/[$,]/g, "");
      if (/^\d+\.?\d*$/.test(val)) {
        nums.push(parseFloat(val));
      }
    }

    // nums pattern: [numPkg, totalPrice, unitPricePerUnit, 0(recvQty), vendorItemNum]
    const qty = nums.length >= 1 ? Math.round(nums[0]) : null;
    const totalPrice = nums.length >= 2 ? nums[1] : null;
    const unitPricePdf = nums.length >= 3 ? nums[2] : null;
    let vendorItemNum = null;
    if (nums.length >= 5) vendorItemNum = String(Math.round(nums[4]));
    else if (nums.length >= 4) vendorItemNum = String(Math.round(nums[3]));

    // Compute real unit cost = totalPrice / qty
    const computedUnitCost =
      qty && totalPrice && qty > 0
        ? Math.round((totalPrice / qty) * 10000) / 10000
        : unitPricePdf;

    items.push({
      ndc,
      drugName,
      qty,
      totalPrice,
      unitPrice: computedUnitCost,
      warehouse,
      vendorSource,
      vendorItemNum,
      poNumber,
      storeName,
    });
  }

  return { items, warehouse, vendorSource, poNumber, storeName };
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { pdfs } = body;

    if (!pdfs || pdfs.length === 0) {
      return Response.json({ error: "No PDFs provided" }, { status: 400 });
    }

    const allItems = [];
    let warehouse = "",
      vendorSource = "",
      poNumber = "",
      storeName = "";

    for (const pdfFile of pdfs) {
      try {
        const text = await extractTextFromPdf(pdfFile.data);
        const result = parsePO(text);
        if (result.warehouse && !warehouse) warehouse = result.warehouse;
        if (result.vendorSource && !vendorSource)
          vendorSource = result.vendorSource;
        if (result.poNumber && !poNumber) poNumber = result.poNumber;
        if (result.storeName && !storeName) storeName = result.storeName;

        // Tag each item with source file
        result.items.forEach((item) => {
          item.sourceFile = pdfFile.name;
        });
        allItems.push(...result.items);
      } catch (err) {
        console.error("Failed to parse PDF:", pdfFile.name, err.message, err.stack);
        // Return the error to the client instead of silently skipping
        if (allItems.length === 0) {
          return Response.json({ error: "PDF parse failed: " + err.message, items: [], count: 0 }, { status: 500 });
        }
      }
    }

    return Response.json({
      items: allItems,
      warehouse,
      vendorSource,
      poNumber,
      storeName,
      count: allItems.length,
    });
  } catch (err) {
    console.error("PO Import error:", err);
    return Response.json(
      { error: err.message || "Parse error" },
      { status: 500 }
    );
  }
}
