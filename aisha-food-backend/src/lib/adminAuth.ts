import { ENV_ADMIN_KEY, ENV_NODE_ENV } from "@/lib/env";
import { getAdminSessionFromRequest } from "@/lib/adminSession";

export function requireAdminKey(req: Request) {
  const headerKey = String(req.headers.get("x-admin-key") || "").trim();
  const expected = ENV_ADMIN_KEY;

  if (!expected) {
    throw new Error("ADMIN_KEY missing in env");
  }

  if (headerKey && headerKey === expected) {
    return { mode: "header" as const };
  }

  const session = getAdminSessionFromRequest(req);
  if (session) {
    return { mode: "session" as const };
  }

  // Keep query-string support only for local/dev smoke tooling. Production-facing flows
  // must use the secure admin session cookie or the x-admin-key header.
  const queryKey = String(new URL(req.url).searchParams.get("key") || "").trim();
  if (ENV_NODE_ENV !== "production" && queryKey && queryKey === expected) {
    return { mode: "query-dev" as const };
  }

  const err = new Error("Unauthorized") as Error & { status?: number; code?: string };
  err.status = 401;
  err.code = "UNAUTHORIZED";
  throw err;
}
