/**
 * POST /api/acumatica-process-pos
 *
 * The production endpoint for the PO Tools "Process All POs" button.
 * Processes a batch of POs by setting the Vendor Ref + releasing Hold,
 * then optionally invoking the EmailPurchaseOrder action.
 *
 * This is the API equivalent of the manual UI workflow:
 *   1. Open PO, click Remove Hold
 *   2. "Print? No" (achieved by not invoking PrintPurchaseOrder action)
 *   3. "Email? Yes/No" (achieved by conditionally invoking EmailPurchaseOrder)
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
 *   - "TrueCommerce EDI":  Write VendorRef ONLY (keep PO On Hold, no email)
 *   - "Website Ordering":  Write VendorRef ONLY (keep PO On Hold, no email)
 *
 * All POs must be On Hold to be processed (status check applies to all channels).
 * Errors on one PO do NOT stop the batch.
 */

const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";

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

  await logout(cookies);

  // Summary
  const successCount = results.filter(r => r.ok).length;
  const emailedCount = results.filter(r => r.ok && r.emailed).length;
  const vendorRefOnlyCount = results.filter(r => r.ok && !r.emailed).length;
  const failedCount = results.filter(r => !r.ok).length;

  return json({
    ok: failedCount === 0,
    stage: failedCount === 0 ? "all-done" : "completed-with-failures",
    summary: { successCount, emailedCount, vendorRefOnlyCount, failedCount, totalCount: results.length },
    results
  });
}

// ─────────────────────────────────────────────────────────────────────────
async function processOnePO(cookies, orderNbr, vendorRef, channel) {
  const isEmailChannel = channel === "Email";

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

  // Step 2: PUT VendorRef. If Email channel, also set Hold:false in the same call.
  // For TrueCommerce EDI / Website Ordering, only the VendorRef changes.
  const putUrl = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder`;
  const putPayload = {
    id: po.id,
    OrderType: { value: po?.Type?.value || "Normal" },
    OrderNbr:  { value: orderNbr },
    VendorRef: { value: vendorRef }
  };
  if (isEmailChannel) {
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
        error: `Acumatica rejected ${isEmailChannel ? "release" : "vendor-ref write"} for ${orderNbr}`
      };
    }
    let updated;
    try { updated = JSON.parse(text); } catch {}
    putStatusAfter = updated?.Status?.value;
  } catch (err) {
    return { ok: false, stage: isEmailChannel ? "release" : "write-vendor-ref", error: String(err) };
  }

  // If not Email channel, we're done. Return success.
  if (!isEmailChannel) {
    return {
      ok: true,
      stage: "done",
      released: false,                  // hold was NOT removed
      vendorRefWritten: true,
      statusAfter: putStatusAfter,      // should still be "On Hold"
      emailed: false,
      emailSkipped: true
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

function json(payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
