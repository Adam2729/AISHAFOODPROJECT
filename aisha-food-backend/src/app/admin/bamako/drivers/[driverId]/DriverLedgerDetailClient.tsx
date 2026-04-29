"use client";

import { useEffect, useMemo, useState } from "react";
import WeekKeyPicker from "@/components/admin/WeekKeyPicker";
import PayoutStatusBadge from "@/components/admin/PayoutStatusBadge";

type CityRow = {
  _id: string;
  code?: string;
  slug?: string;
  name?: string;
};

type PayoutRow = {
  id: string;
  orderId: string;
  orderNumber: string;
  businessId: string;
  businessName: string;
  weekKey: string;
  amount: number;
  deliveryFeeCharged: number;
  platformMargin: number;
  status: "pending" | "paid" | "void";
  paidAt: string | null;
  note: string | null;
  createdAt: string | null;
};

type PayoutsResponse = {
  ok: boolean;
  rows?: PayoutRow[];
  error?: { message?: string } | string;
};

type BulkMarkResponse = {
  ok: boolean;
  updatedCount?: number;
  skipped?: Array<{ payoutId: string; reason: string }>;
  error?: { message?: string } | string;
};

type CitiesResponse = {
  ok: boolean;
  cities?: CityRow[];
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

function monthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

export default function DriverLedgerDetailClient({
  adminKey,
  driverId,
  initialCityId,
  initialWeekKey,
}: {
  adminKey: string;
  driverId: string;
  initialCityId?: string;
  initialWeekKey?: string;
}) {
  const [cities, setCities] = useState<CityRow[]>([]);
  const [cityId, setCityId] = useState(initialCityId || "");
  const [weekKey, setWeekKey] = useState(initialWeekKey || getWeekKey(new Date()));
  const [pendingRows, setPendingRows] = useState<PayoutRow[]>([]);
  const [paidRows, setPaidRows] = useState<PayoutRow[]>([]);
  const [monthRows, setMonthRows] = useState<PayoutRow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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
      if (!cityId && cityRows.length) {
        const bamako =
          cityRows.find((city) => String(city.code || "").toUpperCase() === "BKO") ||
          cityRows[0];
        setCityId(String(bamako._id || ""));
      }
    })().catch((requestError: unknown) => {
      if (!mounted) return;
      setError(requestError instanceof Error ? requestError.message : "No se pudieron cargar ciudades.");
    });
    return () => {
      mounted = false;
    };
  }, [adminKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    if (!cityId || !driverId) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const common = `cityId=${encodeURIComponent(cityId)}&driverId=${encodeURIComponent(driverId)}`;
      const pendingReq = fetch(
        `/api/admin/rider-payouts?${common}&weekKey=${encodeURIComponent(weekKey)}&status=pending&limit=500`,
        { cache: "no-store" }
      );
      const paidReq = fetch(
        `/api/admin/rider-payouts?${common}&weekKey=${encodeURIComponent(weekKey)}&status=paid&limit=200`,
        { cache: "no-store" }
      );
      const monthReq = fetch(
        `/api/admin/rider-payouts?${common}&status=all&from=${encodeURIComponent(
          monthStartIso()
        )}&to=${encodeURIComponent(new Date().toISOString())}&limit=2000`,
        { cache: "no-store" }
      );

      const [pendingRes, paidRes, monthRes] = await Promise.all([pendingReq, paidReq, monthReq]);
      const pendingJson = (await pendingRes.json().catch(() => null)) as PayoutsResponse | null;
      const paidJson = (await paidRes.json().catch(() => null)) as PayoutsResponse | null;
      const monthJson = (await monthRes.json().catch(() => null)) as PayoutsResponse | null;

      if (!pendingRes.ok || !pendingJson?.ok) {
        throw new Error(pickError(pendingJson?.error, "No se pudo cargar pendientes."));
      }
      if (!paidRes.ok || !paidJson?.ok) {
        throw new Error(pickError(paidJson?.error, "No se pudo cargar pagados."));
      }
      if (!monthRes.ok || !monthJson?.ok) {
        throw new Error(pickError(monthJson?.error, "No se pudo cargar resumen mensual."));
      }

      setPendingRows(Array.isArray(pendingJson.rows) ? pendingJson.rows : []);
      setPaidRows((Array.isArray(paidJson.rows) ? paidJson.rows : []).slice(0, 50));
      setMonthRows(Array.isArray(monthJson.rows) ? monthJson.rows : []);
      setSelected({});
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo cargar driver detail.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!cityId || !driverId) return;
    loadData();
  }, [cityId, weekKey, driverId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, on]) => on).map(([id]) => id),
    [selected]
  );

  const weekSummary = useMemo(() => {
    const all = [...pendingRows, ...paidRows];
    let weekTotal = 0;
    let deliveries = 0;
    let cashCollectedByRider = 0;
    let cashDueToRider = 0;
    let cashDueToPlatform = 0;
    for (const row of all) {
      if (row.status === "void") continue;
      deliveries += 1;
      weekTotal += Number(row.amount || 0);
      cashCollectedByRider += Number(row.deliveryFeeCharged || 0);
      cashDueToRider += Number(row.amount || 0);
      cashDueToPlatform += Number(row.platformMargin || 0);
    }
    return {
      weekTotal,
      deliveries,
      avgPayout: deliveries > 0 ? weekTotal / deliveries : 0,
      cashCollectedByRider,
      cashDueToRider,
      cashDueToPlatform,
      netSettlement: cashDueToRider - cashDueToPlatform,
    };
  }, [pendingRows, paidRows]);

  const monthSummary = useMemo(() => {
    let monthTotal = 0;
    let deliveries = 0;
    for (const row of monthRows) {
      if (row.status === "void") continue;
      monthTotal += Number(row.amount || 0);
      deliveries += 1;
    }
    return {
      monthTotal,
      deliveries,
    };
  }, [monthRows]);

  async function markSelectedPaid() {
    if (!selectedIds.length) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/rider-payouts/mark-paid-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutIds: selectedIds }),
      });
      const json = (await res.json().catch(() => null)) as BulkMarkResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "No se pudo marcar pagados."));
      }
      setSuccess(`Updated: ${Number(json.updatedCount || 0)} payouts.`);
      await loadData();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo marcar pagados.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">City</span>
          <select
            className="w-full rounded border border-slate-300 px-3 py-2"
            value={cityId}
            onChange={(event) => setCityId(event.target.value)}
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
            onClick={loadData}
            disabled={loading}
            className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
          >
            {loading ? "Cargando..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mb-3 text-sm text-emerald-700">{success}</p> : null}

      <div className="mb-4 grid gap-3 md:grid-cols-6">
        <MetricCard label="Week total" value={money(weekSummary.weekTotal)} />
        <MetricCard label="MTD total" value={money(monthSummary.monthTotal)} />
        <MetricCard label="Avg payout (week)" value={money(weekSummary.avgPayout)} />
        <MetricCard label="# Deliveries (week)" value={String(weekSummary.deliveries)} />
        <MetricCard label="Cash collected" value={money(weekSummary.cashCollectedByRider)} />
        <MetricCard label="Net settlement" value={money(weekSummary.netSettlement)} />
      </div>

      <section className="mb-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Pending payouts</h2>
          <button
            type="button"
            onClick={markSelectedPaid}
            disabled={!selectedIds.length || loading}
            className="rounded bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Mark selected pending as paid
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th className="border-b py-2">Sel</th>
                <th className="border-b py-2">Order</th>
                <th className="border-b py-2">Business</th>
                <th className="border-b py-2">Amount</th>
                <th className="border-b py-2">Fee</th>
                <th className="border-b py-2">Margin</th>
                <th className="border-b py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {pendingRows.map((row) => (
                <tr key={row.id} className="border-b last:border-b-0">
                  <td className="py-2">
                    <input
                      type="checkbox"
                      checked={Boolean(selected[row.id])}
                      onChange={(event) => setSelected((prev) => ({ ...prev, [row.id]: event.target.checked }))}
                    />
                  </td>
                  <td className="py-2">{row.orderNumber || row.orderId.slice(-6)}</td>
                  <td className="py-2">{row.businessName || row.businessId.slice(-6)}</td>
                  <td className="py-2">{money(row.amount)}</td>
                  <td className="py-2">{money(row.deliveryFeeCharged)}</td>
                  <td className="py-2">{money(row.platformMargin)}</td>
                  <td className="py-2"><PayoutStatusBadge status={row.status} /></td>
                </tr>
              ))}
              {!pendingRows.length ? (
                <tr>
                  <td className="py-3 text-center text-slate-500" colSpan={7}>
                    No pending payouts.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Paid history (last 50)</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th className="border-b py-2">Order</th>
                <th className="border-b py-2">Business</th>
                <th className="border-b py-2">Amount</th>
                <th className="border-b py-2">Status</th>
                <th className="border-b py-2">Paid At</th>
              </tr>
            </thead>
            <tbody>
              {paidRows.map((row) => (
                <tr key={row.id} className="border-b last:border-b-0">
                  <td className="py-2">{row.orderNumber || row.orderId.slice(-6)}</td>
                  <td className="py-2">{row.businessName || row.businessId.slice(-6)}</td>
                  <td className="py-2">{money(row.amount)}</td>
                  <td className="py-2"><PayoutStatusBadge status={row.status} /></td>
                  <td className="py-2">{row.paidAt ? new Date(row.paidAt).toLocaleString() : "-"}</td>
                </tr>
              ))}
              {!paidRows.length ? (
                <tr>
                  <td className="py-3 text-center text-slate-500" colSpan={5}>
                    No paid history.
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
    <article className="rounded border border-slate-200 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </article>
  );
}
