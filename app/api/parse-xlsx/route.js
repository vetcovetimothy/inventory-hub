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
    const wb = XLSX.read(new Uint8Array(buffer), { type: "array", cellText: true, raw: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    
    // Use raw: false and cellText: true to preserve leading zeros
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
    
    return NextResponse.json({ rows, count: rows.length });
  } catch (err) {
    return NextResponse.json({ error: "Failed to parse XLSX: " + err.message }, { status: 500 });
  }
}
