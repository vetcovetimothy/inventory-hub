/**
 * POST /api/acumatica-remove-po-lines
 *
 * Removes specific line items from one or more existing Purchase Orders in Acumatica.
 * Designed for the PO Tools workflow: when items are flagged as short-dated or
 * sell-off, this endpoint deletes those lines from the live PO in Acumatica so
 * they aren't included when the PO is sent to the vendor.
 *
 * Body:
 *   {
 *     username, password,
 *     removals: [
 *       {
 *         orderNbr: string,    // e.g. "PO007213"
 *         skus:     string[]   // SKU/NDC values to remove, e.g. ["50383-0286-04", ...]
 *       },
 *       ...
 *     ]
 *   }
 *
 * Behavior, per PO:
 *   1. Read the PO from Acumatica with $expand=Details.
 *   2. Verify Status === "On Hold". If not, REFUSE (do not modify).
 *   3. For each requested SKU, find ALL matching lines by AlternateID (NDC)
 *      first, then by InventoryID as fallback. If a SKU matches multiple
 *      lines on the same PO, delete all of them.
 *   4. PUT the PO with the matched lines marked { "delete": true }.
 *
 * Behavior, across POs:
 *   - Process each PO independently. One PO failing does NOT stop the others.
 *   - Returns per-PO results: removed lines, unmatched SKUs, and any error.
 *
 * Safety:
 *   - Only modifies POs that are currently On Hold.
 *   - Never adds, modifies, or shifts other lines — only deletes the matched ones.
 *   - Read-modify-write is per-PO; concurrent edits in Acumatica between read
 *     and write would surface as Acumatica errors and be reported.
 */

const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";

const REQUIRED_STATUS = "On Hold";

