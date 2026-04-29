import Link from "next/link";
import { headers } from "next/headers";
import DispatchControlPanelClient from "./DispatchControlPanelClient";
import { getAdminSessionFromCookieHeader } from "@/lib/adminSession";
import { ENV_NODE_ENV } from "@/lib/env";

type SearchParams = Record<string, string | string[] | undefined>;

function pickSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export default async function OpsDispatchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const headerStore = await headers();
  const rawCookie = String(headerStore.get("cookie") || "");
  const headerAdminKey = String(headerStore.get("x-admin-key") || "").trim();
  const devQueryKey =
    ENV_NODE_ENV !== "production" ? pickSingle(params.key).trim() : "";
  const adminKey = headerAdminKey || devQueryKey;
  const hasAdminSession = Boolean(getAdminSessionFromCookieHeader(rawCookie));
  const initialCityId = pickSingle(params.cityId).trim();
  const usedQueryKey = Boolean(devQueryKey);

  if (!adminKey && !hasAdminSession) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Ops Dispatch</h1>
        <p className="mt-2 text-sm text-red-600">
          Ops dispatch requires a secure admin browser session.
        </p>
        <Link
          href="/admin/access?next=/ops/dispatch"
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Ops Dispatch</h1>
        <p className="text-sm text-slate-600">
          City-scoped dispatch control for manual assignment, smart auto-assignment, audit review,
          and WhatsApp copy.
        </p>
        {usedQueryKey ? (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Development fallback in use. Production operators should use the secure admin access
            page instead of raw keyed URLs.
          </p>
        ) : null}
      </div>

      <DispatchControlPanelClient adminKey={adminKey} initialCityId={initialCityId} />
    </main>
  );
}
