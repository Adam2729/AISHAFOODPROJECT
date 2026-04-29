"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type CityRow = {
  _id: string;
  code?: string;
  slug?: string;
  name?: string;
  isActive?: boolean;
};

type SummaryDriverRow = {
  driverId: string | null;
  driverRef: string;
  pendingCount: number;
  pendingAmount: number;
  paidCount: number;
  paidAmount: number;
  cash?: {
    cashCollectedByRider?: number;
    cashDueToRider?: number;
    cashDueToPlatform?: number;
    netSettlement?: number;
  };
};

type SummaryResponse = {
  ok: boolean;
  cityId?: string;
  cityCode?: string;
  weekKey?: string;
  summary?: {
    drivers?: number;
    pendingCount?: number;
    pendingAmount?: number;
    paidCount?: number;
    paidAmount?: number;
  };
  drivers?: SummaryDriverRow[];
  error?: { message?: string } | string;
};

type CitiesResponse = {
  ok: boolean;
  cities?: CityRow[];
  error?: { message?: string } | string;
};

function money(value: unknown) {
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

export default function DriverOpsDashboardClient({
  adminKey,
  initialCityId,
  initialWeekKey,
}: {
  adminKey: string;
  initialCityId: string;
  initialWeekKey: string;
}) {
  const [cities, setCities] = useState<CityRow[]>([]);
  const [cityId, setCityId] = useState(initialCityId);
  const [weekKey, setWeekKey] = useState(initialWeekKey);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<SummaryResponse | null>(null);

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
      const preferred =
        rows.find((row) => String(row.code || "").toUpperCase() === "BKO") ||
        rows.find((row) => row.isActive !== false) ||
        rows[0];
      setCityId(String(preferred._id || ""));
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
      const res = await fetch(`/api/ops/driver-ops/summary?${params.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as SummaryResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not load driver ops summary."));
      }
      setSummary(json);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not load summary.");
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

  const rows = useMemo(() => {
    const source = Array.isArray(summary?.drivers) ? summary.drivers : [];
    return source.map((row) => {
      const cashCollectedByRider = Number(row.cash?.cashCollectedByRider || 0);
      const cashDueToRider = Number(row.cash?.cashDueToRider || 0);
      const cashDueToPlatform = Number(row.cash?.cashDueToPlatform || 0);
      const netSettlement = Number(row.cash?.netSettlement || cashDueToRider - cashDueToPlatform);
      return {
        ...row,
        pendingCount: Number(row.pendingCount || 0),
        pendingAmount: Number(row.pendingAmount || 0),
        paidCount: Number(row.paidCount || 0),
        paidAmount: Number(row.paidAmount || 0),
        cashCollectedByRider,
        cashDueToRider,
        cashDueToPlatform,
        netSettlement,
      };
    });
  }, [summary?.drivers]);

  const totals = useMemo(() => {
    let cashCollectedByRider = 0;
    let cashDueToRider = 0;
    let cashDueToPlatform = 0;
    for (const row of rows) {
      cashCollectedByRider += Number(row.cashCollectedByRider || 0);
      cashDueToRider += Number(row.cashDueToRider || 0);
      cashDueToPlatform += Number(row.cashDueToPlatform || 0);
    }
    return {
      drivers: Number(summary?.summary?.drivers || rows.length || 0),
      pendingCount: Number(summary?.summary?.pendingCount || 0),
      pendingAmount: Number(summary?.summary?.pendingAmount || 0),
      paidCount: Number(summary?.summary?.paidCount || 0),
      paidAmount: Number(summary?.summary?.paidAmount || 0),
      cashCollectedByRider,
      cashDueToRider,
      cashDueToPlatform,
      netSettlement: cashDueToRider - cashDueToPlatform,
    };
  }, [rows, summary?.summary]);

  return (
    <section className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">City</span>
            <select
              value={cityId}
              onChange={(event) => setCityId(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2"
            >
              {cities.map((city) => (
                <option key={city._id} value={city._id}>
                  {String(city.name || "City")} ({String(city.code || city.slug || "CITY").toUpperCase()})
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Week Key</span>
            <input
              value={weekKey}
              onChange={(event) => setWeekKey(event.target.value)}
              placeholder="YYYY-Www"
              className="w-full rounded border border-slate-300 px-3 py-2"
            />
          </label>

          <div className="md:col-span-2 flex items-end gap-2">
            <button
              type="button"
              onClick={loadSummary}
              disabled={loading || !cityId}
              className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
            <a
              href={`/api/ops/driver-ops/export/city-week.csv?cityId=${encodeURIComponent(cityId)}&weekKey=${encodeURIComponent(weekKey)}`}
              className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold"
            >
              Export city/week CSV
            </a>
          </div>
        </div>
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Drivers" value={String(totals.drivers)} />
        <MetricCard label="Pending Count" value={String(totals.pendingCount)} />
        <MetricCard label="Pending Amount" value={money(totals.pendingAmount)} />
        <MetricCard label="Paid Count" value={String(totals.paidCount)} />
        <MetricCard label="Paid Amount" value={money(totals.paidAmount)} />
        <MetricCard label="Cash Collected By Riders" value={money(totals.cashCollectedByRider)} />
        <MetricCard label="Cash Due To Riders" value={money(totals.cashDueToRider)} />
        <MetricCard label="Cash Due To Platform" value={money(totals.cashDueToPlatform)} />
        <MetricCard label="Net Settlement" value={money(totals.netSettlement)} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th className="border-b py-2">Driver</th>
                <th className="border-b py-2">Pending</th>
                <th className="border-b py-2">Pending Amount</th>
                <th className="border-b py-2">Paid</th>
                <th className="border-b py-2">Paid Amount</th>
                <th className="border-b py-2">Collected</th>
                <th className="border-b py-2">Due Rider</th>
                <th className="border-b py-2">Due Platform</th>
                <th className="border-b py-2">Net</th>
                <th className="border-b py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const driverId = row.driverId ? String(row.driverId) : "";
                const driverLabel = String(row.driverRef || "").trim() || driverId || "unassigned";
                return (
                  <tr key={`${driverId || "unassigned"}-${driverLabel}`} className="border-b last:border-b-0">
                    <td className="py-2">
                      <div className="font-medium">{driverLabel}</div>
                      {driverId ? <div className="font-mono text-xs text-slate-500">{driverId}</div> : null}
                    </td>
                    <td className="py-2">{row.pendingCount}</td>
                    <td className="py-2">{money(row.pendingAmount)}</td>
                    <td className="py-2">{row.paidCount}</td>
                    <td className="py-2">{money(row.paidAmount)}</td>
                    <td className="py-2">{money(row.cashCollectedByRider)}</td>
                    <td className="py-2">{money(row.cashDueToRider)}</td>
                    <td className="py-2">{money(row.cashDueToPlatform)}</td>
                    <td className="py-2">{money(row.netSettlement)}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        {driverId ? (
                          <>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(driverId);
                                } catch {
                                  // noop
                                }
                              }}
                              className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                            >
                              Copy ID
                            </button>
                            <Link
                              href={`/ops/driver-ops/${encodeURIComponent(
                                driverId
                              )}?cityId=${encodeURIComponent(
                                cityId
                              )}&weekKey=${encodeURIComponent(weekKey)}`}
                              className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                            >
                              View
                            </Link>
                          </>
                        ) : (
                          <span className="text-xs text-slate-500">No driverId</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!rows.length ? (
                <tr>
                  <td colSpan={10} className="py-3 text-center text-slate-500">
                    No payouts for this week in this city.
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

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </article>
  );
}
