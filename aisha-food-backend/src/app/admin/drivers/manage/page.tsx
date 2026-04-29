"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type DriverRow = {
  driverId: string;
  name: string;
  phone: string;
  isActive: boolean;
  isBanned: boolean;
  bannedReason?: string | null;
  pausedReason?: string | null;
  lastDeliveryConfirmedAt?: string | null;
  createdAt?: string | null;
};

type ListResponse = {
  ok?: boolean;
  cityId?: string;
  rows?: DriverRow[];
  total?: number;
  error?: { message?: string } | string;
};

type CitiesResponse = {
  ok?: boolean;
  cities?: Array<{ _id: string; name?: string; code?: string }>;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

function formatDate(value: unknown) {
  if (!value) return "-";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
}

const SESSION_ADMIN_KEY = "__session__";

export default function AdminDriversManagePage() {
  const [adminKey, setAdminKey] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [cities, setCities] = useState<Array<{ _id: string; name?: string; code?: string }>>([]);
  const [cityId, setCityId] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive" | "banned">("all");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<DriverRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (cityId) params.set("cityId", cityId);
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    return params.toString();
  }, [cityId, q, status]);

  async function loadCities() {
    try {
      const res = await fetch(`/api/admin/cities`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as CitiesResponse | null;
      if (res.ok && json?.ok && Array.isArray(json.cities)) {
        setCities(json.cities);
        if (!cityId && json.cities.length) setCityId(String(json.cities[0]._id));
      }
    } catch {
      // ignore
    }
  }

  async function loadDrivers() {
    if (!adminKey || !cityId) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/drivers?${queryString}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ListResponse | null;
      if (!res.ok || !json?.ok) throw new Error(pickError(json?.error, "Could not load drivers."));
      setRows(Array.isArray(json.rows) ? json.rows : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load drivers.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function action(endpoint: string, driverId: string, promptText?: string) {
    if (!adminKey || !cityId) return;
    let reason: string | undefined;
    if (promptText) {
      reason = window.prompt(promptText, "") || "";
    }
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(
        `/api/admin/drivers/${encodeURIComponent(driverId)}/${endpoint}?cityId=${encodeURIComponent(
          cityId
        )}`,
        {
          method: "POST",
          headers: reason != null ? { "Content-Type": "application/json" } : undefined,
          body: reason != null ? JSON.stringify({ reason }) : undefined,
        }
      );
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown } | null;
      if (!res.ok || !json?.ok) throw new Error(pickError(json?.error, `Could not ${endpoint}.`));
      setSuccess(`${endpoint} succeeded.`);
      await loadDrivers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `Could not ${endpoint}.`);
    } finally {
      setLoading(false);
    }
  }

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
          await loadCities();
        }
      } catch {
        if (!mounted) return;
        setAuthenticated(false);
      }
    }

    bootstrap().catch(() => null);
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!adminKey || !cityId) return;
    loadDrivers();
  }, [adminKey, cityId, status, q]); // eslint-disable-line react-hooks/exhaustive-deps

  if (authenticated === null) return null;

  if (authenticated === false || !adminKey) {
    return (
      <main className="mx-auto min-h-screen max-w-6xl p-6">
        <h1 className="text-2xl font-bold">Drivers</h1>
        <p className="mt-2 text-sm text-red-600">
          Driver admin access requires a secure browser session.
        </p>
        <Link
          href="/admin/access?next=/admin/drivers/manage"
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Drivers</h1>
          <p className="text-sm text-slate-600">Manage drivers per city.</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/admin/ops`}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Ops Center
          </Link>
          <button
            type="button"
            onClick={loadDrivers}
            disabled={loading}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mb-3 text-sm text-emerald-700">{success}</p> : null}

      <section className="mb-3 flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-4">
        <select
          value={cityId}
          onChange={(e) => setCityId(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">Select city</option>
          {cities.map((c) => (
            <option key={c._id} value={c._id}>
              {(c.code || "").toUpperCase()} {c.name ? `- ${c.name}` : ""}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="banned">Banned</option>
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name/phone"
          className="rounded border border-slate-300 px-3 py-1.5 text-sm"
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Name</th>
                <th className="pb-2">Phone</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Last Delivery</th>
                <th className="pb-2">Created</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row) => {
                  const paused = Boolean(row.pausedReason);
                  return (
                    <tr key={row.driverId} className="border-t border-slate-100 align-top">
                      <td className="py-2">{row.name}</td>
                      <td className="py-2">{row.phone}</td>
                      <td className="py-2">
                        <div className="flex flex-col gap-1">
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold uppercase">
                            {row.isBanned ? "BANNED" : row.isActive ? "ACTIVE" : "INACTIVE"}
                          </span>
                          {paused ? (
                            <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold uppercase">
                              Paused
                            </span>
                          ) : null}
                          {row.bannedReason ? (
                            <div className="text-xs text-red-700">Reason: {row.bannedReason}</div>
                          ) : null}
                          {row.pausedReason ? (
                            <div className="text-xs text-amber-700">Pause: {row.pausedReason}</div>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2 text-xs">{formatDate(row.lastDeliveryConfirmedAt)}</td>
                      <td className="py-2 text-xs">{formatDate(row.createdAt)}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => action("activate", row.driverId)}
                            disabled={loading || row.isBanned}
                            className="rounded border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-50"
                          >
                            Activate
                          </button>
                          <button
                            type="button"
                            onClick={() => action("deactivate", row.driverId)}
                            disabled={loading}
                            className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold disabled:opacity-50"
                          >
                            Deactivate
                          </button>
                          <button
                            type="button"
                            onClick={() => action("ban", row.driverId, "Ban reason (optional)")}
                            disabled={loading || row.isBanned}
                            className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
                          >
                            Ban
                          </button>
                          <button
                            type="button"
                            onClick={() => action("unban", row.driverId)}
                            disabled={loading || !row.isBanned}
                            className="rounded border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-50"
                          >
                            Unban
                          </button>
                          <button
                            type="button"
                            onClick={() => action("pause", row.driverId, "Pause reason (optional)")}
                            disabled={loading || paused}
                            className="rounded border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-700 disabled:opacity-50"
                          >
                            Pause
                          </button>
                          <button
                            type="button"
                            onClick={() => action("unpause", row.driverId)}
                            disabled={loading || !paused}
                            className="rounded border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-50"
                          >
                            Unpause
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="py-3 text-center text-slate-500">
                    No drivers found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
