"use client";

import { useEffect, useMemo, useState } from "react";
import { getWeekKey } from "@/lib/geo";

type PendingRow = {
  payoutId: string;
  orderId: string;
  orderNumber: string;
  businessName: string;
  amount: number;
  deliveryFeeCharged: number;
  platformMargin: number;
  createdAt?: string | Date | null;
};

type PendingResponse = {
  ok?: boolean;
  city?: { cityId?: string; code?: string; name?: string; currency?: string };
  weekKey?: string;
  totals?: { pendingCount?: number; pendingAmount?: number };
  rows?: PendingRow[];
  error?: { message?: string } | string;
};

type PaidRow = {
  payoutId: string;
  orderId: string;
  orderNumber: string;
  businessName: string;
  amount: number;
  deliveryFeeCharged: number;
  platformMargin: number;
  status?: string;
  createdAt?: string | Date | null;
  paidAt?: string | Date | null;
};

type PaidResponse = {
  ok?: boolean;
  city?: { currency?: string };
  rows?: PaidRow[];
  error?: { message?: string } | string;
};

type SummaryResponse = {
  ok?: boolean;
  city?: { currency?: string };
  weekKey?: string;
  pendingCount?: number;
  pendingAmount?: number;
  paidCount?: number;
  paidAmount?: number;
  lifetimePaidAmount?: number;
  error?: { message?: string } | string;
};

type PreviewResponse = {
  ok?: boolean;
  netSettlement?: number;
  error?: { message?: string } | string;
};

type IncentiveRow = {
  incentiveId: string;
  ruleName: string;
  rewardAmount: number;
  periodKey: string;
  status: "earned" | "paid";
  createdAt?: string | Date | null;
};

