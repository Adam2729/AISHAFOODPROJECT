"use client";

import { useEffect, useMemo, useState } from "react";

type CityRow = {
  _id: string;
  code?: string;
  name?: string;
};

type PendingRow = {
  payoutId: string;
  orderId: string;
  driverId: string;
  amount: number;
  deliveryFeeCharged: number;
  platformMargin: number;
  createdAt?: string | Date | null;
};

type PendingResponse = {
  ok?: boolean;
  cityId?: string;
  weekKey?: string;
  pending?: PendingRow[];
  error?: { message?: string } | string;
};

type LeaderboardRow = {
  driverId: string | null;
  pendingCount: number;
  pendingNetSettlement: number;
  paidCount: number;
  paidNetSettlement: number;
  totalNetSettlement: number;
};

type LeaderboardResponse = {
  ok?: boolean;
  drivers?: LeaderboardRow[];
  error?: { message?: string } | string;
};

type BulkResponse = {
  ok?: boolean;
  requestedCount?: number;
  matchedPendingCount?: number;
  updatedCount?: number;
  skipped?: {
    notFoundOrWrongScope?: number;
    alreadyPaidOrVoid?: number;
  };
  paidAtIso?: string;
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

export default function PayoutsDashboardClient({
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
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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
        rows.find((row) => String(row.code || "").toUpperCase() === "BKO") || rows[0];
      setCityId(String(preferred._id || ""));
    }
  }

  async function loadData() {
    if (!cityId || !weekKey) return;
    setLoading(true);
    setError("");
    try {
      const pendingParams = new URLSearchParams({
        key: adminKey,
        cityId,
        weekKey,
      });
      const leaderParams = new URLSearchParams({
        key: adminKey,
        cityId,
        weekKey,
      });
      const [pendingRes, leaderRes] = await Promise.all([
        fetch(`/api/admin/rider-payouts/pending?${pendingParams.toString()}`, {
          cache: "no-store",
        }),
        fetch(`/api/ops/driver-reconciliation/city-week?${leaderParams.toString()}`, {
          cache: "no-store",
        }),
      ]);
      const pendingJson = (await pendingRes.json().catch(() => null)) as PendingResponse | null;
      const leaderJson = (await leaderRes.json().catch(() => null)) as LeaderboardResponse | null;

      if (!pendingRes.ok || !pendingJson?.ok) {
        throw new Error(pickError(pendingJson?.error, "Could not load pending payouts."));
      }
      if (!leaderRes.ok || !leaderJson?.ok) {
        throw new Error(pickError(leaderJson?.error, "Could not load reconciliation leaderboard."));
      }

      setPending(Array.isArray(pendingJson.pending) ? pendingJson.pending : []);
      setLeaderboard(Array.isArray(leaderJson.drivers) ? leaderJson.drivers : []);
      setSelected({});
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not load payout data."
      );
      setPending([]);
      setLeaderboard([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCities().catch((requestError: unknown) => {
      setError(
        requestError instanceof Error ? requestError.message : "Could not load cities."
      );
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!cityId || !weekKey) return;
    loadData();
  }, [cityId, weekKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingSummary = useMemo(() => {
    let pendingCount = 0;
    let pendingAmount = 0;
    let pendingNet = 0;
    for (const row of pending) {
      pendingCount += 1;
      pendingAmount += Number(row.amount || 0);
      pendingNet += Number(row.amount || 0) - Number(row.platformMargin || 0);
    }
    return { pendingCount, pendingAmount, pendingNet };
  }, [pending]);

  const selectedIds = useMemo(
    () =>
      Object.entries(selected)
        .filter(([, checked]) => checked)
        .map(([payoutId]) => payoutId),
    [selected]
  );

  async function bulkPaySelected() {
    if (!selectedIds.length) return;
    setPaying(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/rider-payouts/mark-paid-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cityId,
          weekKey,
          payoutIds: selectedIds,
          note,
        }),
      });
      const json = (await res.json().catch(() => null)) as BulkResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Bulk pay failed."));
      }
      setSuccess(
        `Paid ${Number(json.updatedCount || 0)} / ${Number(
          json.requestedCount || selectedIds.length
        )}.`
      );
      await loadData();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Bulk pay failed.");
    } finally {
      setPaying(false);
    }
  }

  const allSelected = pending.length > 0 && selectedIds.length === pending.length;

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
              onClick={loadData}
              disabled={loading || !cityId}
              className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Pending count" value={String(pendingSummary.pendingCount)} />
        <MetricCard label="Pending amount" value={money(pendingSummary.pendingAmount)} />
        <MetricCard label="Pending net" value={money(pendingSummary.pendingNet)} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const next: Record<string, boolean> = {};
              if (!allSelected) {
                for (const row of pending) {
                  next[row.payoutId] = true;
                }
              }
              setSelected(next);
            }}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm"
          >
            {allSelected ? "Unselect all" : "Select all"}
          </button>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 280))}
            placeholder="Note (optional)"
            className="min-w-[200px] flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={bulkPaySelected}
            disabled={paying || !selectedIds.length}
            className="rounded bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {paying ? "Paying..." : `Mark selected paid (${selectedIds.length})`}
          </button>
          <a
            href={`/api/admin/rider-payouts/pending/export.csv?cityId=${encodeURIComponent(cityId)}&weekKey=${encodeURIComponent(weekKey)}`}
            className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold"
          >
            Export pending CSV
          </a>
          <a
            href={`/api/ops/driver-reconciliation/city-week?cityId=${encodeURIComponent(cityId)}&weekKey=${encodeURIComponent(weekKey)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            Recon JSON
          </a>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th className="border-b py-2">Sel</th>
                <th className="border-b py-2">Payout</th>
                <th className="border-b py-2">Driver</th>
                <th className="border-b py-2">Order</th>
                <th className="border-b py-2">Amount</th>
                <th className="border-b py-2">Fee</th>
                <th className="border-b py-2">Margin</th>
                <th className="border-b py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((row) => (
                <tr key={row.payoutId} className="border-b last:border-b-0">
                  <td className="py-2">
                    <input
                      type="checkbox"
                      checked={Boolean(selected[row.payoutId])}
                      onChange={(event) =>
                        setSelected((prev) => ({ ...prev, [row.payoutId]: event.target.checked }))
                      }
                    />
                  </td>
                  <td className="py-2 font-mono text-xs">{row.payoutId}</td>
                  <td className="py-2 font-mono text-xs">{row.driverId || "-"}</td>
                  <td className="py-2 font-mono text-xs">{row.orderId || "-"}</td>
                  <td className="py-2">{money(row.amount)}</td>
                  <td className="py-2">{money(row.deliveryFeeCharged)}</td>
                  <td className="py-2">{money(row.platformMargin)}</td>
                  <td className="py-2">{row.createdAt ? new Date(row.createdAt).toLocaleString() : "-"}</td>
                </tr>
              ))}
              {!pending.length ? (
                <tr>
                  <td colSpan={8} className="py-3 text-center text-slate-500">
                    No pending payouts for this week/city.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-lg font-semibold">Driver net ranking (abs)</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th className="border-b py-2">Driver</th>
                <th className="border-b py-2">Pending Net</th>
                <th className="border-b py-2">Paid Net</th>
                <th className="border-b py-2">Total Net</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row) => (
                <tr key={row.driverId || `unassigned-${row.totalNetSettlement}`} className="border-b last:border-b-0">
                  <td className="py-2">{row.driverId || "Unassigned"}</td>
                  <td className="py-2">{money(row.pendingNetSettlement)}</td>
                  <td className="py-2">{money(row.paidNetSettlement)}</td>
                  <td className="py-2 font-semibold">{money(row.totalNetSettlement)}</td>
                </tr>
              ))}
              {!leaderboard.length ? (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-slate-500">
                    No reconciliation data yet.
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

