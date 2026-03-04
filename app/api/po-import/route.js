export const maxDuration = 60;

const WAREHOUSE_MAP = {
  hayward: "TP-CA",
  brooklyn: "TP-NY",
  "seven hills": "TP-OH",
};

function mapWarehouse(storeName) {
  if (!storeName) return "";
  const lower = storeName.toLowerCase();
  for (const [key, val] of Object.entries(WAREHOUSE_MAP)) {
    if (lower.includes(key)) return val;
  }
  return "";
}

function ndcVariants(ndc) {
  const parts = ndc.split("-");
  if (parts.length !== 3) return [ndc];
  const [a, b, c] = parts;
  const variants = new Set();
  const aPads = [a, a.replace(/^0+/, "") || "0", a.padStart(5, "0"), a.padStart(4, "0")];
  const bPads = [b, b.replace(/^0+/, "") || "0", b.padStart(4, "0"), b.padStart(3, "0")];
  const cPads = [c, c.replace(/^0+/, "") || "0", c.padStart(2, "0"), c.padStart(1, "0")];
  for (const av of aPads) for (const bv of bPads) for (const cv of cPads) {
    variants.add(`${av}-${bv}-${cv}`);
  }
  return Array.from(variants);
}

async function fetchDailyMedUOM(ndc, drugName, apiKey) {
  try {
    const variants = ndcVariants(ndc);
    // Also try 11-digit no-dash formats
    const noDashVariants = variants.map(v => v.replace(/-/g, ""));
    const allVariants = [...variants, ...noDashVariants];

    let setid = null;

    // Try NDC lookup with all variants
    for (const variant of allVariants) {
      try {
        const r1 = await fetch(
          `https://dailymed.nlm.nih.gov/dailymed/services/v2/ndcs.json?ndc=${variant}&pagesize=5`,
          { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) }
        );
        if (!r1.ok) continue;
        const d1 = await r1.json();
        if (d1?.data?.length > 0) { setid = d1.data[0].setid; break; }
      } catch { continue; }
    }

    // Fallback: search by drug name if NDC lookup failed
    if (!setid && drugName) {
      try {
        const searchName = drugName.replace(/[^a-zA-Z0-9 ]/g, "").split(" ").slice(0, 3).join("+");
        const r = await fetch(
          `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name=${searchName}&pagesize=3`,
          { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) }
        );
        if (r.ok) {
          const d = await r.json();
          if (d?.data?.length > 0) setid = d.data[0].setid;
        }
      } catch { /* skip */ }
    }

    if (!setid) return null;

    // Fetch SPL for dosage form + route
    let splData = null;
    try {
      const r2 = await fetch(
        `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${setid}.json`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) }
      );
      if (r2.ok) splData = (await r2.json())?.data;
    } catch { /* skip */ }

    // Fetch packaging info
    let packageDescriptions = [];
    try {
      const r3 = await fetch(
        `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${setid}/packaging.json`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) }
      );
      if (r3.ok) {
        const pkgData = await r3.json();
        // DailyMed packaging can be nested — flatten all description fields
        const flatten = (obj) => {
          if (!obj) return [];
          if (typeof obj === "string") return [obj];
          if (Array.isArray(obj)) return obj.flatMap(flatten);
          return Object.values(obj).flatMap(flatten);
        };
        packageDescriptions = flatten(pkgData?.data)
          .filter(s => typeof s === "string" && s.length > 3 && /\d/.test(s))
          .slice(0, 4);
      }
    } catch { /* skip */ }

    // Use AI to generate UOM code from package descriptions
    let uomCode = null;
    if (packageDescriptions.length > 0 && apiKey) {
      try {
        const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 50,
            messages: [{
              role: "user",
              content: `Convert this pharmaceutical package description into a short UOM code using these rules:
- Bottles of tablets or capsules: "BT" + count (e.g. "Bottles of 500 tablets" → "BT500", "120 capsules" → "BT120")
- Liquid bottles (solutions, suspensions, syrups): "BT" + volume (e.g. "1 bottle of 100mL" → "BT100ML")
- Vials: "VL" + volume (e.g. "5mL vial" → "VL5ML")
- Tubes: "TB" + volume
- If unclear, use best judgment.

Package descriptions: ${packageDescriptions.join(" | ")}

Reply with ONLY the short UOM code, nothing else.`
            }]
          })
        });
        if (aiResp.ok) {
          const aiData = await aiResp.json();
          uomCode = aiData.content?.find(b => b.type === "text")?.text?.trim() || null;
        }
      } catch { /* skip */ }
    }

    return {
      dosage_form: splData?.dosage_form || null,
      route: splData?.route || null,
      package_descriptions: packageDescriptions,
      uom_code: uomCode,
      link: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setid}`,
    };
  } catch {
    return null;
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { pdfs, screenshot, vendor } = body;
    // pdfs: [{ data: base64string, name: string }]
    // screenshot: base64string | null  (McKesson portal screenshot)
    // vendor: "mckesson" | "other"

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
    }

    // Build Claude message content
    const content = [];

    for (const pdf of (pdfs || [])) {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: pdf.data },
      });
    }

    if (screenshot) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: screenshot.startsWith("/9j/") ? "image/jpeg" : "image/png", data: screenshot },
      });
    }

    let prompt;
    if (vendor === "mckesson") {
      prompt = `You are parsing a McKesson pharmacy purchase order. You have been given one or more PDF documents and a screenshot of the McKesson ordering portal.

