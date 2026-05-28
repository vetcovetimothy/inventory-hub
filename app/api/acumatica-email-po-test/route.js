/**
 * POST /api/acumatica-email-po-test
 *
 * EXPERIMENT 2 — invoke the EmailPurchaseOrder action via REST API
 * and observe what Acumatica does.
 *
 * Background from Experiment 1:
 *   Setting Hold=false via API only changes status. It does NOT trigger
 *   the email or print prompts that the UI would normally show.
 *
 * Background from UI inspection:
 *   The PO entity exposes four actions: EmailPurchaseOrder, DoNotEmail,
 *   PrintPurchaseOrder, DoNotPrint. We confirmed Action Name = "EmailPurchaseOrder"
 *   via the Acumatica UI Customization > Inspect Element flow.
 *
 * Body:
 *   {
 *     username, password,
 *     orderNbr: string,           // e.g. "PO008627"
 *     releaseFirst: boolean       // if true and PO is On Hold, set Hold=false before invoking email
 *   }
 *
 * What this route does:
 *   1. Login.
 *   2. Read the PO to capture baseline state + id.
 *   3. If releaseFirst=true and PO is On Hold, set Hold=false (Experiment 1 path).
 *   4. POST to /PurchaseOrder/EmailPurchaseOrder with { entity: { id, OrderType, OrderNbr } }.
 *   5. Acumatica returns 202 Accepted + a Location header.
 *      Poll that URL until 204 No Content or timeout.
 *   6. Re-read the PO to capture post-action state.
 *   7. Return everything for inspection.
 *
 * Safety:
 *   - The PO must be for the Test Vendor (VID0048) whose email points at
 *     timothy@vetcove.com. This is enforced as a hard precondition.
 *   - If the PO's vendor isn't VID0048, the route refuses to fire.
 */

const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";

// Hard safety: this experiment ONLY runs against this test vendor.
const REQUIRED_TEST_VENDOR_ID = "VID0048";

