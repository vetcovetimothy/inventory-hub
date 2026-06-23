/**
 * GET /api/oos-total-items-ever
 *
 * Pulls the per-vendor total manufacturer-no/vendor pair counts from Snowflake.
 * The OOS Tracker uses TOTAL_MNO_VENDOR_PAIRS as the denominator for the
 * "% Manufacturer Nos Out of Stock" metric (vendor OOS count / total).
 *
 * Uses the same key-pair (JWT) auth as the connection tester. Self-contained on
 * purpose so it doesn't depend on the throwaway /api/snowflake-test route.
 *
 * Table is configurable via env (SNOWFLAKE_OOS_TOTALS_TABLE) so it can be repointed
 * from a personal schema to a governed one later without a code change.
 * Default: PERSONAL.TIMOTHY.TOTALITEMSEVER
 *
 * Returns: { ok, count, rows: [ { VENDOR_NAME, TOTAL_MNO_VENDOR_PAIRS, LOADED_AT } ... ] }
 */

import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

var OOS_TABLE = process.env.SNOWFLAKE_OOS_TOTALS_TABLE || "PERSONAL.TIMOTHY.TOTALITEMSEVER";
var COLUMNS = ["VENDOR_NAME", "TOTAL_MNO_VENDOR_PAIRS", "LOADED_AT"];

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function loadPrivateKey(raw, passphrase) {
  var pem = raw.indexOf("-----BEGIN") >= 0 ? raw : Buffer.from(raw, "base64").toString("utf8");
  return crypto.createPrivateKey(passphrase ? { key: pem, passphrase: passphrase } : { key: pem });
}
function json(payload, status) {
  return new Response(JSON.stringify(payload), { status: status || 200, headers: { "Content-Type": "application/json" } });
}

export async function GET(req) {
  var url = new URL(req.url);
  var accountOverride = url.searchParams.get("account");

  var account = process.env.SNOWFLAKE_ACCOUNT || "";
  var user = process.env.SNOWFLAKE_USER || "";
  var rawKey = process.env.SNOWFLAKE_PRIVATE_KEY || "";
  var passphrase = process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE || "";
  var warehouse = process.env.SNOWFLAKE_WAREHOUSE || "";
  var database = process.env.SNOWFLAKE_DATABASE || "";
  var schema = process.env.SNOWFLAKE_SCHEMA || "";
  var role = process.env.SNOWFLAKE_ROLE || "";
  if (!account || !user || !rawKey || !warehouse) {
    return json({ ok: false, stage: "env-vars", error: "Missing required Snowflake environment variables." });
  }

  var host = account.toLowerCase() + ".snowflakecomputing.com";
  var claimAccount = (accountOverride || account).split(".")[0].toUpperCase();
  var claimUser = user.toUpperCase();

  // Sign JWT
  var jwt;
  try {
    var privKey = loadPrivateKey(rawKey, passphrase || undefined);
    var spkiDer = crypto.createPublicKey(privKey).export({ type: "spki", format: "der" });
    var fp = "SHA256:" + crypto.createHash("sha256").update(spkiDer).digest("base64");
    var now = Math.floor(Date.now() / 1000);
    var header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    var payload = b64url(JSON.stringify({ iss: claimAccount + "." + claimUser + "." + fp, sub: claimAccount + "." + claimUser, iat: now, exp: now + 3600 }));
    var signingInput = header + "." + payload;
    jwt = signingInput + "." + b64url(crypto.sign("RSA-SHA256", Buffer.from(signingInput), privKey));
  } catch (e) {
    return json({ ok: false, stage: "sign-jwt", error: String(e && e.message || e) });
  }

  var headers = {
    "Authorization": "Bearer " + jwt,
    "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
    "Content-Type": "application/json",
    "Accept": "application/json"
  };

  // Submit the query
  var statement = "SELECT " + COLUMNS.join(", ") + " FROM " + OOS_TABLE;
  var body = {
    statement: statement,
    timeout: 60,
    warehouse: warehouse || undefined,
    database: database || undefined,
    schema: schema || undefined,
    role: role || undefined
  };

  var res, text, parsed;
  try {
    res = await fetch("https://" + host + "/api/v2/statements", { method: "POST", headers: headers, body: JSON.stringify(body) });
    text = await res.text();
  } catch (e) {
    return json({ ok: false, stage: "http", error: String(e && e.message || e) });
  }
  try { parsed = JSON.parse(text); } catch (e) { parsed = null; }

  if (res.status !== 200 || !parsed) {
    var msg = parsed ? (parsed.message || parsed.code || "") : text.slice(0, 800);
    var hint = (res.status === 401 || res.status === 403)
      ? "Auth/permission problem. Confirm the connection test passes, and that the service role has SELECT on " + OOS_TABLE + " (USAGE on its database + schema)."
      : (res.status === 422 || res.status === 400) ? "Query problem — check the table name (" + OOS_TABLE + ") and the role's access." : "";
    return json({ ok: false, stage: "snowflake", httpStatus: res.status, message: msg, hint: hint, table: OOS_TABLE }, 200);
  }

  // Map column metadata -> names, then assemble row objects.
  var meta = (parsed.resultSetMetaData && parsed.resultSetMetaData.rowType) || [];
  var colNames = meta.map(function (c) { return c.name; });
  var statementHandle = parsed.statementHandle;
  var partitionInfo = (parsed.resultSetMetaData && parsed.resultSetMetaData.partitionInfo) || [];

  function toObjects(dataRows) {
    return (dataRows || []).map(function (vals) {
      var o = {};
      colNames.forEach(function (n, i) { o[n] = vals[i]; });
      return o;
    });
  }

  var rows = toObjects(parsed.data);

  // If the result set spans multiple partitions, fetch the rest.
  try {
    for (var p = 1; p < partitionInfo.length; p++) {
      var pres = await fetch("https://" + host + "/api/v2/statements/" + encodeURIComponent(statementHandle) + "?partition=" + p, { method: "GET", headers: headers });
      if (!pres.ok) break;
      var pjson = await pres.json();
      rows = rows.concat(toObjects(pjson.data));
    }
  } catch (e) { /* return what we have */ }

  return json({ ok: true, count: rows.length, table: OOS_TABLE, rows: rows });
}
