// Fetch a single Purchase Order (with its lines) by vendor reference or order nbr.
// Targeted contract-REST read — much lighter than pulling the whole Open PO Lines GI.
const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";

function json(o) {
  return new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
}

// Strip Acumatica's { value: x } wrappers one level deep so the client gets plain fields.
function flatten(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((k) => {
    const v = obj[k];
    if (v && typeof v === "object" && !Array.isArray(v) && "value" in v) out[k] = v.value;
    else out[k] = v;
  });
  return out;
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return json({ ok: false, stage: "parse-body", error: "Invalid JSON body" }); }
  const { username, password, query } = body || {};
  if (!username || !password) return json({ ok: false, stage: "validate-input", error: "username and password required" });
  if (!query) return json({ ok: false, stage: "validate-input", error: "query (PO / vendor ref) required" });

  // ── Login ──
  let cookies = "";
  try {
    const loginRes = await fetch(`${BASE}/entity/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ name: username, password: password })
    });
    if (!loginRes.ok) { const t = await loginRes.text(); return json({ ok: false, stage: "login", status: loginRes.status, body: t.slice(0, 500) }); }
    const sc = loginRes.headers.get("set-cookie") || "";
    cookies = sc.split(",").map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
  } catch (err) {
    return json({ ok: false, stage: "login", error: String(err) });
  }

  // ── Fetch the PO (try/finally so we always log out) ──
  try {
    const q = String(query).trim().replace(/'/g, "''");
    const filter = encodeURIComponent(`VendorRef eq '${q}' or OrderNbr eq '${q}'`);
    const url = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder?$filter=${filter}&$expand=Details&$top=20`;
    const r = await fetch(url, { method: "GET", headers: { "Cookie": cookies, "Accept": "application/json" } });
    const text = await r.text();
    if (!r.ok) return json({ ok: false, stage: "fetch", status: r.status, body: text.slice(0, 800) });
    let arr;
    try { arr = JSON.parse(text); } catch { return json({ ok: false, stage: "parse-response", body: text.slice(0, 800) }); }
    if (!Array.isArray(arr)) arr = arr ? [arr] : [];
    const orders = arr.map((o) => {
      const h = flatten(o);
      h.Details = Array.isArray(o.Details) ? o.Details.map(flatten) : [];
      return h;
    });
    const lineKeys = (orders[0] && orders[0].Details && orders[0].Details[0]) ? Object.keys(orders[0].Details[0]) : [];
    const headerKeys = orders[0] ? Object.keys(orders[0]).filter((k) => k !== "Details") : [];
    return json({ ok: true, count: orders.length, orders: orders, lineKeys: lineKeys, headerKeys: headerKeys });
  } catch (err) {
    return json({ ok: false, stage: "fetch", error: String(err) });
  } finally {
    try { await fetch(`${BASE}/entity/auth/logout`, { method: "POST", headers: { "Cookie": cookies } }); } catch {}
  }
}
