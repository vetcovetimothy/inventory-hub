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

    // USER_ENTERED so the BOH formula and dates are interpreted, not stored as text.
    var url = base + "/values/" + encodeURIComponent(tab) + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS";
    var appendResp = await fetch(url, { method: "POST", headers: authHeaders, body: JSON.stringify({ values: rows }) });
    if (!appendResp.ok) return json({ ok: false, stage: "append", error: await appendResp.text() }, 502);
    var data = await appendResp.json();
    var appended = (data.updates && data.updates.updatedRows) || rows.length;
    return json({ ok: true, appended: appended, tab: tab });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}
