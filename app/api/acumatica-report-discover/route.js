/**
 * GET /api/acumatica-report-discover?username=X&password=Y
 *
 * DISCOVERY — figure out how to invoke the PO Print report via REST and
 * whether Vetcove's Acumatica is configured to allow it.
 *
 * Per AcumaticaERP_IntegrationDevelopmentGuide.pdf, reports are callable
 * through a custom "Report" endpoint at:
 *   POST /entity/Report/<endpointVersion>/<ReportName>
 *   Headers: Accept: application/pdf | application/vnd.ms-excel | etc.
 * The POST returns 202 with a Location header. GETting that URL when ready
 * returns the actual file bytes.
 *
 * For this to work on Vetcove's instance:
 *   1. A custom endpoint named "Report" must exist (default version "0001")
 *   2. The PO print report must be published to that endpoint
 *
 * This route does NOT trigger any side effects — it only inspects the metadata
 * to figure out what's possible. No PO is printed. No data is modified.
 *
 * The route checks several candidate paths in order, returning what each
 * endpoint returns. The user / Claude reads the response and decides next steps.
 */

const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";

export async function GET(req) {
  const url = new URL(req.url);
  const username = url.searchParams.get("username");
  const password = url.searchParams.get("password");
  if (!username || !password) {
    return json({ ok: false, error: "username and password query params required" });
  }

  // Login (session cookie auth, since /entity/... requires it)
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

  // Candidate discovery URLs. We list each endpoint's metadata to see if it
  // exists and what reports are published to it.
  // Acumatica's endpoint metadata is exposed at /entity/{endpoint}/{version}
  // returning a JSON document listing all available top-level resources.
  const candidates = [
    // 1. List all endpoints
    { label: "all-endpoints", url: `${BASE}/entity/swagger.json` },
    // 2. Look for a Report endpoint at common version 0001
    { label: "report-endpoint-0001", url: `${BASE}/entity/Report/0001` },
    { label: "report-endpoint-default-version", url: `${BASE}/entity/Report/24.200.001` },
    { label: "report-endpoint-2025", url: `${BASE}/entity/Report/25.200.001` },
    // 3. Look for the PO Print report by common names
    { label: "po-print-on-report-0001", url: `${BASE}/entity/Report/0001/PurchaseOrderPrint` },
    { label: "po-print-screen-id", url: `${BASE}/entity/Report/0001/PO641000` },
  ];

  const results = [];
  try {
    for (const c of candidates) {
      try {
        const res = await fetch(c.url, {
          method: "GET",
          headers: { "Accept": "application/json", "Cookie": cookies }
        });
        const text = await res.text();
        results.push({
          label: c.label,
          url: c.url,
          status: res.status,
          bodyPreview: text.slice(0, 2000)
        });
      } catch (err) {
        results.push({ label: c.label, url: c.url, error: String(err) });
      }
    }
  } finally {
    // Always log out — don't leak the session
    try {
      await fetch(`${BASE}/entity/auth/logout`, { method: "POST", headers: { "Cookie": cookies } });
    } catch {}
  }

  return json({ ok: true, results });
}

function json(obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