export async function POST(req) {
  // ── Parse input ─────────────────────────────────────────────────────────
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, stage: "parse-body", error: "Invalid JSON body" });
  }

  const { username, password, removals } = body || {};
  if (!username || !password) {
    return json({ ok: false, stage: "validate-input", error: "username and password required" });
  }
  if (!Array.isArray(removals) || removals.length === 0) {
    return json({ ok: false, stage: "validate-input", error: "removals must be a non-empty array" });
  }
  for (let i = 0; i < removals.length; i++) {
    const r = removals[i];
    if (!r || typeof r.orderNbr !== "string" || !r.orderNbr) {
      return json({ ok: false, stage: "validate-input", error: `removals[${i}].orderNbr is required` });
    }
    if (!Array.isArray(r.skus) || r.skus.length === 0) {
      return json({ ok: false, stage: "validate-input", error: `removals[${i}].skus must be a non-empty array` });
    }
  }

  // ── Login ───────────────────────────────────────────────────────────────
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

  // ── Process each PO independently (do NOT stop on first failure) ───────
  // Wrapped in try/finally so that logout always fires even if an exception
  // is thrown — without this, errors leak the session against your concurrent
  // login limit until Acumatica times it out.
  const results = [];
  try {
    for (let i = 0; i < removals.length; i++) {
      const r = removals[i];
      const result = await processOnePO(cookies, r.orderNbr, r.skus);
      results.push(Object.assign({ orderNbr: r.orderNbr, requestedSkus: r.skus }, result));
    }
  } finally {
    await logout(cookies);
  }

  const anyFailed = results.some(r => !r.ok);
  return json({
    ok: !anyFailed,
    stage: anyFailed ? "completed-with-failures" : "all-done",
    results
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Process one PO: read → check status → match → delete-PUT
// ─────────────────────────────────────────────────────────────────────────
async function processOnePO(cookies, orderNbr, skus) {
  // Step 1: Read the PO with details
  const readUrl =
    `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder` +
    `?$filter=${encodeURIComponent(`OrderNbr eq '${orderNbr}'`)}` +
    `&$expand=Details&$top=1`;

  let po;
  try {
    const res = await fetch(readUrl, {
      method: "GET",
      headers: { "Accept": "application/json", "Cookie": cookies }
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        stage: "read-po",
        status: res.status,
        rawBody: text.slice(0, 1000),
        error: `Could not read PO ${orderNbr} from Acumatica`
      };
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch {
      return { ok: false, stage: "read-po", error: "Acumatica returned non-JSON when reading PO", rawBody: text.slice(0, 500) };
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { ok: false, stage: "read-po", error: `PO ${orderNbr} not found in Acumatica` };
    }
    po = parsed[0];
  } catch (err) {
    return { ok: false, stage: "read-po", error: String(err) };
  }

  // Step 2: Status check — STRICT On Hold only
  const currentStatus = po?.Status?.value;
  if (currentStatus !== REQUIRED_STATUS) {
    return {
      ok: false,
      stage: "status-check",
      currentStatus: currentStatus || "(unknown)",
      error: `PO ${orderNbr} is not On Hold (current status: ${currentStatus || "unknown"}). Refusing to modify. Put the PO On Hold in Acumatica first.`
    };
  }

  // Step 3: Match SKUs against the PO's lines
  //   - Primary match: line.AlternateID equals the SKU (NDC format)
  //   - Fallback match: line.InventoryID equals the SKU
  //   - Match multiple lines if the SKU appears on multiple lines
  //   - Normalize by trimming + uppercasing for resilience
  const norm = s => String(s || "").trim().toUpperCase();
  const requestedNorm = new Set(skus.map(norm));

  const details = Array.isArray(po.Details) ? po.Details : [];
  const matchedLineIds = []; // ids of lines we'll mark for deletion
  const matchedReport = []; // for the response: which SKU matched which line
  const matchedSkuSet = new Set(); // which requested SKUs found at least one match

  details.forEach(line => {
    const alt = norm(line?.AlternateID?.value);
    const inv = norm(line?.InventoryID?.value);
    const lineNbr = line?.LineNbr?.value;
    const lineId = line?.id;

    let matchedAs = null;
    let matchedSku = null;
    if (alt && requestedNorm.has(alt)) {
      matchedAs = "AlternateID";
      matchedSku = alt;
    } else if (inv && requestedNorm.has(inv)) {
      matchedAs = "InventoryID";
      matchedSku = inv;
    }

    if (matchedAs && lineId) {
      matchedLineIds.push(lineId);
      matchedReport.push({
        lineNbr: lineNbr,
        inventoryID: line?.InventoryID?.value,
        alternateID: line?.AlternateID?.value,
        orderQty: line?.OrderQty?.value,
        lineDescription: line?.LineDescription?.value,
        matchedAs,
        matchedSku
      });
      matchedSkuSet.add(matchedSku);
    }
  });

  // Find SKUs that didn't match any line — informational, not a hard failure
  const unmatchedSkus = skus.filter(s => !matchedSkuSet.has(norm(s)));

  if (matchedLineIds.length === 0) {
    return {
      ok: false,
      stage: "match-skus",
      unmatchedSkus,
      poDetailsCount: details.length,
      error: `None of the requested SKUs matched any line on PO ${orderNbr}. The line(s) may have already been removed, or the SKU values don't match.`
    };
  }

  // Step 4: PUT the PO with matched lines marked for deletion
  //   The body needs the PO's id (so Acumatica treats this as an update),
  //   the key fields (OrderType + OrderNbr), and a Details array containing
  //   ONLY the lines we want to delete, each with delete: true.
  //   Lines not mentioned in the PUT body are left untouched.
  const putUrl = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder?$expand=Details`;
  const putPayload = {
    id: po.id,
    OrderType: { value: po?.Type?.value || "Normal" },
    OrderNbr:  { value: orderNbr },
    Details: matchedLineIds.map(lineId => ({
      id: lineId,
      delete: true
    }))
  };

  try {
    const res = await fetch(putUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Cookie": cookies
      },
      body: JSON.stringify(putPayload)
    });
    const text = await res.text();
    if (!res.ok) {
      let errorDetails = null;
      try { errorDetails = extractAllErrors(JSON.parse(text)); } catch {}
      return {
        ok: false,
        stage: "delete-lines",
        status: res.status,
        errorDetails,
        rawBody: text.slice(0, 2000),
        attemptedDeletes: matchedReport,
        error: `Acumatica rejected the delete on PO ${orderNbr}`
      };
    }
    let updated;
    try { updated = JSON.parse(text); } catch { updated = null; }

    return {
      ok: true,
      stage: "removed",
      removedLines: matchedReport,
      unmatchedSkus,
      newLineCount: Array.isArray(updated?.Details) ? updated.Details.length : null,
      newOrderTotal: updated?.OrderTotal?.value
    };
  } catch (err) {
    return { ok: false, stage: "delete-lines", error: String(err), attemptedDeletes: matchedReport };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Walk the response for embedded `error` properties (both header and line).
// Same pattern as in acumatica-create-po/route.js — kept here to avoid a
// shared-module import; if these helpers grow we can extract them.
// ─────────────────────────────────────────────────────────────────────────
function extractAllErrors(parsed) {
  const errors = [];
  if (!parsed || typeof parsed !== "object") return errors;

  Object.keys(parsed).forEach(k => {
    if (k === "Details" || k === "_links" || k === "custom") return;
    const v = parsed[k];
    if (v && typeof v === "object" && typeof v.error === "string") {
      errors.push({ scope: "header", field: k, value: v.value, message: v.error });
    }
  });

  if (Array.isArray(parsed.Details)) {
    parsed.Details.forEach((d, idx) => {
      Object.keys(d || {}).forEach(k => {
        const v = d[k];
        if (v && typeof v === "object" && typeof v.error === "string") {
          errors.push({
            scope: "line",
            lineIndex: idx,
            inventoryID: d?.InventoryID?.value,
            field: k,
            value: v.value,
            message: v.error
          });
        }
      });
    });
  }

  if (errors.length === 0 && typeof parsed.error === "string") {
    errors.push({ scope: "wrapper", message: parsed.error });
  }
  return errors;
}

async function logout(cookies) {
  try {
    await fetch(`${BASE}/entity/auth/logout`, { method: "POST", headers: { "Cookie": cookies } });
  } catch {}
}

function json(payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
