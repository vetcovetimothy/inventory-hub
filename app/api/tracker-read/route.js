/**
 * POST /api/tracker-read
 *
 * Reads the "PO No." / "PO Number" column of a receiving tracker tab and returns
 * the set of PO references already present. Used by PO reconciliation to skip POs
 * that are already logged. Reads as the Google service account.
 *
 * Body: { sheetId, tab }
 * Returns: { ok, tab, poHeader, refs: ["17775386", "PO009553", ...] }
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
function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, ""); }

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
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  }));
  var signingInput = header + "." + claim;
  var assertion = signingInput + "." + b64url(crypto.sign("RSA-SHA256", Buffer.from(signingInput), privKey));
  var resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: assertion }),
  });
  if (!resp.ok) throw new Error("SA token exchange failed: " + (await resp.text()));
  return (await resp.json()).access_token;
}

export async function POST(request) {
  try {
    var body = await request.json();
    var sheetId = body.sheetId, tab = body.tab;
    var withLines = !!body.withLines; // also return [{po, ndc}] pairs for line-level dedup
    if (!sheetId || !tab) return json({ ok: false, error: "Missing sheetId/tab" }, 400);

    var token = await getServiceAccountToken();
    var base = "https://sheets.googleapis.com/v4/spreadsheets/" + sheetId;
    var authHeaders = { Authorization: "Bearer " + token };

    // Find the header row + the PO column within the first several rows. When
    // withLines is set, also locate the NDC column so we can return PO+NDC pairs.
    var hdrResp = await fetch(base + "/values/" + encodeURIComponent(tab + "!A1:BZ8"), { headers: authHeaders });
    if (!hdrResp.ok) return json({ ok: false, stage: "read-header", error: await hdrResp.text() }, 502);
    var hdrRows = (await hdrResp.json()).values || [];
    var PO_HEADERS = ["pono", "ponumber", "ponbr"];
    var NDC_HEADERS = ["ndc", "skundc", "skundcs"];
    var poIdx = -1, poHeader = null, headerRowNum = 0, ndcIdx = -1;
    for (var h = 0; h < hdrRows.length && poIdx < 0; h++) {
      var rr = hdrRows[h] || [];
      for (var c = 0; c < rr.length; c++) {
        if (PO_HEADERS.indexOf(norm(rr[c])) !== -1) { poIdx = c; poHeader = rr[c]; headerRowNum = h + 1; }
        if (withLines && ndcIdx < 0 && NDC_HEADERS.indexOf(norm(rr[c])) !== -1) { ndcIdx = c; }
      }
    }
    if (poIdx < 0) return json({ ok: false, stage: "po-column", error: "No 'PO No.' / 'PO Number' column found in tab '" + tab + "'." }, 400);

    var letter = colLetter(poIdx);
    var colResp = await fetch(base + "/values/" + encodeURIComponent(tab + "!" + letter + ":" + letter), { headers: authHeaders });
    if (!colResp.ok) return json({ ok: false, stage: "read-column", error: await colResp.text() }, 502);
    var col = (await colResp.json()).values || [];
    var seen = {}, refs = [];
    for (var i = headerRowNum; i < col.length; i++) { // skip header row and above
      var v = col[i] && col[i][0] != null ? String(col[i][0]).trim() : "";
      if (v && !seen[v]) { seen[v] = 1; refs.push(v); }
    }

    // Optional: PO+NDC pairs for line-level dedup. Reads the NDC column alongside
    // the PO column, row-aligned, and returns digits-only NDC keyed to its PO.
    var pairs = null;
    if (withLines && ndcIdx >= 0) {
      var ndcLetter = colLetter(ndcIdx);
      var ndcResp = await fetch(base + "/values/" + encodeURIComponent(tab + "!" + ndcLetter + ":" + ndcLetter), { headers: authHeaders });
      if (ndcResp.ok) {
        var ndcCol = ((await ndcResp.json()).values) || [];
        pairs = [];
        var maxLen = Math.max(col.length, ndcCol.length);
        for (var j = headerRowNum; j < maxLen; j++) {
          var pov = col[j] && col[j][0] != null ? String(col[j][0]).trim() : "";
          var ndcv = ndcCol[j] && ndcCol[j][0] != null ? String(ndcCol[j][0]).trim() : "";
          if (!pov && !ndcv) continue;
          pairs.push({ po: pov, ndc: ndcv, ndcDigits: ndcv.replace(/\D/g, "") });
        }
      }
    }

    return json({ ok: true, tab: tab, poHeader: poHeader, refs: refs, pairs: pairs, ndcFound: ndcIdx >= 0 });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}
