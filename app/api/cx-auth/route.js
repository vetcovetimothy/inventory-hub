/**
 * POST /api/cx-auth
 *
 * Validates CX login credentials against environment variables.
 * Body: { username: string, password: string }
 */

export async function POST(request) {
  try {
    const body = await request.json();
    const { username, password } = body;

    const validUser = process.env.CX_USERNAME;
    const validPass = process.env.CX_PASSWORD;

    if (!validUser || !validPass) {
      return Response.json({ error: "CX login not configured" }, { status: 500 });
    }

    if (username === validUser && password === validPass) {
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Invalid username or password" }, { status: 401 });
  } catch (err) {
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
