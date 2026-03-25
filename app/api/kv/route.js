// /app/api/kv/route.js — Shared state via Upstash Redis
export const runtime = "edge";
export const dynamic = "force-dynamic";

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  const resp = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
  if (!resp.ok) { console.error("[KV GET error]", resp.status, await resp.text()); return null; }
  const json = await resp.json();
  if (json.result === null || json.result === undefined) return null;
  try { return JSON.parse(json.result); } catch { return json.result; }
}

async function kvSet(key, value) {
  if (!KV_URL || !KV_TOKEN) throw new Error("KV not configured");
  const body = JSON.stringify(JSON.stringify(value));
  const resp = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: body,
    cache: "no-store",
  });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error("[KV SET error]", resp.status, errText, "payload size:", body.length);
    throw new Error("KV save failed: " + resp.status);
  }
  return resp.json();
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    if (!key) return Response.json({ error: "Missing key" }, { status: 400 });
    const data = await kvGet(key);
    return Response.json({ data }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache" },
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { key, value } = body;
    if (!key) return Response.json({ error: "Missing key" }, { status: 400 });
    await kvSet(key, value);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
