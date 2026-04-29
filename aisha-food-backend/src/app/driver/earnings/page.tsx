import Link from "next/link";
import { getWeekKey } from "@/lib/geo";
import DriverEarningsClient from "./DriverEarningsClient";

type SearchParams = Record<string, string | string[] | undefined>;

function pickSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export default async function DriverEarningsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const cityId = pickSingle(params.cityId).trim();
  const initialWeekKey = pickSingle(params.weekKey).trim() || getWeekKey(new Date());

  if (!cityId) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center p-6">
        <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <h1 className="text-xl font-semibold">Driver Earnings &amp; Incentives</h1>
          <p className="mt-2 text-sm text-red-600">cityId is required to view earnings.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4">
      <div className="mx-auto flex max-w-3xl items-center justify-between">
        <h1 className="text-2xl font-semibold">Driver Earnings &amp; Incentives</h1>
        <Link
          href={`/driver?cityId=${encodeURIComponent(cityId)}`}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm"
        >
          Back to dashboard
        </Link>
      </div>
      <DriverEarningsClient cityId={cityId} initialWeekKey={initialWeekKey} />
    </main>
  );
}
