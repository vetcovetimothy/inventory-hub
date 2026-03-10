// /app/api/kv/route.js — Shared state via Upstash Redis
export const runtime = "edge";

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvGet(key) {
  const resp = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const json = await resp.json();
  if (json.result === null || json.result === undefined) return null;
  try { return JSON.parse(json.result); } catch { return json.result; }
}

async function kvSet(key, value) {
  const resp = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(JSON.stringify(value)),
  });
  return resp.json();
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    if (!key) return Response.json({ error: "Missing key" }, { status: 400 });
    const data = await kvGet(key);
    return Response.json({ data });
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
