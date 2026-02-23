import { ENV_ADMIN_KEY } from "@/lib/env";

export function requireAdminKey(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "";
  const expected = ENV_ADMIN_KEY;

  if (!expected) {
    throw new Error("ADMIN_KEY missing in env");
  }
  if (key !== expected) {
    const err = new Error("Unauthorized") as Error & { status?: number };
    err.status = 401;
    throw err;
  }

  return { key };
}
