// /app/api/kv/route.js — Shared state via Upstash Redis (secured)
export const runtime = "edge";
export const dynamic = "force-dynamic";

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KV_SECRET = process.env.NEXT_PUBLIC_KV_SECRET;

function checkAuth(request) {
  if (!KV_SECRET) return true; // no secret configured = skip check
  const auth = request.headers.get("x-kv-secret");
  return auth === KV_SECRET;
}

async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  const resp = await fetch(`${KV_URL}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(["GET", key]),
    cache: "no-store",
  });
  if (!resp.ok) return null;
  const json = await resp.json();
  if (json.result === null || json.result === undefined) return null;
  try { return JSON.parse(json.result); } catch { return json.result; }
}

async function kvSet(key, value) {
  if (!KV_URL || !KV_TOKEN) throw new Error("KV not configured");
  const serialized = JSON.stringify(value);
  const resp = await fetch(`${KV_URL}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(["SET", key, serialized]),
    cache: "no-store",
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error("KV save failed: " + resp.status + " " + errText);
  }
  const json = await resp.json();
  if (json.error) throw new Error("KV error: " + json.error);
  return json;
}

export async function GET(request) {
  if (!checkAuth(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    if (!key) return Response.json({ error: "Missing key" }, { status: 400 });
    const data = await kvGet(key);
    return Response.json({ data }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  if (!checkAuth(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
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
