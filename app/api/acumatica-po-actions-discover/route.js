/**
 * GET /api/acumatica-po-actions-discover?username=X&password=Y
 *
 * v2 — fetches the PurchaseOrder $adHocSchema and extracts ONLY the
 * _workflowActions field, so the response stays small and doesn't get truncated.
 */

const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";

export async function GET(req) {
  const url = new URL(req.url);
  const username = url.searchParams.get("username");
  const password = url.searchParams.get("password");
  if (!username || !password) {
    return json({ ok: false, error: "username and password query params required" });
  }

  // Login
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

  // Fetch schema
  const schemaUrl = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder/$adHocSchema`;
  let schema;
  try {
    const res = await fetch(schemaUrl, {
      method: "GET",
      headers: { "Accept": "application/json", "Cookie": cookies }
    });
    if (!res.ok) {
      const text = await res.text();
      return json({ ok: false, stage: "schema-fetch", status: res.status, body: text.slice(0, 1000) });
    }
    schema = await res.json();
  } catch (err) {
    return json({ ok: false, stage: "schema-fetch", error: String(err) });
  }

  const workflowActions = schema._workflowActions || null;

  // Extract just the action names for easy scanning
  let actionNames = null;
  if (Array.isArray(workflowActions)) {
    actionNames = workflowActions.map(entry => {
      // Each entry is an object whose single key is the action name
      const keys = Object.keys(entry).filter(k => k !== "parameters");
      return keys[0] || "unknown";
    });
  } else if (workflowActions && typeof workflowActions === "object") {
    actionNames = Object.keys(workflowActions);
  }

  return json({
    ok: true,
    actionCount: actionNames ? actionNames.length : 0,
    actionNames: actionNames,
    // Full workflow actions data with params — useful for action signatures
    workflowActions: workflowActions
  });
}

function json(obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
