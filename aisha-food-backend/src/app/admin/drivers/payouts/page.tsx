import { getWeekKey } from "@/lib/geo";
import { getAdminPageContext, pickAdminSearchParam } from "@/lib/adminPageContext";
import DriverPayoutsDashboardClient from "./DriverPayoutsDashboardClient";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function DriverPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { hasAdminSession, transitionalAdminKey } = await getAdminPageContext(params);
  const adminKey = transitionalAdminKey;
  const initialCityId = pickAdminSearchParam(params.cityId).trim();
  const initialWeekKey = pickAdminSearchParam(params.weekKey).trim() || getWeekKey(new Date());
  const initialStatus =
    pickAdminSearchParam(params.status).trim().toLowerCase() === "paid" ? "paid" : "pending";

  if (!hasAdminSession && !adminKey) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Driver Payouts</h1>
        <p className="mt-2 text-sm text-red-600">
          Driver payout access requires a secure browser session.
        </p>
        <a
          href="/admin/access?next=/admin/drivers/payouts"
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
        <h1 className="text-2xl font-bold">Driver Payouts</h1>
        <p className="text-sm text-slate-600">
          City/week payout operations for Ops (WhatsApp-first dispatch flow).
        </p>
      </div>

      <DriverPayoutsDashboardClient
        adminKey={adminKey}
        initialCityId={initialCityId}
        initialWeekKey={initialWeekKey}
        initialStatus={initialStatus}
      />
    </main>
  );
}
