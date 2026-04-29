"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type CityRow = {
  _id: string;
  code?: string;
  name?: string;
};

type CityWeekRow = {
  driverId: string | null;
  pendingCount: number;
  pendingNetSettlement: number;
  paidCount: number;
  paidNetSettlement: number;
  totalNetSettlement: number;
};

type CityWeekResponse = {
  ok?: boolean;
  cityId?: string;
  cityCode?: string;
  weekKey?: string;
  drivers?: CityWeekRow[];
  error?: { message?: string } | string;
};

type CitiesResponse = {
  ok?: boolean;
  cities?: CityRow[];
  error?: { message?: string } | string;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

function money(value: unknown) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export default function ReconciliationDashboardClient({
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
  const [rows, setRows] = useState<CityWeekRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadCities() {
    const res = await fetch(`/api/admin/cities`, {
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as CitiesResponse | null;
    if (!res.ok || !json?.ok) {
      throw new Error(pickError(json?.error, "Could not load cities."));
    }
    const list = Array.isArray(json.cities) ? json.cities : [];
    setCities(list);
    if (!cityId && list.length) {
      const preferred =
        list.find((row) => String(row.code || "").toUpperCase() === "BKO") || list[0];
      setCityId(String(preferred._id || ""));
    }
  }

  async function loadRows() {
    if (!cityId || !weekKey) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        key: adminKey,
        cityId,
        weekKey,
      });
      const res = await fetch(`/api/ops/driver-reconciliation/city-week?${params.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as CityWeekResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not load reconciliation data."));
      }
      setRows(Array.isArray(json.drivers) ? json.drivers : []);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not load reconciliation data."
      );
      setRows([]);
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
    loadRows();
  }, [cityId, weekKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    let pendingNet = 0;
    let paidNet = 0;
    for (const row of rows) {
      pendingNet += Number(row.pendingNetSettlement || 0);
      paidNet += Number(row.paidNetSettlement || 0);
    }
    return {
      pendingNet,
      paidNet,
      totalNet: pendingNet + paidNet,
    };
  }, [rows]);

  return (
    <section className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">City</span>
            <select
              value={cityId}
              onChange={(event) => setCityId(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2"
            >
              {cities.map((city) => (
                <option key={city._id} value={city._id}>
                  {String(city.name || "City")} ({String(city.code || "").toUpperCase()})
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
          <div className="flex items-end">
            <button
              type="button"
              onClick={loadRows}
              disabled={loading || !cityId}
              className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Total net (all drivers)" value={money(totals.totalNet)} />
        <MetricCard label="Pending net" value={money(totals.pendingNet)} />
        <MetricCard label="Paid net" value={money(totals.paidNet)} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th className="border-b py-2">Driver</th>
                <th className="border-b py-2">Pending (count / net)</th>
                <th className="border-b py-2">Paid (count / net)</th>
                <th className="border-b py-2">Total Net</th>
                <th className="border-b py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.driverId || `unassigned-${row.totalNetSettlement}`} className="border-b last:border-b-0">
                  <td className="py-2">
                    <div className="font-medium">{row.driverId || "Unassigned"}</div>
                  </td>
                  <td className="py-2">
                    {row.pendingCount} / {money(row.pendingNetSettlement)}
                  </td>
                  <td className="py-2">
                    {row.paidCount} / {money(row.paidNetSettlement)}
                  </td>
                  <td className="py-2 font-semibold">{money(row.totalNetSettlement)}</td>
                  <td className="py-2">
                    {row.driverId ? (
                      <Link
                        href={`/ops/reconciliation/driver?cityId=${encodeURIComponent(cityId)}&weekKey=${encodeURIComponent(
                          weekKey
                        )}&driverId=${encodeURIComponent(row.driverId)}`}
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                      >
                        View driver
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-500">No driverId</span>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-slate-500">
                    No payouts found for this week/city.
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

