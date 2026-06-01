/**
 * GET /api/acumatica-po-discover?username=X&password=Y&orderNbr=PO008668
 *
 * Discovery-only. Logs in, then:
 *
 *   1. Fetches the $adHocSchema for PurchaseOrder — returns every field and
 *      every action published on the contract-based REST endpoint. This is
 *      where we find out if "DoNotPrint" exists as a field, and if there's
 *      an action like "DoNotPrint" / "MarkAsPrinted" we could call instead
 *      of trying to PUT a field.
 *
 *   2. Fetches an actual existing PO with $expand=* so we see the actual
 *      field VALUES, including any nested objects we might have missed.
 *
 *   3. Returns both raw responses (truncated to keep response size sane).
 *
 * The combination tells us:
 *   - what fields exist on the entity (from the schema)
 *   - what actions can be invoked (from the schema)
 *   - what fields are populated on a real PO (from the live fetch)
 *
 * Logs out in finally.
 */

const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";

export async function GET(req) {
  const url = new URL(req.url);
  const username = url.searchParams.get("username");
  const password = url.searchParams.get("password");
  const orderNbr = url.searchParams.get("orderNbr"); // optional — if not provided, skip step 2
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

  const out = { ok: true };

  try {
    // ─── Step 1: ad-hoc schema for PurchaseOrder ────────────────────────────
    // Returns every field + action published on the entity.
    try {
      const schemaUrl = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder/$adHocSchema`;
      const sRes = await fetch(schemaUrl, {
        method: "GET",
        headers: { "Accept": "application/json", "Cookie": cookies }
      });
      const sText = await sRes.text();
      let parsed = null;
      try {
        parsed = JSON.parse(sText);
      } catch {}
      // Extract just field names + action names if parseable — much more useful than raw blob.
      if (parsed && typeof parsed === "object") {
        const fieldNames = [];
        const actionNames = [];
        // Schema structure: top-level keys are field names; "Actions" key (or
        // separate actions list) holds invokable actions. Walk shallow.
        Object.keys(parsed).forEach(k => {
          const v = parsed[k];
          // Heuristic: actions are usually marked by "type": "Action" or
          // appear under an "Actions" sub-object. Capture both shapes.
          if (v && typeof v === "object" && v.type === "Action") {
            actionNames.push(k);
          } else {
            fieldNames.push(k);
          }
        });
        // If there's a nested Actions object, surface those too
        if (parsed.Actions && typeof parsed.Actions === "object") {
          Object.keys(parsed.Actions).forEach(a => {
            if (!actionNames.includes(a)) actionNames.push(a);
          });
        }
        out.schemaSummary = {
          fieldCount: fieldNames.length,
          actionCount: actionNames.length,
          // Filter to anything that smells like Print/Email so we don't drown in noise
          printRelatedFields: fieldNames.filter(n => /print/i.test(n)),
          emailRelatedFields: fieldNames.filter(n => /email|mail/i.test(n)),
          printRelatedActions: actionNames.filter(n => /print/i.test(n)),
          emailRelatedActions: actionNames.filter(n => /email|mail/i.test(n)),
          allActions: actionNames,
          // Full field list, just in case — but capped to avoid huge response
          allFields: fieldNames.slice(0, 300)
        };
      } else {
        out.schemaRaw = sText.slice(0, 8000);
      }
      out.schemaStatus = sRes.status;
    } catch (err) {
      out.schemaError = String(err);
    }

    // ─── Step 2: live PO sample (if orderNbr provided) ──────────────────────
    // We GET the PO with $expand=* to surface every nested entity. Then we
    // walk the JSON for any key that looks Print- or Email-related.
    if (orderNbr) {
      try {
        // Acumatica REST: filter by OrderNbr + OrderType, expand everything
        const filterUrl = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder?$filter=OrderNbr eq '${encodeURIComponent(orderNbr)}'&$expand=Details,TaxDetails,Shipping`;
        const poRes = await fetch(filterUrl, {
          method: "GET",
          headers: { "Accept": "application/json", "Cookie": cookies }
        });
        const poText = await poRes.text();
        out.poFetchStatus = poRes.status;
        if (poRes.ok) {
          try {
            const arr = JSON.parse(poText);
            const po = Array.isArray(arr) ? arr[0] : arr;
            if (po) {
              // Walk every key on the top-level PO object; report any that
              // are Print/Email related, along with their values.
              const printEmailKeys = {};
              Object.keys(po).forEach(k => {
                if (/print|email|mail/i.test(k)) {
                  printEmailKeys[k] = po[k];
                }
              });
              out.poSampleRelevantFields = printEmailKeys;
              // Also list all top-level field names so we can spot anything
              // unexpected
              out.poSampleAllTopLevelKeys = Object.keys(po);
              // Surface a few core fields so we know which PO we got
              out.poSampleIdentity = {
                OrderNbr: po?.OrderNbr?.value,
                OrderType: po?.OrderType?.value,
                Status: po?.Status?.value,
                Hold: po?.Hold?.value,
                VendorID: po?.VendorID?.value,
                VendorRef: po?.VendorRef?.value
              };
            } else {
              out.poSampleNotFound = `No PO matching OrderNbr=${orderNbr}`;
            }
          } catch (e) {
            out.poParseError = String(e);
            out.poRaw = poText.slice(0, 4000);
          }
        } else {
          out.poFetchError = poText.slice(0, 2000);
        }
      } catch (err) {
        out.poFetchError = String(err);
      }
    } else {
      out.poFetchSkipped = "no orderNbr param provided";
    }
  } finally {
    try {
      await fetch(`${BASE}/entity/auth/logout`, { method: "POST", headers: { "Cookie": cookies } });
    } catch {}
  }

  return json(out);
}

function json(payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
