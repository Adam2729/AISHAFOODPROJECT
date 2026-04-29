"use client";

import { useEffect, useMemo, useState } from "react";
import DriverPayoutsFilters from "@/components/admin/DriverPayoutsFilters";
import DriverPayoutsTable, { type DriverSummaryRow } from "@/components/admin/DriverPayoutsTable";

type CityRow = {
  _id: string;
  code?: string;
  slug?: string;
  name?: string;
};

type CitiesResponse = {
  ok: boolean;
  cities?: CityRow[];
  error?: { message?: string } | string;
};

type SummaryResponse = {
  ok: boolean;
  cityId?: string;
  weekKey?: string;
  totals?: {
    pendingCount?: number;
    pendingAmount?: number;
    paidCount?: number;
    paidAmount?: number;
    cashCollectedByRiders?: number;
    platformMarginTotal?: number;
    cashDueToRiders?: number;
    netSettlementTotal?: number;
  };
  drivers?: DriverSummaryRow[];
  error?: { message?: string } | string;
};

type InvariantsResponse = {
  ok: boolean;
  violationsCount?: number;
  violations?: Array<{ payoutId?: string; reason?: string; details?: unknown }>;
  error?: { message?: string } | string;
};

function money(value: number) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

export default function DriverPayoutsDashboardClient({
  adminKey,
  initialCityId,
  initialWeekKey,
  initialStatus,
}: {
  adminKey: string;
  initialCityId: string;
  initialWeekKey: string;
  initialStatus: "pending" | "paid";
}) {
  const [cities, setCities] = useState<CityRow[]>([]);
  const [cityId, setCityId] = useState(initialCityId);
  const [weekKey, setWeekKey] = useState(initialWeekKey);
  const [status, setStatus] = useState<"pending" | "paid">(initialStatus);
  const [driverQuery, setDriverQuery] = useState("");
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [invariantResult, setInvariantResult] = useState<{
    count: number;
    topMessages: string[];
  } | null>(null);
  const [invariantLoading, setInvariantLoading] = useState(false);
  const [invariantError, setInvariantError] = useState("");

  async function loadCities() {
    const res = await fetch(`/api/admin/cities`, {
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as CitiesResponse | null;
    if (!res.ok || !json?.ok) {
      throw new Error(pickError(json?.error, "Could not load cities."));
    }
    const rows = Array.isArray(json.cities) ? json.cities : [];
    setCities(rows);
    if (!cityId && rows.length) {
      setCityId(String(rows[0]._id));
    }
  }

  async function loadSummary() {
    if (!cityId || !weekKey) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        key: adminKey,
        cityId,
        weekKey,
      });
      const res = await fetch(`/api/admin/driver-payouts/summary?${params.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as SummaryResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not load payout summary."));
      }
      setSummary(json);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not load payout summary.");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCities().catch((requestError: unknown) => {
      setError(requestError instanceof Error ? requestError.message : "Could not load cities.");
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!cityId || !weekKey) return;
    loadSummary();
  }, [cityId, weekKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredRows = useMemo(() => {
    const rows = Array.isArray(summary?.drivers) ? summary.drivers : [];
    const trimmedQuery = String(driverQuery || "").trim().toLowerCase();
    return rows
      .filter((row) => {
        if (status === "pending" && Number(row.pendingCount || 0) <= 0) return false;
        if (status === "paid" && Number(row.paidCount || 0) <= 0) return false;
        if (!trimmedQuery) return true;
        const haystack = `${String(row.driverId || "")} ${String(row.driverRef || "")}`.toLowerCase();
        return haystack.includes(trimmedQuery);
      })
      .map((row) => ({
        ...row,
        pendingAmount: Number(row.pendingAmount || 0),
        paidAmount: Number(row.paidAmount || 0),
      }));
  }, [summary?.drivers, status, driverQuery]);

  async function runInvariants() {
    if (!cityId) return;
    setInvariantLoading(true);
    setInvariantError("");
    try {
      const params = new URLSearchParams({
        key: adminKey,
        cityId,
        limit: "500",
      });
      const res = await fetch(`/api/admin/rider-payouts/invariants?${params.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as InvariantsResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not run invariants."));
      }
      const violations = Array.isArray(json.violations) ? json.violations : [];
      const topMessages = violations.slice(0, 5).map((row) => {
        const reason = String(row.reason || "UNKNOWN");
        const payoutId = String(row.payoutId || "");
        return payoutId ? `${reason} (${payoutId})` : reason;
      });
      setInvariantResult({
        count: Number(json.violationsCount || 0),
        topMessages,
      });
    } catch (requestError: unknown) {
      setInvariantError(requestError instanceof Error ? requestError.message : "Could not run invariants.");
      setInvariantResult(null);
    } finally {
      setInvariantLoading(false);
    }
  }

  const totals = summary?.totals || {};

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <DriverPayoutsFilters
          cityId={cityId}
          weekKey={weekKey}
          status={status}
          driverQuery={driverQuery}
          cities={cities}
          loading={loading}
          onChangeCityId={setCityId}
          onChangeWeekKey={setWeekKey}
          onChangeStatus={setStatus}
          onChangeDriverQuery={setDriverQuery}
          onRefresh={loadSummary}
        />

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Pending Count" value={String(Number(totals.pendingCount || 0))} />
          <MetricCard label="Pending Amount" value={money(Number(totals.pendingAmount || 0))} />
          <MetricCard label="Paid Count" value={String(Number(totals.paidCount || 0))} />
          <MetricCard label="Paid Amount" value={money(Number(totals.paidAmount || 0))} />
          <MetricCard
            label="Cash Collected By Riders"
            value={money(Number(totals.cashCollectedByRiders || 0))}
          />
          <MetricCard
            label="Platform Margin Total"
            value={money(Number(totals.platformMarginTotal || 0))}
          />
          <MetricCard label="Cash Due To Riders" value={money(Number(totals.cashDueToRiders || 0))} />
          <MetricCard
            label="Net Settlement Total"
            value={money(Number(totals.netSettlementTotal || 0))}
          />
        </section>

        <DriverPayoutsTable
          rows={filteredRows}
          adminKey={adminKey}
          cityId={cityId}
          weekKey={weekKey}
          emptyText="No driver rows for this filter."
        />
      </div>

      <aside className="space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-lg font-semibold">Ops Tools</h2>
          <button
            type="button"
            onClick={runInvariants}
            disabled={invariantLoading || !cityId}
            className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {invariantLoading ? "Running..." : "Run invariants check"}
          </button>
          {invariantError ? <p className="mt-2 text-sm text-red-600">{invariantError}</p> : null}
          {invariantResult ? (
            <div className="mt-3 rounded border border-slate-200 p-3 text-sm">
              <p className="font-semibold">Violations: {invariantResult.count}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
                {invariantResult.topMessages.length ? (
                  invariantResult.topMessages.map((line) => <li key={line}>{line}</li>)
                ) : (
                  <li>No issues in first sample.</li>
                )}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold">Exports</h3>
          <a
            href={`/api/admin/driver-payouts/export/city-week?cityId=${encodeURIComponent(cityId)}&weekKey=${encodeURIComponent(weekKey)}&status=all`}
            className="mt-2 inline-flex w-full justify-center rounded border border-slate-300 px-3 py-2 text-sm font-semibold"
          >
            Export city/week CSV
          </a>
        </section>
      </aside>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </article>
  );
}

