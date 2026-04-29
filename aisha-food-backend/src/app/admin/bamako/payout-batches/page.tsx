"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import WeekKeyPicker from "@/components/admin/WeekKeyPicker";
import CsvDownloadLink from "@/components/admin/CsvDownloadLink";
import PayoutStatusBadge from "@/components/admin/PayoutStatusBadge";

type CityRow = {
  _id: string;
  code?: string;
  slug?: string;
  name?: string;
  isActive?: boolean;
};

type BatchRow = {
  id: string;
  cityId: string;
  weekKey: string;
  status: "open" | "paid" | "void";
  payoutIds: string[];
  payoutsCount: number;
  totalAmount: number;
  totalDeliveryFeeCharged: number;
  totalPlatformMargin: number;
  createdByAdminId: string | null;
  paidByAdminId: string | null;
  paidAt: string | null;
  note: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type CitiesResponse = {
  ok: boolean;
  cities?: CityRow[];
  error?: { message?: string } | string;
};

type BatchesResponse = {
  ok: boolean;
  rows?: BatchRow[];
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
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

const SESSION_ADMIN_KEY = "__session__";

export default function BamakoPayoutBatchesPage() {
  const [adminKey, setAdminKey] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [cityId, setCityId] = useState("");
  const [weekKey, setWeekKey] = useState(getWeekKey(new Date()));
  const [limit, setLimit] = useState(2000);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const res = await fetch("/api/admin/session", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { authenticated?: boolean } | null;
        const allowed = Boolean(res.ok && json?.authenticated);
        if (!mounted) return;
        setAuthenticated(allowed);
        if (allowed) {
          setAdminKey(SESSION_ADMIN_KEY);
        }
      } catch {
        if (!mounted) return;
        setAuthenticated(false);
      } finally {
        if (mounted) setReady(true);
      }
    }

    bootstrap().catch(() => null);
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || !adminKey) return;
    (async () => {
      const res = await fetch(`/api/admin/cities`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as CitiesResponse | null;
      if (!res.ok || !json?.ok) {
        setError(pickError(json?.error, "No se pudieron cargar ciudades."));
        return;
      }
      const cityRows = Array.isArray(json.cities) ? json.cities : [];
      setCities(cityRows);
      const bamako =
        cityRows.find((city) => String(city.code || "").toUpperCase() === "BKO") ||
        cityRows.find((city) => String(city.slug || "").toLowerCase() === "bamako") ||
        cityRows[0];
      if (bamako?._id) setCityId(String(bamako._id));
    })().catch((requestError: unknown) => {
      setError(requestError instanceof Error ? requestError.message : "No se pudieron cargar ciudades.");
    });
  }, [ready, adminKey]);

  async function loadBatches() {
    if (!adminKey) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (cityId) params.set("cityId", cityId);
      if (weekKey) params.set("weekKey", weekKey);
      const res = await fetch(`/api/admin/rider-payout-batches?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as BatchesResponse | null;
      if (!res.ok || !json?.ok) {
        setError(pickError(json?.error, "No se pudieron cargar batches."));
        setRows([]);
        return;
      }
      setRows(Array.isArray(json.rows) ? json.rows : []);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "No se pudieron cargar batches.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!adminKey || !cityId) return;
    loadBatches();
  }, [adminKey, cityId, weekKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function upsertBatch() {
    if (!adminKey || !cityId) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/rider-payout-batches/upsert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cityId, weekKey, limit }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "No se pudo crear/actualizar batch."));
      }
      setSuccess("Batch upsert completed.");
      await loadBatches();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo crear/actualizar batch.");
    } finally {
      setLoading(false);
    }
  }

  async function payBatch(batchId: string) {
    if (!adminKey || !batchId) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(
        `/api/admin/rider-payout-batches/${encodeURIComponent(batchId)}/pay`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "No se pudo pagar batch."));
      }
      setSuccess("Batch paid successfully.");
      await loadBatches();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo pagar batch.");
    } finally {
      setLoading(false);
    }
  }

  if (!ready) return null;
  if (authenticated === false || !adminKey) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Bamako Payout Batches</h1>
        <p className="mt-2 text-sm text-red-600">
          Bamako payout access requires a secure browser session.
        </p>
        <Link
          href="/admin/access?next=/admin/bamako/payout-batches"
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
          <h1 className="text-2xl font-bold">Bamako Payout Batches</h1>
          <p className="text-sm text-slate-600">Create/refresh weekly batches, pay them, and export CSV.</p>
        </div>
        <Link href={`/admin/bamako/drivers`} className="rounded border px-3 py-2 text-sm">
          Drivers
        </Link>
      </div>

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-4">
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
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Limit</span>
            <input
              type="number"
              min={1}
              max={10000}
              value={limit}
              onChange={(event) => setLimit(Math.max(1, Math.min(10000, Number(event.target.value || 2000))))}
              className="w-full rounded border border-slate-300 px-3 py-2"
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={loadBatches}
              disabled={loading}
              className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={upsertBatch}
              disabled={loading || !cityId}
              className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
            >
              Create/Refresh Batch
            </button>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        {success ? <p className="mt-3 text-sm text-emerald-700">{success}</p> : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th className="border-b py-2">Week</th>
                <th className="border-b py-2">Status</th>
                <th className="border-b py-2">Payouts</th>
                <th className="border-b py-2">Total amount</th>
                <th className="border-b py-2">Delivery fees</th>
                <th className="border-b py-2">Platform margin</th>
                <th className="border-b py-2">Paid at</th>
                <th className="border-b py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b last:border-b-0">
                  <td className="py-2">{row.weekKey}</td>
                  <td className="py-2"><PayoutStatusBadge status={row.status} /></td>
                  <td className="py-2">{Number(row.payoutsCount || 0)}</td>
                  <td className="py-2">{money(Number(row.totalAmount || 0))}</td>
                  <td className="py-2">{money(Number(row.totalDeliveryFeeCharged || 0))}</td>
                  <td className="py-2">{money(Number(row.totalPlatformMargin || 0))}</td>
                  <td className="py-2">{row.paidAt ? new Date(row.paidAt).toLocaleString() : "-"}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => payBatch(row.id)}
                        disabled={loading || row.status === "paid"}
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold disabled:opacity-50"
                      >
                        Pay batch
                      </button>
                      <CsvDownloadLink
                        href={`/api/admin/rider-payout-batches/${encodeURIComponent(
                          row.id
                        )}/export`}
                        label="Export CSV"
                        className="px-2 py-1 text-xs"
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td className="py-3 text-center text-slate-500" colSpan={8}>
                    No batches found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
