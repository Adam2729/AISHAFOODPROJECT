import ReconciliationDriverClient from "./ReconciliationDriverClient";

type SearchParams = Record<string, string | string[] | undefined>;

function pickSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export default async function ReconciliationDriverPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const adminKey = pickSingle(params.key).trim();
  const cityId = pickSingle(params.cityId).trim();
  const weekKey = pickSingle(params.weekKey).trim();
  const driverId = pickSingle(params.driverId).trim();

  if (!adminKey || !cityId || !weekKey || !driverId) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Driver Reconciliation</h1>
        <p className="mt-2 text-sm text-red-600">Missing key, cityId, weekKey, or driverId.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Driver Reconciliation</h1>
        <p className="text-sm text-slate-600">
          Driver cash delta (delivery fees vs payouts) for selected week.
        </p>
      </div>
      <ReconciliationDriverClient
        adminKey={adminKey}
        cityId={cityId}
        weekKey={weekKey}
        driverId={driverId}
      />
    </main>
  );
}

