/**
 * GET /api/gmail-auth
 *
 * One-time setup: visit this URL in your browser to authorize Gmail access.
 * After consenting, Google redirects to /api/gmail-callback with a code,
 * which gets exchanged for a refresh token you save in your .env.
 */

export async function GET() {
  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/gmail-callback";

  if (!CLIENT_ID) {
    return new Response("GOOGLE_CLIENT_ID not set", { status: 500 });
  }

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/gmail.compose",
    access_type: "offline",
    prompt: "consent",
  });

  return Response.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + params.toString());
}
