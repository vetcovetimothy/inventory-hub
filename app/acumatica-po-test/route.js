/**
 * POST /api/acumatica-po-test
 *
 * READ-ONLY test of the Acumatica contract-based REST API.
 * Logs in, reads one purchase order, logs out. Creates nothing.
 *
 * Body: { username: string, password: string }
 *
 * Returns:
 *   200 { ok: true, po: {...} }    — success, with the PO data
 *   200 { ok: false, stage: "...", status: 401, body: "..." } — failed at some stage, with details
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

  const { username, password } = body || {};
  if (!username || !password) {
    return json({ ok: false, stage: "validate-input", error: "username and password required" });
  }

  // --- Stage 1: Login ---
  // The contract-based REST API requires a session login at /entity/auth/login.
  // The response sets cookies that authenticate subsequent /entity/Default/... calls.
  let cookies = "";
  try {
    const loginRes = await fetch(`${BASE}/entity/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ name: username, password: password })
    });

    if (!loginRes.ok) {
      const text = await loginRes.text();
      return json({
        ok: false,
        stage: "login",
        status: loginRes.status,
        statusText: loginRes.statusText,
        body: text.slice(0, 500)
      });
    }

    // Capture session cookies from the login response.
    const setCookie = loginRes.headers.get("set-cookie") || "";
    cookies = setCookie.split(",").map(c => c.split(";")[0].trim()).filter(Boolean).join("; ");
  } catch (err) {
    return json({ ok: false, stage: "login", error: String(err) });
  }

  // --- Stage 2: Read one purchase order ---
  let poData = null;
  try {
    const readRes = await fetch(`${BASE}/entity/Default/${API_VERSION}/PurchaseOrder?$top=1`, {
      method: "GET",
      headers: { "Accept": "application/json", "Cookie": cookies }
    });

    const text = await readRes.text();
    if (!readRes.ok) {
      await logout(cookies);
      return json({
        ok: false,
        stage: "read-po",
        status: readRes.status,
        statusText: readRes.statusText,
        body: text.slice(0, 1000)
      });
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

  // --- Stage 3: Logout (be polite, free the session) ---
  await logout(cookies);

  // Summarize what came back so we don't dump a giant PO object on the screen.
  const first = Array.isArray(poData) && poData.length > 0 ? poData[0] : null;
  const summary = first ? {
    OrderNbr: first.OrderNbr?.value,
    OrderType: first.OrderType?.value,
    VendorID: first.VendorID?.value,
    Status: first.Status?.value,
    Date: first.Date?.value,
    fieldCount: Object.keys(first).length
  } : { note: "No POs returned (empty array)" };

  return json({ ok: true, stage: "done", apiVersion: API_VERSION, sample: summary });
}

async function logout(cookies) {
  try {
    await fetch(`${BASE}/entity/auth/logout`, {
      method: "POST",
      headers: { "Cookie": cookies }
    });
  } catch {
    // best-effort; ignore failures
  }
}

function json(payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
