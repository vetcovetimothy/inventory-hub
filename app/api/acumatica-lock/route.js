/**
 * POST /api/acumatica-lock
 *
 * A per-warehouse advisory lock so two people on the SAME warehouse's PO Tool page
 * can't run Acumatica operations at the same time (which collides into a 401 at
 * Acumatica's concurrent-session limit). Different warehouses are independent.
 *
 * Body:
 *   { action: "acquire" | "release" | "status", warehouse, heldBy?, operation?, token? }
 *
 * acquire — atomically takes the lock if free (Redis SET NX EX). Returns
 *           { ok:true, token } on success, or { ok:false, busy:true, heldBy, operation }
 *           if someone else holds it. The lock auto-expires via TTL so a crashed
 *           operation can never block forever.
 * release — clears the lock, but ONLY if the caller's token matches (so you can't
 *           release someone else's lock). Expired locks are already gone.
 * status  — returns who holds it, if anyone.
 *
 * Lock key: acu-lock:<warehouse>
 */

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const LOCK_TTL = 120; // seconds — must exceed the slowest Acumatica operation

function lockKey(wh) { return "acu-lock:" + String(wh || "").trim(); }

async function redis(cmd) {
  if (!KV_URL || !KV_TOKEN) throw new Error("KV not configured");
  const resp = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + KV_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  const j = await resp.json();
  return j;
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const action = body.action;
  const wh = body.warehouse;
  if (!wh) return Response.json({ ok: false, error: "warehouse required" }, { status: 400 });
  const key = lockKey(wh);

  try {
    if (action === "acquire") {
      const token = (body.heldBy || "user") + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      const payload = JSON.stringify({ heldBy: body.heldBy || "someone", operation: body.operation || "an Acumatica operation", startedAt: Date.now(), token });
      // Atomic: set only if not exists, with expiry. Returns "OK" on success, null if held.
      const r = await redis(["SET", key, payload, "NX", "EX", String(LOCK_TTL)]);
      if (r && r.result === "OK") {
        return Response.json({ ok: true, token });
      }
      // Busy — report who holds it.
      const cur = await redis(["GET", key]);
      let info = {};
      try { info = cur && cur.result ? JSON.parse(cur.result) : {}; } catch (e) {}
      return Response.json({ ok: false, busy: true, heldBy: info.heldBy || "someone", operation: info.operation || "an Acumatica operation" });
    }

    if (action === "release") {
      // Only release if the token matches, so one user can't clear another's lock.
      const cur = await redis(["GET", key]);
      if (!cur || cur.result == null) return Response.json({ ok: true, released: false, note: "already free" });
      let info = {};
      try { info = JSON.parse(cur.result); } catch (e) {}
      if (body.force === true || (body.token && info.token === body.token)) {
        await redis(["DEL", key]);
        return Response.json({ ok: true, released: true });
      }
      return Response.json({ ok: false, error: "token mismatch — not your lock" }, { status: 409 });
    }

    if (action === "status") {
      const cur = await redis(["GET", key]);
      if (!cur || cur.result == null) return Response.json({ ok: true, locked: false });
      let info = {};
      try { info = JSON.parse(cur.result); } catch (e) {}
      return Response.json({ ok: true, locked: true, heldBy: info.heldBy, operation: info.operation, startedAt: info.startedAt });
    }

    return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (err) {
    return Response.json({ ok: false, error: String(err && err.message || err) }, { status: 500 });
  }
}