type IncentivesResponse = {
  ok?: boolean;
  earned?: IncentiveRow[];
  totals?: {
    earnedTotal?: number;
    paidTotal?: number;
  };
  error?: { message?: string } | string;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

function money(value: unknown, currency?: string) {
  const num = Number(value || 0);
  const formatted = num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return currency ? `${formatted} ${currency}` : formatted;
}

function formatDate(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function getRewardWeekKey(periodKey: string) {
  if (/^\d{4}-W\d{2}$/.test(periodKey)) return periodKey;
  if (/^\d{4}-\d{2}-\d{2}$/.test(periodKey)) {
    return getWeekKey(new Date(`${periodKey}T00:00:00.000Z`));
  }
  return "unknown";
}

export default function DriverEarningsClient({
  cityId,
  initialWeekKey,
}: {
  cityId: string;
  initialWeekKey: string;
}) {
  const [weekKey, setWeekKey] = useState(initialWeekKey);
  const [pending, setPending] = useState<PendingResponse | null>(null);
  const [paid, setPaid] = useState<PaidResponse | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [incentives, setIncentives] = useState<IncentivesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const baseParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("cityId", cityId);
    params.set("weekKey", weekKey);
    return params.toString();
  }, [cityId, weekKey]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [summaryRes, pendingRes, paidRes, previewRes, incentivesRes] = await Promise.all([
        fetch(`/api/driver/earnings/summary?${baseParams}`, { cache: "no-store" }),
        fetch(`/api/driver/payouts/pending?${baseParams}`, { cache: "no-store" }),
        fetch(`/api/driver/payouts/paid?cityId=${encodeURIComponent(cityId)}`, {
          cache: "no-store",
        }),
        fetch(`/api/driver/reconciliation/preview?${baseParams}`, { cache: "no-store" }),
        fetch(`/api/driver/incentives?cityId=${encodeURIComponent(cityId)}&period=all`, {
          cache: "no-store",
        }),
      ]);

      const summaryJson = (await summaryRes.json().catch(() => null)) as SummaryResponse | null;
      const pendingJson = (await pendingRes.json().catch(() => null)) as PendingResponse | null;
      const paidJson = (await paidRes.json().catch(() => null)) as PaidResponse | null;
      const previewJson = (await previewRes.json().catch(() => null)) as PreviewResponse | null;
      const incentivesJson = (await incentivesRes.json().catch(() => null)) as IncentivesResponse | null;

      if (!summaryRes.ok || !summaryJson?.ok) {
        throw new Error(pickError(summaryJson?.error, "Could not load summary."));
      }
      if (!pendingRes.ok || !pendingJson?.ok) {
        throw new Error(pickError(pendingJson?.error, "Could not load pending payouts."));
      }
      if (!paidRes.ok || !paidJson?.ok) {
        throw new Error(pickError(paidJson?.error, "Could not load paid payouts."));
      }
      if (!previewRes.ok || !previewJson?.ok) {
        throw new Error(pickError(previewJson?.error, "Could not load reconciliation preview."));
      }
      if (!incentivesRes.ok || !incentivesJson?.ok) {
        throw new Error(pickError(incentivesJson?.error, "Could not load incentives."));
      }

      setSummary(summaryJson);
      setPending(pendingJson);
      setPaid(paidJson);
      setPreview(previewJson);
      setIncentives(incentivesJson);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not load earnings data."
      );
      setSummary(null);
      setPending(null);
      setPaid(null);
      setPreview(null);
      setIncentives(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseParams, cityId]);

  const currency =
    summary?.city?.currency || pending?.city?.currency || paid?.city?.currency || "";
  const incentiveRows = useMemo(() => incentives?.earned || [], [incentives]);
  const weeklyRewards = useMemo(() => {
    const buckets = new Map<
      string,
      { weekKey: string; total: number; paidTotal: number; count: number }
    >();

    for (const row of incentiveRows) {
      const weekBucket = getRewardWeekKey(String(row.periodKey || ""));
      const current = buckets.get(weekBucket) || {
        weekKey: weekBucket,
        total: 0,
        paidTotal: 0,
        count: 0,
      };
      current.total += Number(row.rewardAmount || 0);
      if (row.status === "paid") {
        current.paidTotal += Number(row.rewardAmount || 0);
      }
      current.count += 1;
      buckets.set(weekBucket, current);
    }

    return Array.from(buckets.values()).sort((a, b) => b.weekKey.localeCompare(a.weekKey));
  }, [incentiveRows]);

  return (
    <section className="mx-auto mt-4 max-w-5xl space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Week key</span>
            <input
              value={weekKey}
              onChange={(event) => setWeekKey(event.target.value)}
              placeholder="YYYY-Www"
              className="w-full rounded border border-slate-300 px-3 py-2"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
            <a
              href={`/api/driver/payouts/pending/export.csv?${baseParams}`}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            >
              Export pending CSV
            </a>
            <a
              href={`/api/driver/reconciliation/export.csv?${baseParams}`}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            >
              Export reconciliation CSV
            </a>
          </div>
        </div>
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card
          label="Pending"
          value={money(summary?.pendingAmount, currency)}
          hint={`${summary?.pendingCount || 0} payouts`}
        />
        <Card
          label="Paid"
          value={money(summary?.paidAmount, currency)}
          hint={`${summary?.paidCount || 0} payouts`}
        />
        <Card
          label="Incentives earned"
          value={money(incentives?.totals?.earnedTotal, currency)}
          hint={`${incentiveRows.length} reward rows`}
        />
        <Card
          label="Net settlement"
          value={money(preview?.netSettlement, currency)}
          hint={`Week ${weekKey}`}
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Weekly rewards summary</h2>
            <p className="text-sm text-slate-500">
              Incentive rewards grouped by week, including already paid bonuses.
            </p>
          </div>
          <p className="text-sm text-slate-500">
            Paid incentives: {money(incentives?.totals?.paidTotal, currency)}
          </p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th className="border-b py-2">Week</th>
                <th className="border-b py-2">Rewards</th>
                <th className="border-b py-2">Paid</th>
                <th className="border-b py-2">Rows</th>
              </tr>
            </thead>
            <tbody>
              {weeklyRewards.map((row) => (
                <tr key={row.weekKey} className="border-b last:border-b-0">
                  <td className="py-2">{row.weekKey}</td>
                  <td className="py-2">{money(row.total, currency)}</td>
                  <td className="py-2">{money(row.paidTotal, currency)}</td>
                  <td className="py-2">{row.count}</td>
                </tr>
              ))}
              {!weeklyRewards.length ? (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-slate-500">
                    No incentive rewards yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold">Incentive ledger</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th className="border-b py-2">Rule</th>
                <th className="border-b py-2">Period</th>
                <th className="border-b py-2">Reward</th>
                <th className="border-b py-2">Status</th>
                <th className="border-b py-2">Earned at</th>
              </tr>
            </thead>
            <tbody>
              {incentiveRows.map((row) => (
                <tr key={row.incentiveId} className="border-b last:border-b-0">
                  <td className="py-2">{row.ruleName}</td>
                  <td className="py-2">{row.periodKey || "-"}</td>
                  <td className="py-2">{money(row.rewardAmount, currency)}</td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${
                        row.status === "paid"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="py-2">{formatDate(row.createdAt)}</td>
                </tr>
              ))}
              {!incentiveRows.length ? (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-slate-500">
                    No incentives have been earned yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold">Pending payouts</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th className="border-b py-2">Order</th>
                <th className="border-b py-2">Business</th>
                <th className="border-b py-2">Amount</th>
                <th className="border-b py-2">Delivery fee</th>
                <th className="border-b py-2">Platform margin</th>
                <th className="border-b py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {(pending?.rows || []).map((row) => (
                <tr key={row.payoutId} className="border-b last:border-b-0">
                  <td className="py-2">#{row.orderNumber}</td>
                  <td className="py-2">{row.businessName}</td>
                  <td className="py-2">{money(row.amount, currency)}</td>
                  <td className="py-2">{money(row.deliveryFeeCharged, currency)}</td>
                  <td className="py-2">{money(row.platformMargin, currency)}</td>
                  <td className="py-2">{formatDate(row.createdAt)}</td>
                </tr>
              ))}
              {!pending?.rows?.length ? (
                <tr>
                  <td colSpan={6} className="py-3 text-center text-slate-500">
                    No pending payouts for this week.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold">Recent paid payouts</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th className="border-b py-2">Order</th>
                <th className="border-b py-2">Business</th>
                <th className="border-b py-2">Amount</th>
                <th className="border-b py-2">Paid at</th>
              </tr>
            </thead>
            <tbody>
              {(paid?.rows || []).map((row) => (
                <tr key={row.payoutId} className="border-b last:border-b-0">
                  <td className="py-2">#{row.orderNumber}</td>
                  <td className="py-2">{row.businessName}</td>
                  <td className="py-2">{money(row.amount, currency)}</td>
                  <td className="py-2">{formatDate(row.paidAt)}</td>
                </tr>
              ))}
              {!paid?.rows?.length ? (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-slate-500">
                    No paid payouts yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold text-slate-900">{value}</p>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
