/**
 * POST /api/acumatica-edi-release-test
 *
 * EXPERIMENT 3 — does calling DoNotEmail + DoNotPrint before setting Hold:false
 * actually suppress Acumatica's auto-email and auto-print behavior on release?
 *
 * Background:
 *   - Test Vendor VID0048 has both Print Order ✓ and Email Order ✓ checked
 *     on its vendor record (Vendors AP303000 → Purchase Settings).
 *   - Standard 2025 R2 behavior: when a PO with those flags goes from On Hold
 *     → Open, Acumatica auto-queues the email + print.
 *   - For EDI vendors, we don't want either to fire — we want the PO released
 *     so the EDI vendor reference can be acknowledged, but the actual order
 *     submission goes through TrueCommerce's SFTP via webhook.
 *   - The Acumatica UI exposes DoNotEmail and DoNotPrint actions on the PO
 *     entity. This experiment verifies they're callable via REST AND that
 *     they prevent the auto-fire on subsequent release.
 *
 * Body:
 *   {
 *     username, password,
 *     orderNbr: string,          // e.g. "PO008700"
 *     skipDoNotEmail: boolean,   // optional, default false — skip the DoNotEmail call
 *     skipDoNotPrint: boolean    // optional, default false — skip the DoNotPrint call
 *   }
 *
 * Sequence:
 *   1. Login.
 *   2. Read PO → verify VID0048 vendor → verify On Hold status.
 *   3. (optional skip) POST /PurchaseOrder/DoNotEmail → poll until done.
 *   4. (optional skip) POST /PurchaseOrder/DoNotPrint → poll until done.
 *   5. PUT VendorRef ("EDI-RELEASE-TEST-{timestamp}") + Hold:false.
 *   6. Re-read PO → capture final state.
 *   7. Return a detailed stage-by-stage report.
 *
 * What you (the human) verify manually after running:
 *   - PO status is Open (release worked)
 *   - Acumatica Activities tab on the PO shows NO new email send, NO print queue
 *   - Inbox at timothy@vetcove.com has no new Acumatica email
 *   If all three: DoNotEmail/DoNotPrint work as intended → we can build the
 *   production EDI flow on top of this primitive.
 *
 * Safety:
 *   - HARD precondition: PO must belong to VID0048 (Test Vendor). Refuses to
 *     run against any other vendor to avoid accidentally suppressing real
 *     order emails/prints.
 */

const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";

const REQUIRED_TEST_VENDOR_ID = "VID0048";
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

  const { username, password, orderNbr, skipDoNotEmail, skipDoNotPrint } = body || {};
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

  // ── Read PO + validate ──────────────────────────────────────────────────
  const readResult = await readPO(cookies, orderNbr);
  if (!readResult.ok) {
    return json({ ok: false, stage: "read-po", error: readResult.error || `Could not read ${orderNbr}` });
  }
  const po = readResult.po;
  const vendorId = po?.VendorID?.value;
  const currentStatus = po?.Status?.value;
  const initialHold = po?.Hold?.value;

  if (vendorId !== REQUIRED_TEST_VENDOR_ID) {
    return json({
      ok: false,
      stage: "vendor-check",
      vendorIdFound: vendorId,
      error: `Refusing to run: PO ${orderNbr} belongs to ${vendorId}, not Test Vendor ${REQUIRED_TEST_VENDOR_ID}. This experiment ONLY runs against the test vendor.`
    });
  }
  if (currentStatus !== REQUIRED_STATUS) {
    return json({
      ok: false,
      stage: "status-check",
      currentStatus,
      error: `${orderNbr} is not On Hold (status: ${currentStatus}). Set it back to On Hold in Acumatica and re-run.`
    });
  }

  const report = {
    orderNbr,
    initialStatus: currentStatus,
    initialHold,
    vendorId,
    steps: []
  };

  // ── Step 1: DoNotEmail ──────────────────────────────────────────────────
  if (!skipDoNotEmail) {
    const r = await invokeAction(cookies, "DoNotEmail", po, orderNbr);
    report.steps.push({ action: "DoNotEmail", ...r });
    if (!r.ok) {
      // Don't bail — still want to see if subsequent steps work / report what failed
      report.fatal = "DoNotEmail failed; aborting before release to avoid sending the unwanted email";
      return json({ ok: false, stage: "do-not-email", report });
    }
  } else {
    report.steps.push({ action: "DoNotEmail", skipped: true });
  }

  // ── Step 2: DoNotPrint ──────────────────────────────────────────────────
  if (!skipDoNotPrint) {
    const r = await invokeAction(cookies, "DoNotPrint", po, orderNbr);
    report.steps.push({ action: "DoNotPrint", ...r });
    if (!r.ok) {
      report.fatal = "DoNotPrint failed; aborting before release";
      return json({ ok: false, stage: "do-not-print", report });
    }
  } else {
    report.steps.push({ action: "DoNotPrint", skipped: true });
  }

  // ── Step 3: Release (PUT VendorRef + Hold:false) ─────────────────────────
  const testRef = "EDI-RELEASE-TEST-" + Date.now().toString().slice(-6);
  const putUrl = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder`;
  const putPayload = {
    id: po.id,
    OrderType: { value: po?.Type?.value || "Normal" },
    OrderNbr: { value: orderNbr },
    VendorRef: { value: testRef },
    Hold: { value: false }
  };
  let statusAfterRelease = null;
  try {
    const res = await fetch(putUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "Cookie": cookies },
      body: JSON.stringify(putPayload)
    });
    const text = await res.text();
    if (!res.ok) {
      report.steps.push({ action: "release", ok: false, status: res.status, body: text.slice(0, 1000) });
      return json({ ok: false, stage: "release", report });
    }
    let updated;
    try { updated = JSON.parse(text); } catch {}
    statusAfterRelease = updated?.Status?.value;
    report.steps.push({ action: "release", ok: true, vendorRefWritten: testRef, statusAfterRelease });
  } catch (err) {
    report.steps.push({ action: "release", ok: false, error: String(err) });
    return json({ ok: false, stage: "release", report });
  }

  // ── Step 4: Re-read PO to capture final state ───────────────────────────
  const finalRead = await readPO(cookies, orderNbr);
  if (finalRead.ok) {
    const fp = finalRead.po;
    report.finalState = {
      status: fp?.Status?.value,
      hold: fp?.Hold?.value,
      vendorRef: fp?.VendorRef?.value
    };
  } else {
    report.finalState = { error: "Could not re-read PO after release" };
  }

  report.humanCheckInstructions = [
    `1. Open ${orderNbr} in Acumatica → confirm status shows Open.`,
    `2. Open Activities tab on the PO → confirm NO new email send entry and NO new print queue entry.`,
    `3. Check timothy@vetcove.com inbox → confirm NO new Acumatica email arrived from this release.`,
    `If all three are true: DoNotEmail + DoNotPrint successfully suppressed the auto-fire.`,
    `If any are false: the experiment failed → DoNotEmail/DoNotPrint don't work as expected via REST → need to fall back to a different approach.`
  ];

  return json({ ok: true, stage: "all-done", report });
}

