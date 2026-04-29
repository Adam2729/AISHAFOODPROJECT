import { NextResponse, type NextRequest } from "next/server";
import { driverSessionCookieName } from "@/lib/driverSession";

function getAllowedOrigins() {
  return String(process.env.PUBLIC_API_ALLOWED_ORIGINS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function applySecurityHeaders(response: NextResponse) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  return response;
}

function applyCorsHeaders(response: NextResponse, origin: string) {
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.headers.set("Access-Control-Max-Age", "86400");
  response.headers.set("Vary", "Origin");
  return response;
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const isPublicApi = pathname.startsWith("/api/public/");
  const method = req.method.toUpperCase();
  const origin = req.headers.get("origin") || "";

  if (isPublicApi) {
    const allowedOrigins = getAllowedOrigins();
    const originAllowed = Boolean(origin && allowedOrigins.includes(origin));

    if (method === "OPTIONS") {
      if (!originAllowed) {
        return applySecurityHeaders(
          NextResponse.json(
            {
              ok: false,
              error: {
                code: "CORS_ORIGIN_BLOCKED",
                message: "Origin not allowed.",
                details: null,
              },
            },
            { status: 403 }
          )
        );
      }
      return applySecurityHeaders(applyCorsHeaders(new NextResponse(null, { status: 204 }), origin));
    }

    const response = NextResponse.next();
    if (originAllowed) {
      applyCorsHeaders(response, origin);
    }
    return applySecurityHeaders(response);
  }

  const isDriverApi = pathname.startsWith("/api/driver/");
  if (isDriverApi) {
    const hasSession = Boolean(req.cookies.get(driverSessionCookieName())?.value);
    const authorization = String(req.headers.get("authorization") || "").trim();
    const hasBearerToken = authorization.toLowerCase().startsWith("bearer ");
    const tokenQuery =
      req.nextUrl.searchParams.get("token") || req.nextUrl.searchParams.get("key");
    const allowBypass =
      pathname.startsWith("/api/driver/session/") ||
      pathname === "/api/driver/auth/login" ||
      pathname === "/api/driver/apply";

    if (!allowBypass && !hasSession && !hasBearerToken && !tokenQuery) {
      return applySecurityHeaders(
        NextResponse.json(
          {
            ok: false,
            error: { code: "UNAUTHORIZED", message: "Driver auth required.", details: null },
          },
          { status: 401 }
        )
      );
    }
  }

  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
