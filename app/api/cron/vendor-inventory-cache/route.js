export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── Vendor Inventory cache refresh ──────────────────────────────────────────
// Runs ~10 min after each upstream Snowflake refresh (5:25 AM / 5:25 PM / 9:25 PM
// ET). Pulls the full vendor-inventory table from /api/vendor-inventory (live
// Snowflake query) and writes it to KV in chunks, because the full set (~10.7k
// rows, ~4.7MB) exceeds a single KV value's size limit. The route then reassembles
// the chunks for instant tab loads.
//
// KV layout:
//   vi-cache-manifest -> { chunks, count, cachedAt }
//   vi-cache-0 .. vi-cache-N -> arrays of rows
//
// Required env: KV_REST_API_URL / KV_REST_API_TOKEN, SITE_URL (optional),
// CRON_SECRET (optional; Vercel Cron sends it).

const SITE_URL = process.env.SITE_URL || "https://inventory-hub-two.vercel.app";
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const MANIFEST_KEY = "vi-cache-manifest";
const CHUNK_PREFIX = "vi-cache-";
const CHUNK_SIZE = 1500; // ~690KB per chunk at ~460 bytes/row — safe under 1MB

async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  const resp = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` }, cache: "no-store" });
  if (!resp.ok) return null;
  const j = await resp.json();
  if (!j || j.result == null) return null;
  try { return JSON.parse(j.result); } catch { return j.result; }
}
async function kvSet(key, value) {
  if (!KV_URL || !KV_TOKEN) return false;
  const resp = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  return resp.ok;
}
async function kvDel(key) {
  if (!KV_URL || !KV_TOKEN) return;
  await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN}` } }).catch(function () {});
}

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization") || "";
    if (auth !== "Bearer " + secret) return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!KV_URL || !KV_TOKEN) return Response.json({ error: "Missing KV env vars" }, { status: 500 });

  // Pull the full live dataset from the route (single source of Snowflake auth).
  let rows;
  try {
    const resp = await fetch(SITE_URL + "/api/vendor-inventory", { cache: "no-store" });
    const j = await resp.json();
    if (!j.ok || !Array.isArray(j.rows)) {
      return Response.json({ ok: false, stage: "fetch", error: (j && (j.message || j.error)) || "live fetch failed" }, { status: 502 });
    }
    rows = j.rows;
  } catch (e) {
    return Response.json({ ok: false, stage: "fetch", error: String(e && e.message || e) }, { status: 502 });
  }

  // Read the previous manifest so we can clean up leftover chunks if the new set
  // has fewer chunks than before.
  const prev = await kvGet(MANIFEST_KEY);
  const prevChunks = (prev && prev.chunks) || 0;

  // Write chunks.
  const chunkCount = Math.ceil(rows.length / CHUNK_SIZE);
  let written = 0;
  for (let i = 0; i < chunkCount; i++) {
    const slice = rows.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const ok = await kvSet(CHUNK_PREFIX + i, slice);
    if (!ok) return Response.json({ ok: false, stage: "kv-write", error: "chunk " + i + " write failed (possibly over size limit)" }, { status: 502 });
    written++;
  }

  // Remove stale chunks from a previous larger run.
  for (let i = chunkCount; i < prevChunks; i++) { await kvDel(CHUNK_PREFIX + i); }

  // Write the manifest last so readers never see a partial set.
  const cachedAt = new Date().toISOString();
  await kvSet(MANIFEST_KEY, { chunks: chunkCount, count: rows.length, cachedAt: cachedAt });

  return Response.json({ ok: true, cachedAt: cachedAt, rows: rows.length, chunks: written });
}
