/**
 * POST /api/gmail-drafts
 *
 * Creates Gmail drafts for vendor emails.
 * Accepts a per-user refresh token in the request body, or falls back to
 * the server-wide GOOGLE_REFRESH_TOKEN env var.
 *
 * Body: {
 *   refreshToken: "user's refresh token" (optional - falls back to env var),
 *   drafts: [
 *     { to: "email@vendor.com", cc: "team@vetcove.com", subject: "...", htmlBody: "..." }
 *   ]
 * }
 */

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

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

function buildMimeMessage({ to, cc, subject, htmlBody }) {
  const boundary = "boundary_" + Date.now();
  const lines = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    htmlToPlainText(htmlBody),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    htmlBody,
    "",
    `--${boundary}--`,
  ].filter(l => l !== null);

  return lines.join("\r\n");
}

function htmlToPlainText(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function base64url(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { drafts, refreshToken: userToken } = body;

    // Use per-user token if provided, otherwise fall back to env var
    const refreshToken = userToken || process.env.GOOGLE_REFRESH_TOKEN;

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return Response.json(
        { error: "Gmail not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your environment variables." },
        { status: 500 }
      );
    }

    if (!refreshToken) {
      return Response.json(
        { error: "No Gmail account connected. Please connect your Gmail account first." },
        { status: 401 }
      );
    }

    if (!drafts || !Array.isArray(drafts) || drafts.length === 0) {
      return Response.json({ error: "No drafts provided" }, { status: 400 });
    }

    const accessToken = await getAccessToken(refreshToken);
    const results = [];

    for (const draft of drafts) {
      const raw = base64url(buildMimeMessage(draft));

      const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: { raw } }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        results.push({ to: draft.to, success: false, error: errText.slice(0, 200) });
      } else {
        const data = await resp.json();
        results.push({ to: draft.to, success: true, draftId: data.id });
      }
    }

    const created = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return Response.json({ created, failed, results });
  } catch (err) {
    console.error("Gmail draft error:", err);
    return Response.json({ error: "Server error", detail: err.message }, { status: 500 });
  }
}
