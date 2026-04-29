import Link from "next/link";
import { getWeekKey } from "@/lib/geo";
import { getAdminPageContext, pickAdminSearchParam } from "@/lib/adminPageContext";
import DriverOpsDriverClient from "./DriverOpsDriverClient";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OpsDriverOpsDriverPage({
  params,
  searchParams,
}: {
  params: Promise<{ driverId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { driverId } = await params;
  const query = await searchParams;
  const { hasAdminSession, transitionalAdminKey } = await getAdminPageContext(query);
  const adminKey = transitionalAdminKey;
  const cityId = pickAdminSearchParam(query.cityId).trim();
  const weekKey = pickAdminSearchParam(query.weekKey).trim() || getWeekKey(new Date());

  if (!hasAdminSession && !adminKey) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Ops Driver Detail</h1>
        <p className="mt-2 text-sm text-red-600">
          Driver ops detail requires a secure browser session.
        </p>
        <Link
          href="/admin/access?next=/ops/driver-ops"
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
          <h1 className="text-2xl font-bold">Ops Driver Detail</h1>
          <p className="text-sm text-slate-600">Driver ID: {driverId}</p>
        </div>
        <Link
          href={`/ops/driver-ops?cityId=${encodeURIComponent(
            cityId
          )}&weekKey=${encodeURIComponent(weekKey)}`}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          Back to Driver Ops
        </Link>
      </div>

      <DriverOpsDriverClient
        adminKey={adminKey}
        cityId={cityId}
        weekKey={weekKey}
        driverId={driverId}
      />
    </main>
  );
}
