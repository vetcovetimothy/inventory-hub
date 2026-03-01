/**
 * GET /api/gmail-callback?code=...
 *
 * Google redirects here after consent. Exchanges the code for tokens
 * and displays the refresh token for you to copy into your .env file.
 */

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return new Response("No code parameter received from Google", { status: 400 });
  }

  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/gmail-callback";

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  const data = await resp.json();

  if (!resp.ok) {
    return new Response("Token exchange failed: " + JSON.stringify(data), { status: 500 });
  }

  // Display the refresh token for the user to copy
  const html = `
    <!DOCTYPE html>
    <html>
    <head><title>Gmail Setup Complete</title></head>
    <body style="font-family: monospace; max-width: 600px; margin: 40px auto; padding: 20px; background: #0B0E14; color: #E2E8F0;">
      <h2 style="color: #10B981;">Gmail Authorization Complete</h2>
      <p>Copy this refresh token into your <code>.env</code> file:</p>
      <div style="background: #111520; border: 1px solid #1E2433; border-radius: 8px; padding: 16px; word-break: break-all; margin: 16px 0;">
        <code>GOOGLE_REFRESH_TOKEN=${data.refresh_token || "NOT RETURNED — you may need to revoke access and try again"}</code>
      </div>
      <p style="color: #64748B; font-size: 12px;">
        After adding this to your .env (or Vercel Environment Variables), redeploy.
        You only need to do this once — the refresh token doesn't expire unless you revoke it.
      </p>
    </body>
    </html>
  `;

  return new Response(html, { headers: { "Content-Type": "text/html" } });
}
