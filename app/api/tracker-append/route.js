/**
 * POST /api/tracker-append
 *
 * Appends rows to a specific tab of a specific Google Sheet, writing as the
 * Google service account. Used by the Generic PO Translator's "Add to tracker"
 * action. Append finds the real last row and writes after it, ignoring any
 * active filter and never overwriting existing data.
 *
 * Body: { sheetId: "...", tab: "RECEIVING - SEVEN HILLS", rows: [[...], ...] }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "crypto";

function json(payload, status) {
  return new Response(JSON.stringify(payload), { status: status || 200, headers: { "Content-Type": "application/json" } });
}
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function colLetter(idx) {
  var s = "";
  idx = idx + 1;
  while (idx > 0) { var m = (idx - 1) % 26; s = String.fromCharCode(65 + m) + s; idx = Math.floor((idx - 1) / 26); }
  return s;
}

async function getServiceAccountToken() {
  var email = process.env.GOOGLE_SA_EMAIL || "";
  var rawKey = process.env.GOOGLE_SA_PRIVATE_KEY || "";
  if (!email || !rawKey) throw new Error("Missing GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY");
  var pem = rawKey.indexOf("-----BEGIN") >= 0 ? rawKey.replace(/\\n/g, "\n") : Buffer.from(rawKey, "base64").toString("utf8");
  var privKey = crypto.createPrivateKey({ key: pem });
  var now = Math.floor(Date.now() / 1000);
  var header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  var claim = b64url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  var signingInput = header + "." + claim;
  var assertion = signingInput + "." + b64url(crypto.sign("RSA-SHA256", Buffer.from(signingInput), privKey));
  var resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: assertion }),
  });
  if (!resp.ok) throw new Error("SA token exchange failed: " + (await resp.text()));
  var data = await resp.json();
  return data.access_token;
}

export async function POST(request) {
  try {
    var body = await request.json();
    var sheetId = body.sheetId;
    var tab = body.tab;
    var rows = Array.isArray(body.rows) ? body.rows : [];
    if (!sheetId) return json({ ok: false, error: "Missing sheetId" }, 400);
    if (!tab) return json({ ok: false, error: "Missing tab" }, 400);
    if (!rows.length) return json({ ok: false, error: "No rows to append" }, 400);

    var token = await getServiceAccountToken();
    var base = "https://sheets.googleapis.com/v4/spreadsheets/" + sheetId;
    var authHeaders = { Authorization: "Bearer " + token, "Content-Type": "application/json" };

    // Verify the tab exists so we return a clear error instead of a cryptic 400.
    var metaResp = await fetch(base + "?fields=sheets.properties.title", { headers: authHeaders });
    if (!metaResp.ok) return json({ ok: false, stage: "sheet-meta", error: await metaResp.text() }, 502);
    var meta = await metaResp.json();
    var titles = (meta.sheets || []).map(function (s) { return s.properties.title; });
    if (titles.indexOf(tab) === -1) return json({ ok: false, stage: "tab-check", error: "Tab '" + tab + "' not found. Available: " + titles.join(", ") }, 400);

    // Find the last row that has an actual NDC (column B), then write to the row
    // right after it. Bare append (even scoped to A:H) treats pre-formatted empty
    // rows as part of the table and drops new rows into the blank gap below the
    // real data. Reading VALUES in column B ignores formatting entirely.
    var colResp = await fetch(base + "/values/" + encodeURIComponent(tab + "!B:B"), { headers: authHeaders });
    if (!colResp.ok) return json({ ok: false, stage: "read-column", error: await colResp.text() }, 502);
    var colData = await colResp.json();
    var col = colData.values || [];
    var lastData = 0;
    for (var i = 0; i < col.length; i++) {
      var cell = col[i] && col[i][0] != null ? String(col[i][0]).trim() : "";
      if (cell) lastData = i + 1; // 1-based row number of the last non-empty NDC
    }
    var nextRow = (lastData || 1) + 1;

    // USER_ENTERED so the BOH formula and dates are interpreted, not stored as text.
    var url = base + "/values/" + encodeURIComponent(tab + "!A" + nextRow) + "?valueInputOption=USER_ENTERED";
    var writeResp = await fetch(url, { method: "PUT", headers: authHeaders, body: JSON.stringify({ values: rows }) });
    if (!writeResp.ok) return json({ ok: false, stage: "write", error: await writeResp.text() }, 502);

    // Optional: write additional columns located BY HEADER NAME, so each lands in
    // the right column even though positions vary between tabs and aren't part of
    // the fixed A-H block. Accepts either `extraColumn` (single, legacy) or
    // `extraColumns` (array). Each: { header, values:[...] }. Headers not found on
    // the tab are silently skipped and noted.
    var extraList = [];
    if (body.extraColumn && body.extraColumn.header) extraList.push(body.extraColumn);
    if (Array.isArray(body.extraColumns)) extraList = extraList.concat(body.extraColumns);
    var extraNote = null;
    if (extraList.length) {
      var hdrResp = await fetch(base + "/values/" + encodeURIComponent(tab + "!A1:BZ8"), { headers: authHeaders });
      if (hdrResp.ok) {
        var hdrRows = (await hdrResp.json()).values || [];
        var notFound = [];
        for (var ex = 0; ex < extraList.length; ex++) {
          var extra = extraList[ex];
          if (!extra || !extra.header || !Array.isArray(extra.values) || !extra.values.length) continue;
          var want = String(extra.header).replace(/\s+/g, " ").trim().toLowerCase();
          var targetIdx = -1;
          for (var h = 0; h < hdrRows.length && targetIdx < 0; h++) {
            var rr = hdrRows[h] || [];
            for (var c = 0; c < rr.length; c++) {
              if (String(rr[c] == null ? "" : rr[c]).replace(/\s+/g, " ").trim().toLowerCase() === want) { targetIdx = c; break; }
            }
          }
          if (targetIdx >= 0) {
            var letter = colLetter(targetIdx);
            // Preserve leading zeros for text-like numeric columns (e.g. an NDC
            // "00054329446" that Sheets would otherwise store as 54329446). Under
            // USER_ENTERED, a leading apostrophe forces the cell to text and the
            // apostrophe itself doesn't display. Applied when the caller marks the
            // column asText, or when the header is the NDC-unformatted column.
            var forceText = extra.asText === true || want === "ndc unformatted";
            var colVals = extra.values.map(function (v) {
              if (v == null || v === "") return [""];
              if (forceText) {
                var s = String(v);
                return [s.charAt(0) === "'" ? s : "'" + s];
              }
              return [v];
            });
            var eurl = base + "/values/" + encodeURIComponent(tab + "!" + letter + nextRow) + "?valueInputOption=USER_ENTERED";
            var eResp = await fetch(eurl, { method: "PUT", headers: authHeaders, body: JSON.stringify({ values: colVals }) });
            if (!eResp.ok) notFound.push(extra.header + " (write failed)");
          } else {
            notFound.push(extra.header + " (header not found)");
          }
        }
        if (notFound.length) extraNote = "skipped: " + notFound.join("; ");
      }
    }

    return json({ ok: true, appended: rows.length, tab: tab, startRow: nextRow, extraNote: extraNote });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}
