import Link from "next/link";
import { getWeekKey } from "@/lib/geo";
import { getAdminPageContext, pickAdminSearchParam } from "@/lib/adminPageContext";
import CityWeekClient from "./CityWeekClient";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OpsCityAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ cityId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { cityId } = await params;
  const query = await searchParams;
  const { hasAdminSession, transitionalAdminKey } = await getAdminPageContext(query);
  const adminKey = transitionalAdminKey;
  const initialWeekKey = pickAdminSearchParam(query.weekKey).trim() || getWeekKey(new Date());

  if (!hasAdminSession && !adminKey) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Ops City Analytics</h1>
        <p className="mt-2 text-sm text-red-600">
          City analytics requires a secure browser session.
        </p>
        <Link
          href="/admin/access?next=/ops/analytics"
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">City Week Analytics</h1>
          <p className="text-sm text-slate-600">
            City: {cityId} | Week: {initialWeekKey}
          </p>
        </div>
        <Link
          href={`/ops/analytics?weekKey=${encodeURIComponent(
            initialWeekKey
          )}`}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          Back to By-City view
        </Link>
      </div>

      <CityWeekClient adminKey={adminKey} cityId={cityId} initialWeekKey={initialWeekKey} />
    </main>
  );
}
