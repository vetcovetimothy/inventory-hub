/**
 * POST /api/oos-history-append
 *
 * Appends the OOS Tracker's daily snapshot rows to the OOS History Google Sheet.
 * Uses the caller's Google refresh token (same token used for Gmail drafts,
 * which must now also carry the Sheets scope), falling back to the server-wide
 * GOOGLE_REFRESH_TOKEN env var.
 *
 * Body: { rows: [[col1, col2, ...], ...], refreshToken?: "..." }
 */

export const dynamic = "force-dynamic";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SHEET_ID = process.env.OOS_HISTORY_SHEET_ID || "1HJu5kVC-kM59ZGuBtjOGc9MBpBGgZdsdvIfZ8MLNsJs";
const RANGE = process.env.OOS_HISTORY_SHEET_RANGE || "Sheet1";

async function getAccessToken(refreshToken) {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("Failed to refresh Google token: " + text);
  }
  const data = await resp.json();
  return data.access_token;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const refreshToken = body.refreshToken || process.env.GOOGLE_REFRESH_TOKEN;
    if (!refreshToken) {
      return Response.json({ ok: false, error: "Not connected to Google (no token)." }, { status: 400 });
    }
    if (!rows.length) {
      return Response.json({ ok: false, error: "No rows to append." }, { status: 400 });
    }

    const accessToken = await getAccessToken(refreshToken);
    const url = "https://sheets.googleapis.com/v4/spreadsheets/" + SHEET_ID +
      "/values/" + encodeURIComponent(RANGE) +
      ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS";

    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ values: rows }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return Response.json({ ok: false, error: "Sheets append failed: " + text }, { status: 502 });
    }
    const data = await resp.json();
    const appended = (data.updates && data.updates.updatedRows) || rows.length;
    return Response.json({ ok: true, appended: appended });
  } catch (e) {
    return Response.json({ ok: false, error: String((e && e.message) || e) }, { status: 500 });
  }
}
