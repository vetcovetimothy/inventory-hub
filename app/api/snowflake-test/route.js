/**
 * GET /api/snowflake-test
 *
 * Connection tester for the Snowflake key-pair (JWT) integration. It does NOT
 * touch any business data — it just signs a JWT from the environment variables
 * and runs a trivial CURRENT_* query against the Snowflake SQL API so you can
 * confirm auth + role + warehouse before we build the real data route.
 *
 * Open it in a browser:
 *   https://inventory-hub-two.vercel.app/api/snowflake-test
 *
 * Account-identifier debugging: the org-account form vs. the bare account
 * locator is the #1 cause of "JWT token is invalid". If the default fails, try
 * the locator without changing the env var:
 *   /api/snowflake-test?account=VY71407
 *
 * Env vars expected (set in Vercel → Settings → Environment Variables):
 *   SNOWFLAKE_ACCOUNT             org-account form, e.g. vetcove-vy71407
 *   SNOWFLAKE_USER                the service user's LOGIN_NAME
 *   SNOWFLAKE_PRIVATE_KEY         the private key (base64 of the full PEM, or raw PEM)
 *   SNOWFLAKE_PRIVATE_KEY_PASSPHRASE   only if the key is encrypted
 *   SNOWFLAKE_WAREHOUSE / SNOWFLAKE_DATABASE / SNOWFLAKE_SCHEMA / SNOWFLAKE_ROLE
 *
 * SECURITY: never returns the private key or passphrase. The iss/sub/fingerprint
 * it echoes are not secrets. Delete this file once the connection is confirmed.
 */

import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function loadPrivateKey(raw, passphrase) {
  // Accept either a base64-encoded PEM (recommended for env vars) or a raw PEM.
  var pem = raw.indexOf("-----BEGIN") >= 0 ? raw : Buffer.from(raw, "base64").toString("utf8");
  var opts = passphrase ? { key: pem, passphrase: passphrase } : { key: pem };
  return crypto.createPrivateKey(opts);
}

