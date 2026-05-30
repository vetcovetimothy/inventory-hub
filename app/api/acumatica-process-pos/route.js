/**
 * POST /api/acumatica-process-pos
 *
 * The production endpoint for the PO Tools "Process All POs" button.
 * Processes a batch of POs by setting the Vendor Ref + releasing Hold,
 * then optionally invoking the EmailPurchaseOrder action or pushing to
 * the TrueCommerce EDI webhook.
 *
 * Body:
 *   {
 *     username, password,
 *     pos: [
 *       {
 *         orderNbr:  string,        // e.g. "PO008627"
 *         vendorRef: string,        // required, non-empty
 *         channel:   string         // "Email" | "TrueCommerce EDI" | "Website Ordering"
 *       },
 *       ...
 *     ]
 *   }
 *
 * Per-PO behavior by channel:
 *   - "Email":             Write VendorRef + Hold:false + invoke EmailPurchaseOrder action
 *   - "TrueCommerce EDI":  Write VendorRef + Hold:false (no EmailPurchaseOrder call). After
 *                          the per-PO loop, the OData GI "EDI - PO Export TP" is pulled once,
 *                          rows matching the EDI POs in this batch are extracted, and a single
 *                          CSV is POSTed as JSON to the Make.com webhook (which uploads to
 *                          TrueCommerce's SFTP). EDI vendors have Print Order/Email Order
 *                          checked on the vendor record but no email address on file, so the
 *                          Hold:false release does not actually email or print anything.
 *   - "Website Ordering":  Write VendorRef ONLY (keep PO On Hold, no email)
 *
 * All POs must be On Hold to be processed (status check applies to all channels).
 * Errors on one PO do NOT stop the batch.
 *
 * EDI environment variables:
 *   EDI_WEBHOOK_URL  — the Make.com webhook to POST the CSV to. If not set, EDI POs are
 *                      released and VendorRef'd but the EDI send is skipped (with a warning
 *                      returned in the response).
 */

const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";
const EDI_WEBHOOK_URL = process.env.EDI_WEBHOOK_URL || "";

// OData GI endpoint that returns today's EDI POs (already filtered by OrderDate=today AND TaxZoneID=EDINOTAX)
const EDI_GI_URL = `${BASE}/odata/VetCove/EDI%20-%20PO%20Export%20TP`;

// Column order for the TrueCommerce EDI CSV. MUST match exactly what TrueCommerce expects.
// Mirrors the EDI_PO_EXPORT_TP_CONFIG.headers in the legacy Google Sheet App Script.
const EDI_CSV_HEADERS = [
  "Transaction ID", "Accounting ID", "Purchase Order Number", "PO Date",
  "Ship To Name", "Ship To Address - Line One", "Ship To Address - Line Two",
  "Ship To City", "Ship To State", "Ship To Zip code", "Ship To Country",
  "Store #", "Bill To Name", "Bill To Address - Line One",
  "Bill To Address - Line Two", "Bill To City", "Bill To State",
  "Bill To Zip code", "Bill To Country", "Bill To Code", "Ship Via",
  "Ship Date", "Terms", "Note", "Department Number", "Cancel Date",
  "Do Not Ship Before", "Do Not Ship After", "Allowance Percent1",
  "Allowance Amount1", "Allowance Percent2", "Allowance Amount2",
  "Line #", "Vendor Part #", "Buyer Part #", "UPC #", "Description",
  "Quantity", "UOM", "Unit Price", "Pack Size", "# of Inner Packs",
  "Item Allowance Percent1", "Item Allowance Amount1"
];

const REQUIRED_STATUS = "On Hold";

