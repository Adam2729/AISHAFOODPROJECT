import Link from "next/link";
import { redirect } from "next/navigation";
import { ENV_NODE_ENV } from "@/lib/env";

type SearchParams = Record<string, string | string[] | undefined>;

function pickSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export default async function DispatchLaunchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const adminKey = pickSingle(params.key).trim();
  const initialCityId = pickSingle(params.cityId).trim();
  const devMode = pickSingle(params.dev).trim() === "1";

  if (ENV_NODE_ENV !== "production" && adminKey && devMode) {
    const next = new URLSearchParams();
    next.set("key", adminKey);
    if (initialCityId) next.set("cityId", initialCityId);
    next.set("legacy", "dispatch-page");
    redirect(`/ops/dispatch?${next.toString()}`);
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl p-6">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-2xl font-bold text-slate-950">Dispatch Access</h1>
        <p className="mt-3 text-sm leading-6 text-slate-700">
          This legacy route is no longer the production entry point. Open dispatch through the
          secure admin session instead of sharing raw keyed URLs.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-700">
          For local development only, you can still use the temporary dev redirect with
          <code> &amp;dev=1</code>.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/ops/dispatch"
            className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
          >
            Open ops dispatch
          </Link>
          <Link
            href="/admin/access?next=/ops/dispatch"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Open secure admin access
          </Link>
        </div>
      </div>
    </main>
  );
}
