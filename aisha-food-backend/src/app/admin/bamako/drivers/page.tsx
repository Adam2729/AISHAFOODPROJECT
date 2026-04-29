import Link from "next/link";
import { getAdminPageContext } from "@/lib/adminPageContext";
import DriversLedgerClient from "./DriversLedgerClient";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function BamakoDriversPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { hasAdminSession, transitionalAdminKey } = await getAdminPageContext(params);
  const key = transitionalAdminKey;

  if (!hasAdminSession && !key) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Bamako Drivers</h1>
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
          <h1 className="text-2xl font-bold">Bamako Driver Ops</h1>
          <p className="text-sm text-slate-600">Pendings, paid this week, and cash ledger snapshot per rider.</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/admin/bamako/payout-batches`} className="rounded border px-3 py-2 text-sm">
            Payout Batches
          </Link>
          <Link href={`/admin/ops`} className="rounded border px-3 py-2 text-sm">
            Ops Center
          </Link>
        </div>
      </div>
      <DriversLedgerClient adminKey={key} />
    </main>
  );
}