const POLL_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 1000;

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, stage: "parse-body", error: "Invalid JSON body" });
  }

  const { username, password, pos } = body || {};
  if (!username || !password) {
    return json({ ok: false, stage: "validate-input", error: "username and password required" });
  }
  if (!Array.isArray(pos) || pos.length === 0) {
    return json({ ok: false, stage: "validate-input", error: "pos must be a non-empty array" });
  }
  for (let i = 0; i < pos.length; i++) {
    const p = pos[i];
    if (!p || typeof p.orderNbr !== "string" || !p.orderNbr) {
      return json({ ok: false, stage: "validate-input", error: `pos[${i}].orderNbr is required` });
    }
    if (typeof p.vendorRef !== "string" || !p.vendorRef.trim()) {
      return json({ ok: false, stage: "validate-input", error: `pos[${i}].vendorRef is required (non-empty)` });
    }
    if (typeof p.channel !== "string" || !p.channel) {
      return json({ ok: false, stage: "validate-input", error: `pos[${i}].channel is required (Email, TrueCommerce EDI, or Website Ordering)` });
    }
    if (p.channel !== "Email" && p.channel !== "TrueCommerce EDI" && p.channel !== "Website Ordering") {
      return json({ ok: false, stage: "validate-input", error: `pos[${i}].channel must be 'Email', 'TrueCommerce EDI', or 'Website Ordering' (got '${p.channel}')` });
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

  // ── Process each PO independently ───────────────────────────────────────
  const results = [];
  for (let i = 0; i < pos.length; i++) {
    const p = pos[i];
    const result = await processOnePO(cookies, p.orderNbr, p.vendorRef.trim(), p.channel);
    results.push(Object.assign({
      orderNbr: p.orderNbr,
      requestedVendorRef: p.vendorRef.trim(),
      channel: p.channel
    }, result));
  }

  // ── EDI batch step ───────────────────────────────────────────────────────
  // After per-PO loop: if any TrueCommerce EDI POs were successfully released,
  // fetch the GI once, filter to just those POs' rows, and POST to Make webhook.
  // Notes about edi attached to each EDI result so the frontend can show outcome.
  const ediResults = results.filter(r => r.ok && r.pendingEdiSend);
  if (ediResults.length > 0) {
    const ediOrderNbrs = new Set(ediResults.map(r => r.orderNbr));
    const ediOutcome = await sendEdiBatch(cookies, ediOrderNbrs);
    // ediOutcome: { ok, stage, ediRowCount, matchedOrderNbrs: Set, unmatchedOrderNbrs: Array,
    //               webhookStatus?, webhookBody?, error? }
    // Annotate per-PO results
    for (const r of ediResults) {
      if (!ediOutcome.matchedOrderNbrs || !ediOutcome.matchedOrderNbrs.has(r.orderNbr)) {
        // PO was supposed to be in the GI but wasn't returned
        r.ediSent = false;
        r.ediError = "PO released but EDI GI returned no rows for this PO";
        continue;
      }
      if (ediOutcome.ok) {
        r.ediSent = true;
        r.stage = "edi-sent";
      } else {
        r.ediSent = false;
        r.ediError = ediOutcome.error || ediOutcome.stage || "EDI webhook failed";
      }
    }
  }

  await logout(cookies);

  // Summary
  const successCount = results.filter(r => r.ok).length;
  const emailedCount = results.filter(r => r.ok && r.emailed).length;
  const ediSentCount = results.filter(r => r.ok && r.ediSent).length;
  const ediFailedCount = results.filter(r => r.ok && r.pendingEdiSend && !r.ediSent).length;
  // vendorRefOnly = ok, not emailed, not part of EDI flow (i.e. Website Ordering)
  const vendorRefOnlyCount = results.filter(r => r.ok && !r.emailed && !r.pendingEdiSend).length;
  const failedCount = results.filter(r => !r.ok).length;

  return json({
    ok: failedCount === 0 && ediFailedCount === 0,
    stage: (failedCount === 0 && ediFailedCount === 0) ? "all-done" : "completed-with-failures",
    summary: {
      successCount,
      emailedCount,
      ediSentCount,
      ediFailedCount,
      vendorRefOnlyCount,
      failedCount,
      totalCount: results.length
    },
    results
  });
}

// ─────────────────────────────────────────────────────────────────────────
async function processOnePO(cookies, orderNbr, vendorRef, channel) {
  const isEmailChannel = channel === "Email";
  const isEdiChannel = channel === "TrueCommerce EDI";
  // Both Email and EDI channels release the PO from hold. Website Ordering keeps it on hold.
  const shouldRelease = isEmailChannel || isEdiChannel;

  // Step 1: Read the PO → verify status
  const readResult = await readPO(cookies, orderNbr);
  if (!readResult.ok) {
    return { ok: false, stage: "read-po", error: readResult.error || `Could not read ${orderNbr}` };
  }
  const po = readResult.po;
  const currentStatus = po?.Status?.value;
  if (currentStatus !== REQUIRED_STATUS) {
    return {
      ok: false,
      stage: "status-check",
      currentStatus,
      error: `${orderNbr} is not On Hold (status: ${currentStatus}). Refusing.`
    };
  }

  // Step 2: PUT VendorRef. For Email + EDI channels, also set Hold:false in the same call.
  // For Website Ordering, only the VendorRef changes (PO stays On Hold).
  const putUrl = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder`;
  const putPayload = {
    id: po.id,
    OrderType: { value: po?.Type?.value || "Normal" },
    OrderNbr:  { value: orderNbr },
    VendorRef: { value: vendorRef }
  };
  if (shouldRelease) {
    putPayload.Hold = { value: false };
  }

  let putStatusAfter = null;
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
        stage: isEmailChannel ? "release" : "write-vendor-ref",
        status: res.status,
        errorDetails,
        rawBody: text.slice(0, 1500),
        error: `Acumatica rejected ${shouldRelease ? "release" : "vendor-ref write"} for ${orderNbr}`
      };
    }
    let updated;
    try { updated = JSON.parse(text); } catch {}
    putStatusAfter = updated?.Status?.value;
  } catch (err) {
    return { ok: false, stage: shouldRelease ? "release" : "write-vendor-ref", error: String(err) };
  }

  // If not Email channel, we're done with the per-PO Acumatica work.
  // EDI POs still need their CSV pushed to TrueCommerce — that happens in a
  // separate batch step after the per-PO loop. Website Ordering POs are fully done here.
  if (!isEmailChannel) {
    return {
      ok: true,
      stage: isEdiChannel ? "released-pending-edi" : "done",
      released: shouldRelease,            // true for EDI, false for Website Ordering
      vendorRefWritten: true,
      statusAfter: putStatusAfter,        // "Open" for EDI, still "On Hold" for Website Ordering
      emailed: false,
      emailSkipped: true,
      pendingEdiSend: isEdiChannel        // marker for the batch-level EDI send step
    };
  }

  // Step 3 (Email channel only): Invoke EmailPurchaseOrder
  const emailUrl = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder/EmailPurchaseOrder`;
  const emailPayload = {
    entity: {
      id: po.id,
      OrderType: { value: po?.Type?.value || "Normal" },
      OrderNbr:  { value: orderNbr }
    }
  };

  let emailed = false;
  let emailError = null;
  let emailPollAttempts = 0;
  let emailFinalStatus = null;
  const emailStart = Date.now();

  try {
    const emailRes = await fetch(emailUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Cookie": cookies
      },
      body: JSON.stringify(emailPayload)
    });
    const emailText = await emailRes.text();
    const initialStatus = emailRes.status;
    const locationHeader = emailRes.headers.get("location");

    if (initialStatus !== 202 && initialStatus !== 200 && initialStatus !== 204) {
      let errorDetails = null;
      try { errorDetails = extractAllErrors(JSON.parse(emailText)); } catch {}
      emailError = {
        stage: "invoke-email",
        status: initialStatus,
        errorDetails,
        rawBody: emailText.slice(0, 1500)
      };
    } else if (initialStatus === 202 && locationHeader) {
      const pollUrl = locationHeader.startsWith("http") ? locationHeader : (BASE + locationHeader);
      const pollDeadline = Date.now() + POLL_TIMEOUT_MS;
      let lastPollStatus = 202;
      while (Date.now() < pollDeadline) {
        await sleep(POLL_INTERVAL_MS);
        emailPollAttempts++;
        const pollRes = await fetch(pollUrl, {
          method: "GET",
          headers: { "Accept": "application/json", "Cookie": cookies }
        });
        lastPollStatus = pollRes.status;
        if (pollRes.status === 204 || pollRes.status === 200) break;
        if (pollRes.status >= 400) {
          const pollText = await pollRes.text();
          emailError = { stage: "poll-status", status: pollRes.status, rawBody: pollText.slice(0, 1500) };
          break;
        }
      }
      emailFinalStatus = lastPollStatus;
      if (!emailError && (lastPollStatus === 204 || lastPollStatus === 200)) {
        emailed = true;
      } else if (!emailError && lastPollStatus === 202) {
        emailError = { stage: "poll-status", error: `Email poll timeout after ${POLL_TIMEOUT_MS}ms` };
      }
    } else {
      emailed = true;
      emailFinalStatus = initialStatus;
    }
  } catch (err) {
    emailError = { stage: "invoke-email", error: String(err) };
  }

  const overallOk = !emailError;
  return {
    ok: overallOk,
    stage: overallOk ? "done" : "email-failed",
    released: true,
    vendorRefWritten: true,
    statusAfter: putStatusAfter,
    emailed,
    emailSkipped: false,
    emailPollAttempts,
    emailFinalStatus,
    emailError
  };
}