The PDF contains drug information: Drug Name, NDC number, and Inventory ID (GEN-XXXXX format, if the warehouse manager included it).
The SCREENSHOT of the McKesson portal shows the actual order: columns include MCK ITEM #, DESCRIPTION, ORD QTY (quantity ordered), and EST. NET PRICE (unit cost per package).

CRITICAL RULES:
1. The screenshot is the FINAL authority. Only include items visible in the screenshot.
2. Items in the PDF but NOT in the screenshot must be EXCLUDED.
3. Match PDF items to screenshot items by drug name or MCK ITEM # when possible.
4. For each screenshot item, use the PDF to fill in NDC and Inventory ID if available.
5. Use ORD QTY from the screenshot as orderQty.
6. Use EST. NET PRICE from the screenshot as unitCost (numeric value only, no $ sign).
7. Extract the store name from the PDF header (e.g. "Vetcove - Hayward").

Return ONLY a valid JSON array with no other text, markdown, or explanation:
[
  {
    "inventoryId": "GEN-XXXXX or null",
    "ndc": "XX-XXXX-XXXX or null",
    "drugName": "drug name from screenshot",
    "orderQty": 50,
    "unitCost": 2.73,
    "mckItemId": "1568989",
    "storeName": "Vetcove - Hayward"
  }
]`;
    } else {
      prompt = `You are parsing a pharmacy purchase order PDF from a vendor (Keysource, Anda, or Bloodworth).

Extract every line item from the PDF. For each drug, extract:
- inventoryId: The Inventory ID in GEN-XXXXX format if present, otherwise null
- ndc: The NDC number exactly as shown (e.g. "27808-0264-02")
- drugName: The drug/product name as listed
- numberOfPkg: The "Number of Pkg" or quantity ordered (integer)
- totalPrice: The total price for this line item (numeric, no $ sign)
- storeName: The store name from the PDF header (e.g. "Vetcove - Hayward")

IMPORTANT: unitCost will be calculated as totalPrice / numberOfPkg — do NOT calculate it yourself, just provide totalPrice and numberOfPkg accurately.

Return ONLY a valid JSON array with no other text, markdown, or explanation:
[
  {
    "inventoryId": null,
    "ndc": "27808-0264-02",
    "drugName": "levETIRAcetam 500MG Oral Tablet",
    "numberOfPkg": 12,
    "totalPrice": 236.52,
    "storeName": "Vetcove - Hayward"
  }
]`;
    }

    content.push({ type: "text", text: prompt });

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        messages: [{ role: "user", content }],
      }),
    });

    if (!claudeResp.ok) {
      const err = await claudeResp.text();
      return Response.json({ error: "Claude API error: " + err }, { status: 500 });
    }

    const claudeData = await claudeResp.json();
    const rawText = claudeData.content?.find(b => b.type === "text")?.text || "[]";

    let parsed;
    try {
      const clean = rawText.replace(/```json\n?|```\n?/g, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      return Response.json({ error: "Failed to parse Claude response", raw: rawText }, { status: 500 });
    }

    // Build final rows
    const rows = parsed.map(item => {
      const warehouse = mapWarehouse(item.storeName || "");
      let unitCost;
      if (vendor === "mckesson") {
        unitCost = typeof item.unitCost === "number" ? item.unitCost : parseFloat(item.unitCost) || 0;
      } else {
        const total = typeof item.totalPrice === "number" ? item.totalPrice : parseFloat(item.totalPrice) || 0;
        const qty = typeof item.numberOfPkg === "number" ? item.numberOfPkg : parseInt(item.numberOfPkg) || 1;
        unitCost = qty > 0 ? Math.round((total / qty) * 10000) / 10000 : 0;
      }
      return {
        inventoryId: item.inventoryId || "",
        warehouse,
        orderQty: vendor === "mckesson" ? (item.orderQty || 0) : (item.numberOfPkg || 0),
        unitCost,
        alternateId: item.ndc || "",
        drugName: item.drugName || "",
        storeName: item.storeName || "",
        mckItemId: item.mckItemId || "",
      };
    });

    // Fetch DailyMed UOM for each unique NDC
    const uniqueNdcs = [...new Set(rows.map(r => r.alternateId).filter(Boolean))];
    const uomMap = {};
    await Promise.all(
      uniqueNdcs.map(async ndc => {
        const drugName = rows.find(r => r.alternateId === ndc)?.drugName || "";
        const info = await fetchDailyMedUOM(ndc, drugName, apiKey);
        uomMap[ndc] = info;
      })
    );

    return Response.json({ rows, uomMap });
  } catch (err) {
    return Response.json({ error: err.message || "Unexpected error" }, { status: 500 });
  }
}
