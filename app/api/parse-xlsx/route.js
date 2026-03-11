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
    const ws = wb.Sheets[wb.SheetNames[0]];
    
    // Use raw: false to preserve leading zeros in Inventory IDs like 0001-07
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
    
    return NextResponse.json({ rows, count: rows.length });
  } catch (err) {
    return NextResponse.json({ error: "Failed to parse XLSX: " + err.message }, { status: 500 });
  }
}
