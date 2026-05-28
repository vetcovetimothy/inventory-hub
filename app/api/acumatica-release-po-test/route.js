/**
 * POST /api/acumatica-release-po-test
 *
 * EXPERIMENT — used to learn how Acumatica's contract-based REST API behaves
 * when we set Hold = false on a previously held PO. We need this knowledge
 * to design the "Process All POs" button on the PO Tools shipping page.
 *
 * Body:
 *   {
 *     username, password,
 *     orderNbr: string           // e.g. "PO008627" — must currently be On Hold
 *   }
 *
 * What this route does, step by step:
 *   1. Login.
 *   2. Read the PO with $expand=Details so we have a full baseline snapshot.
 *      Refuses if not currently On Hold.
 *   3. Read the PO's Activities to capture the pre-release state.
 *   4. PUT Hold = false with the PO's id (no other field changes).
 *   5. Read the PO back (with Details + activities again) to compare.
 *   6. Compare before-vs-after and return both snapshots plus a summary.
 *   7. Logout.
 *
 * What this route does NOT do:
 *   - Does not invoke any explicit "Email PO" or "Print PO" action.
 *   - Does not change Vendor Ref or any other PO field.
 *   - Does not attempt to put the PO back on hold afterward.
 *
 * The whole point is to observe what Acumatica does on its own when we
 * flip Hold to false via the API. The before/after snapshots tell us whether
 * the system queued anything (email, print) on the release.
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

  const { username, password, orderNbr } = body || {};
  if (!username || !password) {
    return json({ ok: false, stage: "validate-input", error: "username and password required" });
  }
  if (!orderNbr || typeof orderNbr !== "string") {
    return json({ ok: false, stage: "validate-input", error: "orderNbr (string) is required" });
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
    // ── Step 1: Read BEFORE state ─────────────────────────────────────────
    const beforeRead = await readPO(cookies, orderNbr);
    if (!beforeRead.ok) {
      await logout(cookies);
      return json({ ok: false, stage: "read-before", ...beforeRead });
    }
    const before = beforeRead.po;
    const beforeStatus = before?.Status?.value;

    if (beforeStatus !== "On Hold") {
      await logout(cookies);
      return json({
        ok: false,
        stage: "status-check",
        currentStatus: beforeStatus,
        error: `PO ${orderNbr} is not On Hold (status: ${beforeStatus}). Refusing to test release on a non-held PO.`
      });
    }

    // ── Step 2: PUT Hold = false ──────────────────────────────────────────
    // Bare minimum payload. We include `id` so Acumatica treats this as an
    // update of the existing record (same pattern that worked for VendorRef).
    const releaseUrl = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder`;
    const releasePayload = {
      id: before.id,
      OrderType: { value: before?.Type?.value || "Normal" },
      OrderNbr:  { value: orderNbr },
      Hold:      { value: false }
    };

    const releaseStart = Date.now();
    const releaseRes = await fetch(releaseUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Cookie": cookies
      },
      body: JSON.stringify(releasePayload)
    });
    const releaseText = await releaseRes.text();
    const releaseDurationMs = Date.now() - releaseStart;

    if (!releaseRes.ok) {
      let errorDetails = null;
      try { errorDetails = extractAllErrors(JSON.parse(releaseText)); } catch {}
      await logout(cookies);
      return json({
        ok: false,
        stage: "release",
        status: releaseRes.status,
        errorDetails,
        rawBody: releaseText.slice(0, 2000),
        payloadSent: releasePayload,
        durationMs: releaseDurationMs
      });
    }

    // Acumatica responds with the updated PO inline — parse it for the
    // immediate post-release status.
    let immediateAfter = null;
    try { immediateAfter = JSON.parse(releaseText); } catch {}

    // ── Step 3: Re-read AFTER state ───────────────────────────────────────
    // The immediate response may not yet reflect any side effects (queued
    // emails, print jobs). Do a fresh read to see the post-release reality.
    const afterRead = await readPO(cookies, orderNbr);
    const after = afterRead.ok ? afterRead.po : null;

    await logout(cookies);

    // ── Step 4: Summarize what we observed ────────────────────────────────
    return json({
      ok: true,
      stage: "release-done",
      orderNbr,
      summary: {
        statusBefore:           beforeStatus,
        statusImmediateAfter:   immediateAfter?.Status?.value,
        statusAfterReRead:      after?.Status?.value,
        holdBefore:             before?.Hold?.value,
        holdImmediateAfter:     immediateAfter?.Hold?.value,
        holdAfterReRead:        after?.Hold?.value,
        releaseCallDurationMs:  releaseDurationMs,
        vendorRefBefore:        before?.VendorRef?.value,
        vendorRefAfter:         after?.VendorRef?.value,
        lastModifiedBefore:     before?.LastModifiedDateTime?.value,
        lastModifiedAfter:      after?.LastModifiedDateTime?.value,
      },
      // Full snapshots for deeper inspection — most useful fields surfaced;
      // dump the raw response objects so any unexpected fields are visible too.
      before: snapshotFields(before),
      immediateAfter: snapshotFields(immediateAfter),
      after: snapshotFields(after)
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
    `&$expand=Details&$top=1`;

  const res = await fetch(url, {
    method: "GET",
    headers: { "Accept": "application/json", "Cookie": cookies }
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, rawBody: text.slice(0, 1000) };
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    return { ok: false, error: "non-JSON response", rawBody: text.slice(0, 500) };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { ok: false, error: `PO ${orderNbr} not found` };
  }
  return { ok: true, po: parsed[0] };
}

// Pull only the interesting top-level fields into a flat object, so the response
// stays readable. Skips the `custom`, `_links`, large nested arrays except a
// brief Details summary.
function snapshotFields(po) {
  if (!po || typeof po !== "object") return null;
  const out = {};
  Object.keys(po).forEach(k => {
    if (k === "Details" || k === "_links" || k === "custom" || k === "note") return;
    const v = po[k];
    if (v && typeof v === "object" && "value" in v) out[k] = v.value;
  });
  out._allTopLevelKeys = Object.keys(po);
  if (Array.isArray(po.Details)) {
    out.detailCount = po.Details.length;
    out.detailLineNbrs = po.Details.map(d => d?.LineNbr?.value).filter(x => x != null);
  }
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
