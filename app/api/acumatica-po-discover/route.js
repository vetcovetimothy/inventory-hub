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
      try { parsed = JSON.parse(sText); } catch {}

      if (parsed && typeof parsed === "object") {
        // Top-level keys are fields and a few meta keys like _workflowActions.
        const fieldNames = Object.keys(parsed).filter(k => !k.startsWith("_"));
        // Workflow actions are listed under _workflowActions
        const wf = parsed._workflowActions || {};
        const workflowActionNames = (wf && typeof wf === "object") ? Object.keys(wf) : [];

        out.schemaSummary = {
          fieldCount: fieldNames.length,
          workflowActionCount: workflowActionNames.length,
          printRelatedFields: fieldNames.filter(n => /print/i.test(n)),
          emailRelatedFields: fieldNames.filter(n => /email|mail/i.test(n)),
          printRelatedWorkflowActions: workflowActionNames.filter(n => /print/i.test(n)),
          emailRelatedWorkflowActions: workflowActionNames.filter(n => /email|mail/i.test(n)),
          holdRelatedWorkflowActions: workflowActionNames.filter(n => /hold/i.test(n)),
          allWorkflowActions: workflowActionNames,
          allFields: fieldNames
        };
        // If there are very few workflow actions, also surface the raw object
        // so we can see their full shape
        if (workflowActionNames.length > 0 && workflowActionNames.length <= 20) {
          out.workflowActionsRaw = wf;
        }
      } else {
        out.schemaRaw = sText.slice(0, 8000);
      }
      out.schemaStatus = sRes.status;
    } catch (err) {
      out.schemaError = String(err);
    }

    // ─── Step 2: live PO sample (if orderNbr provided) ──────────────────────
    // Top-level fields only — no $expand to avoid the ExpandBinder error we
    // hit last time. We just want to see what real field values look like
    // for one PO that we know is "stuck" in Pending Printing.
    if (orderNbr) {
      try {
        const filterUrl = `${BASE}/entity/Default/${API_VERSION}/PurchaseOrder?$filter=OrderNbr eq '${encodeURIComponent(orderNbr)}'`;
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
              const printEmailHoldKeys = {};
              Object.keys(po).forEach(k => {
                if (/print|email|mail|hold/i.test(k)) {
                  printEmailHoldKeys[k] = po[k];
                }
              });
              out.poSampleRelevantFields = printEmailHoldKeys;
              out.poSampleAllTopLevelKeys = Object.keys(po);
              out.poSampleIdentity = {
                OrderNbr: po?.OrderNbr?.value,
                OrderType: po?.OrderType?.value,
                Type: po?.Type?.value,
                Status: po?.Status?.value,
                Hold: po?.Hold?.value,
                VendorID: po?.VendorID?.value,
                VendorRef: po?.VendorRef?.value
              };
              // Also surface the available workflow actions on THIS specific PO
              // (not all entity-level actions are available in every PO state)
              if (po._workflowActions) {
                out.poAvailableWorkflowActions = po._workflowActions;
              }
              if (po._links) {
                out.poLinks = po._links;
              }
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