// ─────────────────────────────────────────────────────────────────────────
async function readPO(cookies, orderNbr) {
  const url = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder?$filter=OrderNbr eq '${encodeURIComponent(orderNbr)}'&$expand=Details`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "Accept": "application/json", "Cookie": cookies }
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Read failed (${res.status}): ${text.slice(0, 300)}` };
    }
    const data = await res.json();
    const arr = Array.isArray(data) ? data : (data.value || []);
    if (arr.length === 0) return { ok: false, error: `PO ${orderNbr} not found` };
    return { ok: true, po: arr[0] };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Invoke a PO action (DoNotEmail / DoNotPrint / etc) and poll for completion.
// Returns { ok, initialStatus, pollAttempts, finalStatus, error? }
async function invokeAction(cookies, actionName, po, orderNbr) {
  const url = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder/${actionName}`;
  const payload = {
    entity: {
      id: po.id,
      OrderType: { value: po?.Type?.value || "Normal" },
      OrderNbr: { value: orderNbr }
    }
  };
  let initialStatus = null;
  let locationHeader = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "Cookie": cookies },
      body: JSON.stringify(payload)
    });
    initialStatus = res.status;
    locationHeader = res.headers.get("location");
    const text = await res.text();

    // Action exists & succeeded synchronously
    if (initialStatus === 204 || initialStatus === 200) {
      return { ok: true, initialStatus, pollAttempts: 0, finalStatus: initialStatus };
    }

    // Action accepted, processing async — poll Location
    if (initialStatus === 202 && locationHeader) {
      const pollUrl = locationHeader.startsWith("http") ? locationHeader : (BASE + locationHeader);
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      let pollAttempts = 0;
      let lastPollStatus = 202;
      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        pollAttempts++;
        const pollRes = await fetch(pollUrl, { method: "GET", headers: { "Accept": "application/json", "Cookie": cookies } });
        lastPollStatus = pollRes.status;
        if (pollRes.status === 204 || pollRes.status === 200) {
          return { ok: true, initialStatus, pollAttempts, finalStatus: lastPollStatus };
        }
        if (pollRes.status >= 400) {
          const pollText = await pollRes.text();
          return { ok: false, initialStatus, pollAttempts, finalStatus: lastPollStatus, error: `Poll failed: ${pollText.slice(0, 500)}` };
        }
      }
      return { ok: false, initialStatus, pollAttempts, finalStatus: lastPollStatus, error: `Poll timeout after ${POLL_TIMEOUT_MS}ms` };
    }

    // Anything else = action doesn't exist or rejected
    return {
      ok: false,
      initialStatus,
      error: `Unexpected response (${initialStatus}). Body: ${text.slice(0, 800)}`
    };
  } catch (err) {
    return { ok: false, initialStatus, error: String(err) };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function json(obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
