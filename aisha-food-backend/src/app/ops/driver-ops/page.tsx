import { getWeekKey } from "@/lib/geo";
import { getAdminPageContext, pickAdminSearchParam } from "@/lib/adminPageContext";
import DriverOpsDashboardClient from "./DriverOpsDashboardClient";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OpsDriverOpsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { hasAdminSession, transitionalAdminKey } = await getAdminPageContext(params);
  const adminKey = transitionalAdminKey;
  const initialCityId = pickAdminSearchParam(params.cityId).trim();
  const initialWeekKey = pickAdminSearchParam(params.weekKey).trim() || getWeekKey(new Date());

  if (!hasAdminSession && !adminKey) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Ops Driver Ops</h1>
        <p className="mt-2 text-sm text-red-600">
          Ops driver tools require a secure browser session.
        </p>
        <a
          href="/admin/access?next=/ops/driver-ops"
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Ops Driver Ops</h1>
        <p className="text-sm text-slate-600">
          City-scoped rider payout monitoring (WhatsApp-first dispatch).
        </p>
      </div>

      <DriverOpsDashboardClient
        adminKey={adminKey}
        initialCityId={initialCityId}
        initialWeekKey={initialWeekKey}
      />
    </main>
  );
}
