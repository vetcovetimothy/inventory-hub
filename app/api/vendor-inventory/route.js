/**
 * GET /api/vendor-inventory
 *
 * Pulls the vendor inventory table from Snowflake (per-SKU stock/allocated/reported
 * quantities, backorder status, package size, per warehouse). The table is refreshed
 * upstream 3x/day. Used by:
 *   - the Cycle Counting tool (auto-feed, replacing the manual Vendor Inventory CSV)
 *   - the Vendor Inventory hub tab (view/search)
 *
 * Same key-pair (JWT) auth + multi-partition fetch as the other Snowflake routes.
 * Table is configurable via env (SNOWFLAKE_VENDOR_INVENTORY_TABLE).
 *
 * Returns: { ok, count, table, rows: [ { VENDOR_NAME, VENDOR_INVENTORY_SKU, ... } ] }
 */

import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

var VI_TABLE = process.env.SNOWFLAKE_VENDOR_INVENTORY_TABLE || "PERSONAL.TIMOTHY.VENDOR_INVENTORY";
var COLUMNS = [
  "VENDOR_NAME", "VENDOR_INVENTORY_SKU", "MANUFACTURER_NAME", "MANUFACTURER_NO",
  "PRODUCT_LINE_NAME", "STOCK_QUANTITY", "ALLOCATED_QUANTITY", "REPORTED_QUANTITY",
  "IS_BACKORDERED", "BACKORDER_ESTIMATED_AVAILABILITY", "WAREHOUSE_SLUG",
  "LAST_SCRAPED_AT", "PACKAGE_SIZE",
];

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

// KV cache (written in chunks by the vendor-inventory-cache cron, since the full
// set exceeds a single KV value's size limit).
var KV_URL = process.env.KV_REST_API_URL;
var KV_TOKEN = process.env.KV_REST_API_TOKEN;
var MANIFEST_KEY = "vi-cache-manifest";
var CHUNK_PREFIX = "vi-cache-";
async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  var resp = await fetch(KV_URL + "/get/" + encodeURIComponent(key), { headers: { Authorization: "Bearer " + KV_TOKEN }, cache: "no-store" });
  if (!resp.ok) return null;
  var j = await resp.json();
  if (!j || j.result == null) return null;
  try { return JSON.parse(j.result); } catch (e) { return j.result; }
}
async function readCache() {
  var manifest = await kvGet(MANIFEST_KEY);
  if (!manifest || !manifest.chunks) return null;
  var rows = [];
  for (var i = 0; i < manifest.chunks; i++) {
    var chunk = await kvGet(CHUNK_PREFIX + i);
    if (!Array.isArray(chunk)) return null; // incomplete cache — treat as miss
    rows = rows.concat(chunk);
  }
  return { rows: rows, cachedAt: manifest.cachedAt, count: manifest.count };
}

export async function GET(req) {
  var url = new URL(req.url);
  var accountOverride = url.searchParams.get("account");

  // Cached mode: reassemble the chunked KV cache for an instant response. Falls
  // through to a live Snowflake query if the cache is missing/incomplete.
  if (url.searchParams.get("cached") === "1") {
    try {
      var cached = await readCache();
      if (cached && cached.rows && cached.rows.length) {
        return json({ ok: true, count: cached.rows.length, cached: true, cachedAt: cached.cachedAt, rows: cached.rows });
      }
    } catch (e) { /* fall through to live query */ }
  }

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

  var statement = "SELECT " + COLUMNS.join(", ") + " FROM " + VI_TABLE;
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
      ? "Auth/permission problem. Confirm the service role has SELECT on " + VI_TABLE + " (USAGE on its database + schema)."
      : (res.status === 422 || res.status === 400) ? "Query problem — check the table name (" + VI_TABLE + ") and the role's access." : "";
    return json({ ok: false, stage: "snowflake", httpStatus: res.status, message: msg, hint: hint, table: VI_TABLE }, 200);
  }

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

  // Multi-partition result sets (this table is ~10k+ rows) — fetch the rest.
  try {
    for (var p = 1; p < partitionInfo.length; p++) {
      var pres = await fetch("https://" + host + "/api/v2/statements/" + encodeURIComponent(statementHandle) + "?partition=" + p, { method: "GET", headers: headers });
      if (!pres.ok) break;
      var pjson = await pres.json();
      rows = rows.concat(toObjects(pjson.data));
    }
  } catch (e) { /* return what we have */ }

  return json({ ok: true, count: rows.length, table: VI_TABLE, rows: rows });
}
