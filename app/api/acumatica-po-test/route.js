/**
 * POST /api/acumatica-po-test
 *
 * READ-ONLY exploration of the Acumatica contract-based REST API.
 *
 * Body:
 *   { username, password }                    — reads first PO (any vendor)
 *   { username, password, vendorID }          — reads first PO for that vendor, with line details
 *
 * Returns JSON with what came back, or details about where things failed.
 */

const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, stage: "parse-body", error: "Invalid JSON body" });
  }

  const { username, password, vendorID } = body || {};
  if (!username || !password) {
    return json({ ok: false, stage: "validate-input", error: "username and password required" });
  }

  // --- Stage 1: Login ---
  let cookies = "";
  try {
    const loginRes = await fetch(`${BASE}/entity/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ name: username, password: password })
    });
    if (!loginRes.ok) {
      const text = await loginRes.text();
      return json({ ok: false, stage: "login", status: loginRes.status, body: text.slice(0, 500) });
    }
    const setCookie = loginRes.headers.get("set-cookie") || "";
    cookies = setCookie.split(",").map(c => c.split(";")[0].trim()).filter(Boolean).join("; ");
  } catch (err) {
    return json({ ok: false, stage: "login", error: String(err) });
  }

  // --- Stage 2: Read a PO ---
  // If vendorID provided, filter and expand details. Otherwise just $top=1.
  let url;
  if (vendorID) {
    const filter = encodeURIComponent(`VendorID eq '${vendorID}'`);
    url = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder?$filter=${filter}&$top=1&$expand=Details`;
  } else {
    url = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder?$top=1`;
  }

  let poData = null;
  try {
    const readRes = await fetch(url, {
      method: "GET",
      headers: { "Accept": "application/json", "Cookie": cookies }
    });
    const text = await readRes.text();
    if (!readRes.ok) {
      await logout(cookies);
      return json({ ok: false, stage: "read-po", status: readRes.status, body: text.slice(0, 1000) });
    }
    try {
      poData = JSON.parse(text);
    } catch {
      await logout(cookies);
      return json({ ok: false, stage: "parse-response", body: text.slice(0, 500) });
    }
  } catch (err) {
    await logout(cookies);
    return json({ ok: false, stage: "read-po", error: String(err) });
  }

  await logout(cookies);

  const first = Array.isArray(poData) && poData.length > 0 ? poData[0] : null;
  if (!first) {
    return json({ ok: true, stage: "done", note: "No POs returned for that filter", queryUrl: url });
  }

  // Build a structured summary so we can see the shape clearly without dumping everything.
  const headerFields = {};
  Object.keys(first).forEach(k => {
    const v = first[k];
    if (v && typeof v === "object" && "value" in v) headerFields[k] = v.value;
  });

  const details = Array.isArray(first.Details) ? first.Details.map(d => {
    const out = {};
    Object.keys(d).forEach(k => {
      const v = d[k];
      if (v && typeof v === "object" && "value" in v) out[k] = v.value;
    });
    return out;
  }) : [];

  return json({
    ok: true,
    stage: "done",
    apiVersion: API_VERSION,
    queryUrl: url,
    headerFieldNames: Object.keys(first),
    headerValues: headerFields,
    detailLineCount: details.length,
    firstDetailFieldNames: details[0] ? Object.keys(details[0]) : [],
    firstDetailValues: details[0] || null
  });
}

async function logout(cookies) {
  try {
    await fetch(`${BASE}/entity/auth/logout`, {
      method: "POST",
      headers: { "Cookie": cookies }
    });
  } catch {}
}

function json(payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
