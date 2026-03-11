// /app/api/parse-xlsx/route.js — Parse XLSX files server-side
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

function tryParseSheet(ws) {
  // Try raw: false first (preserves leading zeros in IDs like 0001-07)
  try {
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
    if (rows.length > 0) return rows;
  } catch (e) { /* fall through */ }

  // Fallback: raw: true (numeric cells stay as numbers)
  try {
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (rows.length > 0) return rows;
  } catch (e) { /* fall through */ }

  // Last resort: read as 2D array and manually build objects
  try {
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (aoa.length < 2) return [];
    const headers = aoa[0].map(h => String(h).trim());
    return aoa.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = row[i] != null ? String(row[i]) : ""; });
      return obj;
    }).filter(row => Object.values(row).some(v => v !== ""));
  } catch (e) { return []; }
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });

    // Try each sheet to find one with "Inventory ID" column
    let bestRows = null;
    let bestSheet = null;

    for (const name of wb.SheetNames) {
      try {
        const ws = wb.Sheets[name];
        if (!ws) continue;
        const rows = tryParseSheet(ws);
        if (rows.length === 0) continue;

        // Check if this sheet has the expected columns
        const cols = Object.keys(rows[0]);
        const hasInventoryId = cols.some(c => c.trim().toLowerCase() === "inventory id");
        
        if (hasInventoryId) {
          bestRows = rows;
          bestSheet = name;
          break;
        }

        // Keep the first parseable sheet with data as fallback
        if (!bestRows) {
          bestRows = rows;
          bestSheet = name;
        }
      } catch (sheetErr) {
        continue;
      }
    }

    if (!bestRows || bestRows.length === 0) {
      return NextResponse.json({ 
        error: "No readable data found. Sheets in file: " + wb.SheetNames.join(", ") 
      }, { status: 400 });
    }
    
    return NextResponse.json({ rows: bestRows, count: bestRows.length, sheet: bestSheet });
  } catch (err) {
    return NextResponse.json({ error: "Failed to parse XLSX: " + err.message }, { status: 500 });
  }
}
