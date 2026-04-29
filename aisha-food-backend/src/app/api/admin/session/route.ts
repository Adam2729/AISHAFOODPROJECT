import { NextResponse } from "next/server";
import { ok, fail } from "@/lib/apiResponse";
import { createAdminSessionToken, clearAdminSessionCookie, getAdminSessionFromRequest, setAdminSessionCookie } from "@/lib/adminSession";
import { ENV_ADMIN_KEY } from "@/lib/env";

export async function GET(req: Request) {
  const session = getAdminSessionFromRequest(req);
  return ok({
    authenticated: Boolean(session),
    mode: session ? "session" : "none",
  });
}

export async function POST(req: Request) {
  try {
    const providedKey = String(req.headers.get("x-admin-key") || "").trim();

    if (!providedKey || providedKey !== ENV_ADMIN_KEY) {
      return fail("UNAUTHORIZED", "Invalid admin access key.", 401);
    }

    const maxAgeSec = 12 * 60 * 60;
    const token = createAdminSessionToken(12);
    const response = ok({
      authenticated: true,
      mode: "session",
      expiresAt: new Date(Date.now() + maxAgeSec * 1000).toISOString(),
    }) as NextResponse;
    setAdminSessionCookie(response, token, maxAgeSec);
    return response;
  } catch {
    return fail("SERVER_ERROR", "Could not start admin session.", 500);
  }
}

export async function DELETE() {
  const response = ok({
    authenticated: false,
    mode: "none",
  }) as NextResponse;
  clearAdminSessionCookie(response);
  return response;
}