// How long to wait for the async email action before giving up
const POLL_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 1000;

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, stage: "parse-body", error: "Invalid JSON body" });
  }

  const { username, password, orderNbr, releaseFirst } = body || {};
  if (!username || !password) {
    return json({ ok: false, stage: "validate-input", error: "username and password required" });
  }
  if (!orderNbr || typeof orderNbr !== "string") {
    return json({ ok: false, stage: "validate-input", error: "orderNbr (string) required" });
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

  try {
    // ── Step 1: Read PO for baseline + id ─────────────────────────────────
    const before = await readPO(cookies, orderNbr);
    if (!before.ok) {
      await logout(cookies);
      return json({ ok: false, stage: "read-before", ...before });
    }

    // ── Safety gate: verify this is the test vendor ───────────────────────
    const beforeVendorID = before.po?.VendorID?.value;
    if (beforeVendorID !== REQUIRED_TEST_VENDOR_ID) {
      await logout(cookies);
      return json({
        ok: false,
        stage: "vendor-safety-check",
        actualVendor: beforeVendorID,
        error: `This experiment route only runs against the test vendor ${REQUIRED_TEST_VENDOR_ID}. PO ${orderNbr} belongs to vendor ${beforeVendorID}. Refusing to fire.`
      });
    }

    const beforeStatus = before.po?.Status?.value;
    const beforeHold = before.po?.Hold?.value;
    const poId = before.po?.id;

    // ── Step 2: Optional release (Hold -> false) ──────────────────────────
    let releaseResult = null;
    if (releaseFirst && beforeStatus === "On Hold") {
      const releaseUrl = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder`;
      const releasePayload = {
        id: poId,
        OrderType: { value: before.po?.Type?.value || "Normal" },
        OrderNbr:  { value: orderNbr },
        Hold:      { value: false }
      };
      const r = await fetch(releaseUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Accept": "application/json", "Cookie": cookies },
        body: JSON.stringify(releasePayload)
      });
      const t = await r.text();
      if (!r.ok) {
        await logout(cookies);
        return json({
          ok: false,
          stage: "release",
          status: r.status,
          rawBody: t.slice(0, 1500),
          payloadSent: releasePayload
        });
      }
      releaseResult = { status: r.status, durationMs: 0 };
    }

    // Re-read after potential release so we have current id + values
    const midRead = releaseFirst ? await readPO(cookies, orderNbr) : { ok: true, po: before.po };
    if (!midRead.ok) {
      await logout(cookies);
      return json({ ok: false, stage: "read-after-release", ...midRead });
    }
    const currentId = midRead.po?.id;
    const currentType = midRead.po?.Type?.value || "Normal";

    // ── Step 3: Invoke EmailPurchaseOrder action ──────────────────────────
    const emailUrl = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder/EmailPurchaseOrder`;
    const emailPayload = {
      entity: {
        id: currentId,
        OrderType: { value: currentType },
        OrderNbr:  { value: orderNbr }
      }
    };

    const emailStart = Date.now();
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
    const initialResponseDurationMs = Date.now() - emailStart;

    // 202 Accepted is the expected success path for async actions.
    // 200 with a body could also indicate success if the action is synchronous in this Acumatica version.
    // Anything else is an error.
    const locationHeader = emailRes.headers.get("location");

    if (emailRes.status !== 202 && emailRes.status !== 200 && emailRes.status !== 204) {
      let errorDetails = null;
      try { errorDetails = extractAllErrors(JSON.parse(emailText)); } catch {}
      await logout(cookies);
      return json({
        ok: false,
        stage: "invoke-email",
        status: emailRes.status,
        statusText: emailRes.statusText,
        errorDetails,
        rawBody: emailText.slice(0, 2000),
        payloadSent: emailPayload,
        durationMs: initialResponseDurationMs
      });
    }

    // ── Step 4: Poll until completion ─────────────────────────────────────
    // If we got a 202 with a Location header, poll. Otherwise the action
    // already completed synchronously and we skip polling.
    const pollResults = [];
    let finalStatus = emailRes.status;
    let polledLocationUrl = null;

    if (emailRes.status === 202 && locationHeader) {
      // Location may be relative or absolute. Make it absolute.
      polledLocationUrl = locationHeader.startsWith("http") ? locationHeader : (BASE + locationHeader);
      const pollDeadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < pollDeadline) {
        await sleep(POLL_INTERVAL_MS);
        const pollRes = await fetch(polledLocationUrl, {
          method: "GET",
          headers: { "Accept": "application/json", "Cookie": cookies }
        });
        const pollText = await pollRes.text();
        pollResults.push({
          attempt: pollResults.length + 1,
          httpStatus: pollRes.status,
          atMs: Date.now() - emailStart,
          bodyPreview: pollText.slice(0, 200)
        });
        finalStatus = pollRes.status;
        // 204 No Content = done. 200 = also done (some Acumatica versions).
        // 202 = still in progress, keep polling.
        if (pollRes.status === 204 || pollRes.status === 200) break;
        if (pollRes.status >= 400) {
          await logout(cookies);
          return json({
            ok: false,
            stage: "poll-status",
            polledLocationUrl,
            pollResults,
            rawBody: pollText.slice(0, 1500)
          });
        }
      }
    }

    const totalElapsedMs = Date.now() - emailStart;

    // ── Step 5: Re-read PO to see post-action state ───────────────────────
    const after = await readPO(cookies, orderNbr);

    await logout(cookies);

    return json({
      ok: true,
      stage: "email-action-done",
      orderNbr,
      summary: {
        vendorID:             beforeVendorID,
        statusBefore:         beforeStatus,
        holdBefore:           beforeHold,
        releaseFirstRequested: !!releaseFirst,
        releaseExecuted:      !!releaseResult,
        emailActionInitialStatus: emailRes.status,
        emailActionFinalStatus:   finalStatus,
        polledLocationUrl,
        totalElapsedMs,
        pollAttempts:         pollResults.length,
        statusAfter:          after.ok ? after.po?.Status?.value : null,
        holdAfter:            after.ok ? after.po?.Hold?.value : null,
        lastModifiedBefore:   before.po?.LastModifiedDateTime?.value,
        lastModifiedAfter:    after.ok ? after.po?.LastModifiedDateTime?.value : null
      },
      pollResults,
      // Full snapshots
      before: snapshotFields(before.po),
      after: after.ok ? snapshotFields(after.po) : null,
      // What we sent
      emailPayloadSent: emailPayload
    });
  } catch (err) {
    await logout(cookies);
    return json({ ok: false, stage: "uncaught", error: String(err) });
  }
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
  if (!res.ok) return { ok: false, status: res.status, rawBody: text.slice(0, 1000) };
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: "non-JSON response" }; }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { ok: false, error: `PO ${orderNbr} not found` };
  }
  return { ok: true, po: parsed[0] };
}

function snapshotFields(po) {
  if (!po || typeof po !== "object") return null;
  const out = {};
  Object.keys(po).forEach(k => {
    if (k === "Details" || k === "_links" || k === "custom" || k === "note") return;
    const v = po[k];
    if (v && typeof v === "object" && "value" in v) out[k] = v.value;
  });
  out._allTopLevelKeys = Object.keys(po);
  return out;
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
