/**
 * GET /api/gmail-auth
 *
 * Redirects the user to Google's OAuth consent screen.
 * After consenting, Google redirects to /api/gmail-callback with a code,
 * which gets exchanged for a refresh token that is passed back to the app.
 */

export async function GET(request) {
  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/gmail-callback";

  if (!CLIENT_ID) {
    return new Response("GOOGLE_CLIENT_ID not set", { status: 500 });
  }

  // Pass origin in state so callback can redirect back to the app
  const { searchParams } = new URL(request.url);
  const origin = searchParams.get("origin") || "";

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/userinfo.email",
    access_type: "offline",
    prompt: "consent",
    state: origin,
  });

  return Response.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + params.toString());
}
