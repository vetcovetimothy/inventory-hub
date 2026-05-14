/**
 * GET /api/cron/prewarm-cache
 *
 * Daily pre-warm: hits the cacheable Acumatica endpoints before users show up.
 * First user of the day gets instant responses instead of paying the cold-cache cost.
 *
 * Triggered by Vercel Cron (see vercel.json). Protected by CRON_SECRET bearer token.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BASE = process.env.ACUMATICA_BASE_URL || "https://vetcove.acumatica.com";
const SITE_URL = process.env.SITE_URL || "https://inventory-hub-two.vercel.app";

// Types to pre-warm — must match the cacheable list in app/api/acumatica/route.js
const TYPES_TO_WARM = [
  "ndc-lookup",
  "stock-cross-ref",
  "item-xref",
  "uom-conversions",
  "gen-pricing",
  "gen-pricing-3prx",
  "open-po-lines",
  "backorder",
];

export async function GET(request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization") || "";
    if (auth !== `Bearer ${cronSecret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const username = process.env.ACUMATICA_CRON_USERNAME;
  const password = process.env.ACUMATICA_CRON_PASSWORD;
  if (!username || !password) {
    return Response.json({ error: "Missing ACUMATICA_CRON_USERNAME/PASSWORD" }, { status: 500 });
  }

  // Hit the public acumatica endpoint with refresh=1 to force fresh data + cache write
  const results = await Promise.all(
    TYPES_TO_WARM.map(async (type) => {
      const start = Date.now();
      try {
        const resp = await fetch(`${SITE_URL}/api/acumatica?refresh=1`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, username, password }),
        });
        const json = await resp.json();
        return {
          type,
          ok: resp.ok,
          count: json.count || 0,
          ms: Date.now() - start,
          error: json.error || null,
        };
      } catch (err) {
        return { type, ok: false, ms: Date.now() - start, error: err.message };
      }
    })
  );

  const totalMs = results.reduce((sum, r) => sum + r.ms, 0);
  const failed = results.filter((r) => !r.ok);

  return Response.json({
    ok: failed.length === 0,
    warmed: results.length,
    failed: failed.length,
    totalMs,
    results,
  });
}
