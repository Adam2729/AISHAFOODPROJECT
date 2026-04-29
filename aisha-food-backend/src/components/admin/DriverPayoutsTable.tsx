"use client";

import Link from "next/link";

export type DriverSummaryRow = {
  driverId: string | null;
  driverRef: string;
  pendingCount: number;
  pendingAmount: number;
  paidCount: number;
  paidAmount: number;
  cashCollected: number;
  platformMargin: number;
  cashDueToRider: number;
  netSettlement: number;
};

type DriverPayoutsTableProps = {
  rows: DriverSummaryRow[];
  adminKey: string;
  cityId: string;
  weekKey: string;
  emptyText?: string;
};

function money(value: number) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export default function DriverPayoutsTable({
  rows,
  adminKey,
  cityId,
  weekKey,
  emptyText = "No driver rows found.",
}: DriverPayoutsTableProps) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-slate-600">
            <tr>
              <th className="border-b py-2">Driver</th>
              <th className="border-b py-2">Pending Count</th>
              <th className="border-b py-2">Pending Amount</th>
              <th className="border-b py-2">Cash Collected</th>
              <th className="border-b py-2">Platform Margin</th>
              <th className="border-b py-2">Net Settlement</th>
              <th className="border-b py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const driverLabel = row.driverRef || row.driverId || "unassigned";
              return (
                <tr key={`${row.driverId || "unassigned"}-${row.driverRef}`} className="border-b last:border-b-0">
                  <td className="py-2 font-medium">{driverLabel}</td>
                  <td className="py-2">{Number(row.pendingCount || 0)}</td>
                  <td className="py-2">{money(row.pendingAmount)}</td>
                  <td className="py-2">{money(row.cashCollected)}</td>
                  <td className="py-2">{money(row.platformMargin)}</td>
                  <td className="py-2">{money(row.netSettlement)}</td>
                  <td className="py-2">
                    {row.driverId ? (
                      <Link
                        href={`/admin/drivers/payouts/${encodeURIComponent(
                          row.driverId
                        )}?cityId=${encodeURIComponent(
                          cityId
                        )}&weekKey=${encodeURIComponent(weekKey)}`}
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                      >
                        View driver
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-500">No driverId</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length ? (
              <tr>
                <td colSpan={7} className="py-3 text-center text-slate-500">
                  {emptyText}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

