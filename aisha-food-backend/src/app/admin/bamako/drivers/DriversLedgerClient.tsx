"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import WeekKeyPicker from "@/components/admin/WeekKeyPicker";

type CityRow = {
  _id: string;
  code?: string;
  slug?: string;
  name?: string;
  isActive?: boolean;
};

type DriverLedgerRow = {
  driverId: string | null;
  driverName: string;
  driverRef: string;
  pendingCount: number;
  pendingAmount: number;
  paidCountWeek: number;
  paidAmountWeek: number;
  cashCollectedByRider: number;
  cashDueToRider: number;
  cashDueToPlatform: number;
  netSettlement: number;
};

type CitiesResponse = {
  ok: boolean;
  cities?: CityRow[];
  error?: { message?: string } | string;
};

type SummaryResponse = {
  ok: boolean;
  city?: { _id: string; name?: string; code?: string; isActive?: boolean };
  weekKey?: string;
  rows?: DriverLedgerRow[];
  error?: { message?: string } | string;
};

function getWeekKey(dateInput = new Date()) {
  const date = new Date(Date.UTC(dateInput.getUTCFullYear(), dateInput.getUTCMonth(), dateInput.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function money(value: number) {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const maybe = error as { message?: string };
    if (maybe.message) return maybe.message;
  }
  return fallback;
}

export default function DriversLedgerClient({ adminKey }: { adminKey: string }) {
  const [cities, setCities] = useState<CityRow[]>([]);
  const [cityId, setCityId] = useState("");
  const [cityActive, setCityActive] = useState(true);
  const [weekKey, setWeekKey] = useState(getWeekKey(new Date()));
  const [rows, setRows] = useState<DriverLedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      const res = await fetch(`/api/admin/cities`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as CitiesResponse | null;
      if (!mounted) return;
      if (!res.ok || !json?.ok) {
        setError(pickError(json?.error, "No se pudieron cargar ciudades."));
        return;
      }
      const cityRows = Array.isArray(json.cities) ? json.cities : [];
      setCities(cityRows);
      const bamako =
        cityRows.find((city) => String(city.code || "").toUpperCase() === "BKO") ||
        cityRows.find((city) => String(city.slug || "").toLowerCase() === "bamako");
      const selected = bamako || cityRows[0];
      if (selected?._id) {
        setCityId(String(selected._id));
        setCityActive(Boolean(selected.isActive));
      }
    })().catch((requestError: unknown) => {
      if (!mounted) return;
      setError(requestError instanceof Error ? requestError.message : "No se pudieron cargar ciudades.");
    });
    return () => {
      mounted = false;
    };
  }, [adminKey]);

  async function loadSummary() {
    if (!cityId) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        key: adminKey,
        cityId,
        weekKey,
      });
      const res = await fetch(`/api/admin/driver-ledger/summary?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as SummaryResponse | null;
      if (!res.ok || !json?.ok) {
        setError(pickError(json?.error, "No se pudo cargar el ledger por driver."));
        setRows([]);
        return;
      }
      setRows(Array.isArray(json.rows) ? json.rows : []);
      setCityActive(Boolean(json.city?.isActive ?? true));
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo cargar el ledger por driver.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!cityId) return;
    loadSummary();
  }, [cityId, weekKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.pendingCount += Number(row.pendingCount || 0);
        acc.pendingAmount += Number(row.pendingAmount || 0);
        acc.paidCountWeek += Number(row.paidCountWeek || 0);
        acc.paidAmountWeek += Number(row.paidAmountWeek || 0);
        acc.netSettlement += Number(row.netSettlement || 0);
        return acc;
      },
      { pendingCount: 0, pendingAmount: 0, paidCountWeek: 0, paidAmountWeek: 0, netSettlement: 0 }
    );
  }, [rows]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">City</span>
          <select
            className="w-full rounded border border-slate-300 px-3 py-2"
            value={cityId}
            onChange={(event) => {
              const selected = cities.find((city) => String(city._id) === event.target.value);
              setCityActive(Boolean(selected?.isActive));
              setCityId(event.target.value);
            }}
          >
            {cities.map((city) => (
              <option key={city._id} value={city._id}>
                {city.name} ({String(city.code || city.slug || "CITY").toUpperCase()})
              </option>
            ))}
          </select>
        </label>
        <WeekKeyPicker value={weekKey} onChange={setWeekKey} />
        <div className="flex items-end">
          <button
            type="button"
            onClick={loadSummary}
            disabled={loading}
            className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
          >
            {loading ? "Cargando..." : "Refresh"}
          </button>
        </div>
      </div>

      {!cityActive ? (
        <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Esta ciudad está deshabilitada públicamente. Vista en modo solo lectura.
        </p>
      ) : null}

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      <div className="mb-4 grid gap-3 md:grid-cols-5">
        <MetricCard label="Pending count" value={String(totals.pendingCount)} />
        <MetricCard label="Pending amount" value={money(totals.pendingAmount)} />
        <MetricCard label="Paid count week" value={String(totals.paidCountWeek)} />
        <MetricCard label="Paid amount week" value={money(totals.paidAmountWeek)} />
        <MetricCard label="Net settlement" value={money(totals.netSettlement)} />
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-slate-600">
            <tr>
              <th className="border-b py-2">Driver</th>
              <th className="border-b py-2">Pending count</th>
              <th className="border-b py-2">Pending amount</th>
              <th className="border-b py-2">Paid count (week)</th>
              <th className="border-b py-2">Paid amount (week)</th>
              <th className="border-b py-2">Cash collected</th>
              <th className="border-b py-2">Cash due rider</th>
              <th className="border-b py-2">Cash due platform</th>
              <th className="border-b py-2">Net settlement</th>
              <th className="border-b py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.driverId || row.driverRef}`} className="border-b last:border-b-0">
                <td className="py-2">{row.driverName || row.driverRef || "Unassigned"}</td>
                <td className="py-2">{Number(row.pendingCount || 0)}</td>
                <td className="py-2">{money(Number(row.pendingAmount || 0))}</td>
                <td className="py-2">{Number(row.paidCountWeek || 0)}</td>
                <td className="py-2">{money(Number(row.paidAmountWeek || 0))}</td>
                <td className="py-2">{money(Number(row.cashCollectedByRider || 0))}</td>
                <td className="py-2">{money(Number(row.cashDueToRider || 0))}</td>
                <td className="py-2">{money(Number(row.cashDueToPlatform || 0))}</td>
                <td className="py-2">{money(Number(row.netSettlement || 0))}</td>
                <td className="py-2">
                  {row.driverId ? (
                    <Link
                      href={`/admin/bamako/drivers/${encodeURIComponent(row.driverId)}?cityId=${encodeURIComponent(cityId)}&weekKey=${encodeURIComponent(weekKey)}`}
                      className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                    >
                      View
                    </Link>
                  ) : (
                    <span className="text-xs text-slate-500">-</span>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td className="py-3 text-center text-slate-500" colSpan={10}>
                  Sin resultados.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded border border-slate-200 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </article>
  );
}
