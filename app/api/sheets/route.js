// /app/api/sheets/route.js — Fetch published Google Sheet CSVs
export const runtime = "edge";
export const dynamic = "force-dynamic";

const SHEET_URLS = {
  "TP-NY": process.env.TRACKER_SHEET_URL_NY,
  "TP-OH": process.env.TRACKER_SHEET_URL_OH,
  "TP-CA": process.env.TRACKER_SHEET_URL_CA,
  "GGM-KY": process.env.TRACKER_SHEET_URL_GGM_KY,
  "GGM-AZ": process.env.TRACKER_SHEET_URL_GGM_AZ,
};

function parseCSV(text) {
  const lines = text.split("\n").map(l => l.replace(/\r/g, ""));
  if (lines.length < 2) return [];

  let headerIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if ((lines[i].includes("Supplier") || lines[i].includes("Manufacturer")) && lines[i].includes("NDC")) {
      headerIdx = i;
      break;
    }
  }

  const headers = [];
  let inQ = false, cur = "";
  for (let c = 0; c < lines[headerIdx].length; c++) {
    const ch = lines[headerIdx][c];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === "," && !inQ) { headers.push(cur.trim()); cur = ""; }
    else { cur += ch; }
  }
  headers.push(cur.trim());

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = [];
    let iq = false, cell = "";
    for (let c = 0; c < lines[i].length; c++) {
      const ch = lines[i][c];
      if (ch === '"') { iq = !iq; }
      else if (ch === "," && !iq) { vals.push(cell.trim()); cell = ""; }
      else { cell += ch; }
    }
    vals.push(cell.trim());

    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] || ""; });
    if (obj["Supplier"] || obj["Manufacturer"] || obj["NDC"] || obj["Product Description"]) {
      rows.push(obj);
    }
  }
  return rows;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const wh = searchParams.get("wh");
    if (!wh || !SHEET_URLS[wh]) {
      return Response.json({ error: "Invalid warehouse. Use: TP-NY, TP-OH, TP-CA, GGM-KY, GGM-AZ" }, { status: 400 });
    }

    const url = SHEET_URLS[wh];
    if (!url) {
      return Response.json({ error: "Sheet URL not configured for " + wh }, { status: 500 });
    }

    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) {
      return Response.json({ error: "Failed to fetch sheet: " + resp.status }, { status: 502 });
    }

    const text = await resp.text();
    const rows = parseCSV(text);

    return Response.json({ data: rows, count: rows.length }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
