import { headers } from "next/headers";
import { ENV_NODE_ENV } from "@/lib/env";
import { getAdminSessionFromCookieHeader } from "@/lib/adminSession";

export type AdminPageSearchParams = Record<string, string | string[] | undefined>;

export function pickAdminSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export async function getAdminPageContext(searchParams?: AdminPageSearchParams) {
  const hdrs = await headers();
  const rawCookie = String(hdrs.get("cookie") || "");
  const headerAdminKey = String(hdrs.get("x-admin-key") || "").trim();
  const devQueryKey =
    ENV_NODE_ENV !== "production" ? pickAdminSearchParam(searchParams?.key).trim() : "";
  const transitionalAdminKey = headerAdminKey || devQueryKey;
  const hasAdminSession = Boolean(getAdminSessionFromCookieHeader(rawCookie));

  const host = hdrs.get("x-forwarded-host") || hdrs.get("host") || "localhost:3000";
  const forwardedProto = hdrs.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol =
    forwardedProto || (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");

  const adminRequestHeaders: HeadersInit = headerAdminKey
    ? { "x-admin-key": headerAdminKey }
    : rawCookie
    ? { cookie: rawCookie }
    : {};

  return {
    hdrs,
    rawCookie,
    headerAdminKey,
    devQueryKey,
    transitionalAdminKey,
    hasAdminSession,
    adminRequestHeaders,
    baseUrl: `${protocol}://${host}`,
  };
}
