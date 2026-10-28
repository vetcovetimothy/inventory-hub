/**
 * GET/POST /api/stockitem-diagnostic   — READ-ONLY. Writes nothing.
 *
 * Logs into Acumatica, fetches ONE StockItem via the contract-based REST API, and
 * reports whether NoteText and ABCCode (Movement Class) are exposed and what they
 * contain. Used to confirm whether the hub can write notes + movement class before
 * building that feature.
 *
 * Params (query or JSON body): username, password, inventoryID (optional).
 * Returns: { ok, inventoryID, hasNoteText, noteTextValue, hasABCCode, abcCodeValue,
 *            alternatesFound, allTopLevelFields }
 */

const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const API_VERSION = "25.200.001";

function json(payload, status) {
  return new Response(JSON.stringify(payload, null, 2), { status: status || 200, headers: { "Content-Type": "application/json" } });
}

async function run(username, password, inventoryID) {
  if (!username || !password) return json({ ok: false, stage: "input", error: "username and password required" }, 400);

  let cookies = "";
  try {
    const loginRes = await fetch(`${BASE}/entity/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ name: username, password: password }),
    });
    if (!loginRes.ok) {
      const text = await loginRes.text();
      return json({ ok: false, stage: "login", status: loginRes.status, body: text.slice(0, 400) });
    }
    const setCookie = loginRes.headers.get("set-cookie") || "";
    cookies = setCookie.split(",").map(c => c.split(";")[0].trim()).filter(Boolean).join("; ");
  } catch (err) {
    return json({ ok: false, stage: "login", error: String(err) });
  }

  try {
    let url;
    if (inventoryID) url = `${BASE}/entity/Default/${API_VERSION}/StockItem/${encodeURIComponent(inventoryID)}`;
    else url = `${BASE}/entity/Default/${API_VERSION}/StockItem?$top=1`;

    const res = await fetch(url, { method: "GET", headers: { "Cookie": cookies, "Accept": "application/json" } });
    const text = await res.text();
    if (!res.ok) return json({ ok: false, stage: "fetch-stockitem", status: res.status, url, body: text.slice(0, 600) });

    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
    const record = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!record) return json({ ok: false, stage: "no-record", url, body: text.slice(0, 600) });

    function fieldVal(name) {
      if (!(name in record)) return { present: false };
      const f = record[name];
      const v = (f && typeof f === "object" && "value" in f) ? f.value : f;
      return { present: true, value: v };
    }
    const note = fieldVal("NoteText");
    const abc = fieldVal("ABCCode");
    const alternates = {};
    ["MovementClass", "Note", "UsrNote", "ABC", "ABCCodeID"].forEach(function (n) {
      if (n in record) alternates[n] = fieldVal(n);
    });

    return json({
      ok: true,
      inventoryID: fieldVal("InventoryID").value || inventoryID || "(first item)",
      hasNoteText: note.present,
      noteTextValue: note.present ? note.value : null,
      hasABCCode: abc.present,
      abcCodeValue: abc.present ? abc.value : null,
      alternatesFound: alternates,
      noteField: ("note" in record) ? record.note : "(no 'note' key)",
      noteIDField: ("NoteID" in record) ? record.NoteID : "(no 'NoteID' key)",
      allTopLevelFields: Object.keys(record).sort(),
    });
  } catch (err) {
    return json({ ok: false, stage: "run", error: String(err) });
  } finally {
    try { await fetch(`${BASE}/entity/auth/logout`, { method: "POST", headers: { "Cookie": cookies } }); } catch (e) {}
  }
}

export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch (e) {}
  return run(body.username, body.password, body.inventoryID);
}
export async function GET(req) {
  const u = new URL(req.url);
  return run(u.searchParams.get("username"), u.searchParams.get("password"), u.searchParams.get("inventoryID"));
}