// ─────────────────────────────────────────────────────────────────────────
async function readPO(cookies, orderNbr) {
  const url =
    `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder` +
    `?$filter=${encodeURIComponent(`OrderNbr eq '${orderNbr}'`)}` +
    `&$top=1`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "Accept": "application/json", "Cookie": cookies }
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, error: text.slice(0, 500) };
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: "non-JSON response" }; }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { ok: false, error: `PO ${orderNbr} not found` };
  }
  return { ok: true, po: parsed[0] };
}

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
          errors.push({ scope: "line", lineIndex: idx, field: k, value: v.value, message: v.error });
        }
      });
    });
  }
  if (errors.length === 0 && typeof parsed.error === "string") {
    errors.push({ scope: "wrapper", message: parsed.error });
  }
  return errors;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function logout(cookies) {
  try {
    await fetch(`${BASE}/entity/auth/logout`, { method: "POST", headers: { "Cookie": cookies } });
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────
// EDI batch: fetch the OData GI once, filter to the OrderNbrs in this batch,
// build a CSV with the TrueCommerce column order, POST as JSON to the Make webhook.
//
// Returns:
//   { ok, stage, ediRowCount, matchedOrderNbrs: Set, unmatchedOrderNbrs: Array,
//     webhookStatus?, webhookBody?, error? }
async function sendEdiBatch(cookies, ediOrderNbrs) {
  if (!EDI_WEBHOOK_URL) {
    return {
      ok: false,
      stage: "config",
      error: "EDI_WEBHOOK_URL env var not set. Cannot send EDI batch.",
      matchedOrderNbrs: new Set()
    };
  }

  // Step 1: Pull the entire GI (already filtered server-side to today + EDINOTAX vendors)
  let allRows;
  try {
    const res = await fetch(EDI_GI_URL, {
      method: "GET",
      headers: { "Accept": "application/json", "Cookie": cookies }
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        stage: "fetch-gi",
        error: `GI fetch failed (${res.status}): ${text.slice(0, 500)}`,
        matchedOrderNbrs: new Set()
      };
    }
    const data = await res.json();
    allRows = Array.isArray(data) ? data : (data.value || []);
  } catch (err) {
    return { ok: false, stage: "fetch-gi", error: String(err), matchedOrderNbrs: new Set() };
  }

  // Step 2: Identify the OrderNbr key in the GI rows.
  // The GI exposes "Purchase Order Number" with Data Field = POOrder.VendorRefNbr.
  // We also need an OrderNbr-equivalent to match against our batch list.
  // OData likely exposes OrderNbr-typed fields under sanitized names. Try common variants.
  if (allRows.length === 0) {
    return {
      ok: false,
      stage: "filter-gi",
      error: "GI returned 0 rows. No EDI POs found for today.",
      matchedOrderNbrs: new Set(),
      ediRowCount: 0
    };
  }

  // Build a key map: try every normalized key against each row to find one matching "OrderNbr"
  // (Acumatica OData strips spaces and uses CamelCase or similar).
  // We need to match the in-Acumatica PO number (e.g. "PO008700") against the rows.
  // The GI's POLine and POOrder both expose OrderNbr — they should hold the same value per row.
  const sample = allRows[0];
  const sampleKeys = Object.keys(sample);
  const orderNbrKey = findKey(sampleKeys, ["OrderNbr", "Order_Nbr", "OrderNumber", "PurchaseOrderNumber_Internal"]);
  if (!orderNbrKey) {
    return {
      ok: false,
      stage: "filter-gi",
      error: `Could not find OrderNbr-equivalent key in GI rows. Available keys: ${sampleKeys.slice(0, 20).join(", ")}`,
      matchedOrderNbrs: new Set()
    };
  }

  // Step 3: Filter to only rows whose OrderNbr is in our batch set
  const matchedRows = allRows.filter(row => {
    const v = extractValue(row[orderNbrKey]);
    return v && ediOrderNbrs.has(v);
  });
  const matchedOrderNbrs = new Set(matchedRows.map(r => extractValue(r[orderNbrKey])));

  if (matchedRows.length === 0) {
    return {
      ok: false,
      stage: "filter-gi",
      error: `GI returned ${allRows.length} rows but none matched the ${ediOrderNbrs.size} EDI PO(s) in this batch. Check that the EDI POs have OrderDate=today and TaxZoneID=EDINOTAX.`,
      matchedOrderNbrs: new Set(),
      ediRowCount: 0
    };
  }

  // Step 4: Build the CSV using the canonical column order
  const csv = buildEdiCsv(matchedRows);

  // Step 5: POST to Make webhook as JSON
  let webhookStatus = null, webhookBody = null;
  try {
    const res = await fetch(EDI_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "*/*" },
      body: JSON.stringify({ csv })
    });
    webhookStatus = res.status;
    webhookBody = (await res.text()).slice(0, 500);
    if (!res.ok) {
      return {
        ok: false,
        stage: "webhook-post",
        error: `Make webhook returned ${res.status}: ${webhookBody}`,
        matchedOrderNbrs,
        ediRowCount: matchedRows.length,
        webhookStatus,
        webhookBody
      };
    }
  } catch (err) {
    return {
      ok: false,
      stage: "webhook-post",
      error: String(err),
      matchedOrderNbrs,
      ediRowCount: matchedRows.length
    };
  }

  return {
    ok: true,
    stage: "edi-sent",
    matchedOrderNbrs,
    ediRowCount: matchedRows.length,
    webhookStatus,
    webhookBody
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Build the TrueCommerce CSV from the matched GI rows.
// Acumatica OData returns field names normalized (spaces stripped, some camelCasing).
// We build a per-row key map so we can map each canonical header back to the actual key
// the row uses. Mirrors the buildNormalizedKeyMap_/normalizeKey_ logic from the legacy
// Google Sheet App Script.
function buildEdiCsv(rows) {
  if (rows.length === 0) return EDI_CSV_HEADERS.join(",") + "\r\n";

  const keyMap = {};
  Object.keys(rows[0]).forEach(k => { keyMap[normalizeKey(k)] = k; });

  const lines = [EDI_CSV_HEADERS.map(csvEscape).join(",")];
  for (const row of rows) {
    const cells = EDI_CSV_HEADERS.map(header => {
      const k = keyMap[normalizeKey(header)];
      const raw = k ? row[k] : "";
      return csvEscape(normalizeOdataValue(header, raw));
    });
    lines.push(cells.join(","));
  }
  return lines.join("\r\n");
}

function normalizeKey(s) {
  return String(s).replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Some GI rows wrap values like { value: "..." } (Acumatica's contract format).
// OData usually returns scalars directly, but check both.
function extractValue(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "value" in v) return v.value;
  return v;
}

// Format a raw OData value into a CSV-safe string. Handles dates per the legacy script.
const DATE_HEADERS = new Set(["PO Date", "Ship Date", "Cancel Date", "Do Not Ship Before", "Do Not Ship After"]);
function normalizeOdataValue(header, raw) {
  const v = extractValue(raw);
  if (v === "" || v === null || v === undefined) return "";
  if (DATE_HEADERS.has(header)) {
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      // Format as YYYY-MM-DD (matches App Script's date output)
      return v.slice(0, 10);
    }
  }
  return String(v);
}

function csvEscape(v) {
  const s = String(v == null ? "" : v);
  if (s.search(/["\r\n,]/) >= 0) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Try a list of candidate key names against a list of actual keys, return the first match.
function findKey(actualKeys, candidates) {
  for (const c of candidates) {
    if (actualKeys.includes(c)) return c;
  }
  // Fall back to case-insensitive match
  const lower = actualKeys.map(k => ({ orig: k, low: k.toLowerCase() }));
  for (const c of candidates) {
    const m = lower.find(x => x.low === c.toLowerCase());
    if (m) return m.orig;
  }
  return null;
}

function json(payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