function json(payload, status) {
  return new Response(JSON.stringify(payload, null, 2), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

export async function GET(req) {
  var url = new URL(req.url);
  var accountOverride = url.searchParams.get("account"); // optional, for claims only

  // 1) Check env vars are present (report presence only, never values)
  var env = {
    SNOWFLAKE_ACCOUNT: process.env.SNOWFLAKE_ACCOUNT || "",
    SNOWFLAKE_USER: process.env.SNOWFLAKE_USER || "",
    SNOWFLAKE_PRIVATE_KEY: process.env.SNOWFLAKE_PRIVATE_KEY || "",
    SNOWFLAKE_PRIVATE_KEY_PASSPHRASE: process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE || "",
    SNOWFLAKE_WAREHOUSE: process.env.SNOWFLAKE_WAREHOUSE || "",
    SNOWFLAKE_DATABASE: process.env.SNOWFLAKE_DATABASE || "",
    SNOWFLAKE_SCHEMA: process.env.SNOWFLAKE_SCHEMA || "",
    SNOWFLAKE_ROLE: process.env.SNOWFLAKE_ROLE || ""
  };
  var present = {};
  Object.keys(env).forEach(function (k) { present[k] = env[k].length > 0; });
  var required = ["SNOWFLAKE_ACCOUNT", "SNOWFLAKE_USER", "SNOWFLAKE_PRIVATE_KEY", "SNOWFLAKE_WAREHOUSE"];
  var missing = required.filter(function (k) { return !present[k]; });
  if (missing.length > 0) {
    return json({ ok: false, stage: "env-vars", missing: missing, present: present, hint: "Add the missing variables in Vercel and redeploy." });
  }

  // 2) Build claim identifiers
  // URL host uses the account as-is (org-account form, e.g. vetcove-vy71407).
  var host = env.SNOWFLAKE_ACCOUNT.toLowerCase() + ".snowflakecomputing.com";
  // Claims use the account UPPERCASED with region/cloud/subdomain stripped (everything before the first dot).
  var claimAccount = (accountOverride || env.SNOWFLAKE_ACCOUNT).split(".")[0].toUpperCase();
  var claimUser = env.SNOWFLAKE_USER.toUpperCase();

  // 3) Load the private key + derive the public-key fingerprint Snowflake expects
  var privKey, fingerprint;
  try {
    privKey = loadPrivateKey(env.SNOWFLAKE_PRIVATE_KEY, env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE || undefined);
    var spkiDer = crypto.createPublicKey(privKey).export({ type: "spki", format: "der" });
    fingerprint = "SHA256:" + crypto.createHash("sha256").update(spkiDer).digest("base64");
  } catch (e) {
    return json({ ok: false, stage: "load-key", error: String(e && e.message || e), hint: "The private key didn't parse. Confirm it's a PKCS#8 PEM (BEGIN PRIVATE KEY), base64-encoded whole, with passphrase set if encrypted." });
  }

  // 4) Sign a short-lived RS256 JWT (no external dependency)
  var now = Math.floor(Date.now() / 1000);
  var iss = claimAccount + "." + claimUser + "." + fingerprint;
  var sub = claimAccount + "." + claimUser;
  var jwt;
  try {
    var header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    var payload = b64url(JSON.stringify({ iss: iss, sub: sub, iat: now, exp: now + 3600 }));
    var signingInput = header + "." + payload;
    var signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), privKey);
    jwt = signingInput + "." + b64url(signature);
  } catch (e) {
    return json({ ok: false, stage: "sign-jwt", error: String(e && e.message || e) });
  }

  // 5) Call the SQL API with a trivial, data-free query
  var statement =
    "SELECT CURRENT_ACCOUNT() AS ACCOUNT, CURRENT_USER() AS USERNAME, CURRENT_ROLE() AS ROLE, " +
    "CURRENT_WAREHOUSE() AS WAREHOUSE, CURRENT_DATABASE() AS DATABASE, CURRENT_SCHEMA() AS SCHEMA, " +
    "CURRENT_VERSION() AS VERSION";
  var body = {
    statement: statement,
    timeout: 30,
    warehouse: env.SNOWFLAKE_WAREHOUSE || undefined,
    database: env.SNOWFLAKE_DATABASE || undefined,
    schema: env.SNOWFLAKE_SCHEMA || undefined,
    role: env.SNOWFLAKE_ROLE || undefined
  };

  var diag = { host: host, iss: iss, sub: sub, fingerprint: fingerprint, claimAccount: claimAccount, claimUser: claimUser };

  var res, text;
  try {
    res = await fetch("https://" + host + "/api/v2/statements", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + jwt,
        "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(body)
    });
    text = await res.text();
  } catch (e) {
    return json({ ok: false, stage: "http", error: String(e && e.message || e), diag: diag, hint: "Network error reaching Snowflake. Check the host and any network policy / IP allowlist on the service user." });
  }

  var parsed = null;
  try { parsed = JSON.parse(text); } catch (e) {}

  if (res.status === 200 && parsed) {
    // Map the single result row to its column names for a readable output
    var cols = (parsed.resultSetMetaData && parsed.resultSetMetaData.rowType) || [];
    var row = (parsed.data && parsed.data[0]) || [];
    var result = {};
    cols.forEach(function (c, i) { result[c.name] = row[i]; });
    return json({ ok: true, stage: "connected", connection: result, diag: diag });
  }

  // Failure — surface Snowflake's message and a targeted hint
  var sfMessage = parsed ? (parsed.message || parsed.code || "") : text.slice(0, 800);
  var hint = "";
  if (res.status === 401 || res.status === 403) {
    hint = "Auth failed. Most likely the account form in the JWT claims is wrong (try ?account=<locator>), the public key isn't registered on this user, or the user name isn't the LOGIN_NAME. A network policy / IP allowlist can also block Vercel's dynamic egress IPs.";
  } else if (res.status === 400) {
    hint = "Bad request — often a missing/invalid warehouse, database, schema, or role value.";
  }
  return json({ ok: false, stage: "snowflake", httpStatus: res.status, message: sfMessage, hint: hint, diag: diag }, 200);
}
