import Link from "next/link";
import { getAdminPageContext, pickAdminSearchParam } from "@/lib/adminPageContext";
import DriverLedgerDetailClient from "./DriverLedgerDetailClient";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function BamakoDriverDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ driverId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { driverId } = await params;
  const query = await searchParams;
  const { hasAdminSession, transitionalAdminKey } = await getAdminPageContext(query);
  const key = transitionalAdminKey;
  const cityId = pickAdminSearchParam(query.cityId).trim();
  const weekKey = pickAdminSearchParam(query.weekKey).trim();

  if (!hasAdminSession && !key) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Driver Detail</h1>
        <p className="mt-2 text-sm text-red-600">
          Bamako driver ops requires a secure browser session.
        </p>
        <Link
          href="/admin/access?next=/admin/bamako/drivers"
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
          <h1 className="text-2xl font-bold">Driver Detail</h1>
          <p className="text-sm text-slate-600">Driver ID: {driverId}</p>
        </div>
        <Link
          href={`/admin/bamako/drivers${
            cityId || weekKey
              ? `?${new URLSearchParams({
                  ...(cityId ? { cityId } : {}),
                  ...(weekKey ? { weekKey } : {}),
                }).toString()}`
              : ""
          }`}
          className="rounded border px-3 py-2 text-sm"
        >
          Back to Drivers
        </Link>
      </div>
      <DriverLedgerDetailClient
        adminKey={key}
        driverId={driverId}
        initialCityId={cityId}
        initialWeekKey={weekKey}
      />
    </main>
  );
}
