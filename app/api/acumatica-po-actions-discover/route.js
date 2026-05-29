/**
 * GET /api/acumatica-po-actions-discover?username=X&password=Y
 *
 * DISCOVERY — fetch the authoritative list of actions callable on the
 * PurchaseOrder entity, including workflow actions that aren't in the
 * default endpoint definition.
 *
 * Why this exists:
 *   We tried POSTing to /PurchaseOrder/DoNotEmail and got 404 "Can't find
 *   action DoNotEmail". The Acumatica UI shows the action exists, but its
 *   REST endpoint name may differ from the UI label.
 *
 * From AcumaticaERP_IntegrationDevelopmentGuide.pdf (Custom Fields and
 * Workflow Actions section): "For each top-level entity, the REST API
 * provides the schema of custom fields and workflow actions."
 *
 * The schema endpoint is documented as:
 *   GET /entity/Default/{version}/{Entity}/$adHocSchema
 *
 * We hit that and return whatever workflow actions are listed. The response
 * should include a `customActions` (or similar) section with the actual
 * REST-callable names.
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

  // Try a couple of schema endpoint shapes — Acumatica documentation refers
  // to $adHocSchema, but the actual field/url name has varied across versions.
  const candidates = [
    `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder/$adHocSchema`,
    `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder?$adHocSchema=true`,
  ];

  const results = [];
  for (const candidateUrl of candidates) {
    try {
      const res = await fetch(candidateUrl, {
        method: "GET",
        headers: { "Accept": "application/json", "Cookie": cookies }
      });
      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch {}
      results.push({
        url: candidateUrl,
        status: res.status,
        bodyPreview: text.slice(0, 2000),
        parsedKeys: parsed ? Object.keys(parsed) : null
      });
    } catch (err) {
      results.push({ url: candidateUrl, error: String(err) });
    }
  }

  return json({ ok: true, results });
}

function json(obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
