import { getWeekKey } from "@/lib/geo";
import { getAdminPageContext, pickAdminSearchParam } from "@/lib/adminPageContext";
import AnalyticsByCityClient from "./AnalyticsByCityClient";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OpsAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { hasAdminSession, transitionalAdminKey } = await getAdminPageContext(params);
  const adminKey = transitionalAdminKey;
  const initialWeekKey = pickAdminSearchParam(params.weekKey).trim() || getWeekKey(new Date());

  if (!hasAdminSession && !adminKey) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Ops Analytics</h1>
        <p className="mt-2 text-sm text-red-600">
          Ops analytics requires a secure browser session.
        </p>
        <a
          href="/admin/access?next=/ops/analytics"
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Ops Analytics</h1>
          <p className="text-sm text-slate-600">
            KPIs by city and week. Click a city to drill into its week snapshot.
          </p>
        </div>
      </div>

      <AnalyticsByCityClient adminKey={adminKey} initialWeekKey={initialWeekKey} />
    </main>
  );
}
