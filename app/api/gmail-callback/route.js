/**
 * GET /api/gmail-callback?code=...&state=...
 *
 * Google redirects here after consent. Exchanges the code for tokens,
 * fetches the user's email address, and redirects back to the app
 * with the refresh token and email as URL hash parameters.
 */

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state") || "";

  if (!code) {
    return new Response("No code parameter received from Google", { status: 400 });
  }

  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/gmail-callback";

  // Exchange code for tokens
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
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

  const tokenData = await tokenResp.json();

  if (!tokenResp.ok) {
    return new Response("Token exchange failed: " + JSON.stringify(tokenData), { status: 500 });
  }

  // Fetch user's email address
  let userEmail = "";
  try {
    const profileResp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: "Bearer " + tokenData.access_token },
    });
    if (profileResp.ok) {
      const profile = await profileResp.json();
      userEmail = profile.email || "";
    }
  } catch (e) {
    // Non-fatal - we just won't have the email to display
  }

  const refreshToken = tokenData.refresh_token || "";

  // Determine redirect target
  const appOrigin = state || new URL(request.url).origin;

  // Redirect back to the app with token info in the hash (never sent to server)
  const redirectUrl = appOrigin + "#gmail_token=" + encodeURIComponent(refreshToken) + "&gmail_email=" + encodeURIComponent(userEmail);

  return Response.redirect(redirectUrl, 302);
}
