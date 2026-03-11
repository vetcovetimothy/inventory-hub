// /app/api/parse-xlsx/route.js — Parse XLSX files server-side
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

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
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
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
        // Skip sheets that fail to parse
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
