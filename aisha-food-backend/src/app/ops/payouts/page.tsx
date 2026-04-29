import { getWeekKey } from "@/lib/geo";
import { getAdminPageContext, pickAdminSearchParam } from "@/lib/adminPageContext";
import PayoutsDashboardClient from "./PayoutsDashboardClient";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function PayoutsPage({
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
      <main className="mx-auto min-h-screen max-w-6xl p-6">
        <h1 className="text-2xl font-bold">Payout Settlement</h1>
        <p className="mt-2 text-sm text-red-600">
          Ops payout access requires a secure browser session.
        </p>
        <a
          href="/admin/access?next=/ops/payouts"
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Payout Settlement</h1>
        <p className="text-sm text-slate-600">
          Marca pagos en lote y exporta pendientes por semana y ciudad.
        </p>
      </div>
      <PayoutsDashboardClient
        adminKey={adminKey}
        initialCityId={initialCityId}
        initialWeekKey={initialWeekKey}
      />
    </main>
  );
}
