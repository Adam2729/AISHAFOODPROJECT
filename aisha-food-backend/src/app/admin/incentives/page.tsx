"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type CityRow = {
  _id: string;
  code: string;
  name: string;
  country: string;
  isActive: boolean;
};

type IncentiveRuleRow = {
  ruleId: string;
  cityId: string;
  name: string;
  type: "deliveries_count" | "revenue_amount" | "peak_hours";
  threshold: number;
  rewardAmount: number;
  period: "daily" | "weekly";
  isActive: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  notes?: string | null;
  createdAt?: string | null;
};

type IncentivesResponse = {
  ok?: boolean;
  cityId?: string;
  rows?: IncentiveRuleRow[];
  error?: { message?: string } | string;
};

type CitiesResponse = {
  ok?: boolean;
  cities?: CityRow[];
  error?: { message?: string } | string;
};

type CreateForm = {
  name: string;
  type: "deliveries_count" | "revenue_amount" | "peak_hours";
  threshold: string;
  rewardAmount: string;
  period: "daily" | "weekly";
  startsAt: string;
  endsAt: string;
  notes: string;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

const INITIAL_FORM: CreateForm = {
  name: "",
  type: "deliveries_count",
  threshold: "1",
  rewardAmount: "",
  period: "weekly",
  startsAt: "",
  endsAt: "",
  notes: "",
};

export default function AdminIncentivesPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [cityId, setCityId] = useState("");
  const [rows, setRows] = useState<IncentiveRuleRow[]>([]);
  const [form, setForm] = useState<CreateForm>(INITIAL_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadCities() {
    if (!authenticated) return;
    const res = await fetch("/api/admin/cities", {
      cache: "no-store",
    });
    if (res.status === 401) {
      setAuthenticated(false);
      return;
    }
    const json = (await res.json().catch(() => null)) as CitiesResponse | null;
    if (!res.ok || !json?.ok) {
      throw new Error(pickError(json?.error, "Could not load cities."));
    }
    const nextCities = Array.isArray(json.cities) ? json.cities : [];
    setCities(nextCities);
    if (!cityId && nextCities.length) {
      setCityId(String(nextCities[0]._id || ""));
    }
  }

  async function loadRules(nextCityId = cityId) {
    if (!authenticated || !nextCityId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/admin/incentives?cityId=${encodeURIComponent(nextCityId)}`,
        { cache: "no-store" }
      );
      if (res.status === 401) {
        setAuthenticated(false);
        setRows([]);
        return;
      }
      const json = (await res.json().catch(() => null)) as IncentivesResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not load incentive rules."));
      }
      setRows(Array.isArray(json.rows) ? json.rows : []);
    } catch (requestError: unknown) {
      setRows([]);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load incentive rules."
      );
    } finally {
      setLoading(false);
    }
  }

  async function createRule() {
    if (!authenticated || !cityId || saving) return;
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const payload = {
        cityId,
        name: form.name,
        type: form.type,
        threshold: Number(form.threshold || 0),
        rewardAmount: Number(form.rewardAmount || 0),
        period: form.period,
        startsAt: form.startsAt || null,
        endsAt: form.endsAt || null,
        notes: form.notes || null,
      };
      const res = await fetch("/api/admin/incentives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: { message?: string } | string }
        | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not create incentive rule."));
      }
      setForm(INITIAL_FORM);
      setNotice("Incentive rule created.");
      await loadRules(cityId);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not create incentive rule."
      );
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!authenticated) return;
    loadCities().catch((requestError: unknown) => {
      setError(
        requestError instanceof Error ? requestError.message : "Could not load cities."
      );
    });
  }, [authenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!authenticated || !cityId) return;
    loadRules(cityId);
  }, [authenticated, cityId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCity = useMemo(
    () => cities.find((city) => String(city._id) === cityId) || null,
    [cities, cityId]
  );

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const res = await fetch("/api/admin/session", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { authenticated?: boolean } | null;
        const allowed = Boolean(res.ok && json?.authenticated);
        if (!mounted) return;
        setAuthenticated(allowed);
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

  if (authenticated === null) return null;

  if (!authenticated) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Driver Incentives</h1>
        <p className="mt-2 text-sm text-red-600">
          Admin access requires a secure browser session.
        </p>
        <Link
          href="/admin/access?next=/admin/incentives"
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Driver Incentives</h1>
          <p className="text-sm text-slate-600">
            Create city-scoped reward campaigns for delivery performance.
          </p>
        </div>
        <Link
          href="/admin"
          className="rounded-lg border px-3 py-2 text-sm"
        >
          Back to Admin
        </Link>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">City</span>
            <select
              className="input min-w-[220px]"
              value={cityId}
              onChange={(event) => setCityId(event.target.value)}
            >
              {cities.map((city) => (
                <option key={city._id} value={city._id}>
                  {city.name} ({city.code})
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => loadRules(cityId)}
              disabled={loading || !cityId}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
            >
              {loading ? "Loading..." : "Refresh rules"}
            </button>
          </div>
        </div>
        {selectedCity ? (
          <p className="mt-2 text-sm text-slate-500">
            Active city: {selectedCity.name} ({selectedCity.code})
          </p>
        ) : null}
        {notice ? <p className="mt-2 text-sm text-emerald-600">{notice}</p> : null}
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </section>

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Create incentive campaign</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className="input"
            placeholder="Campaign name"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          />
          <select
            className="input"
            value={form.type}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                type: event.target.value as CreateForm["type"],
              }))
            }
          >
            <option value="deliveries_count">deliveries_count</option>
            <option value="revenue_amount">revenue_amount</option>
            <option value="peak_hours">peak_hours</option>
          </select>
          <input
            className="input"
            placeholder="Threshold"
            value={form.threshold}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, threshold: event.target.value }))
            }
          />
          <input
            className="input"
            placeholder="Reward amount"
            value={form.rewardAmount}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, rewardAmount: event.target.value }))
            }
          />
          <select
            className="input"
            value={form.period}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                period: event.target.value as CreateForm["period"],
              }))
            }
          >
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
          </select>
          <input
            className="input"
            type="datetime-local"
            value={form.startsAt}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, startsAt: event.target.value }))
            }
          />
          <input
            className="input"
            type="datetime-local"
            value={form.endsAt}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, endsAt: event.target.value }))
            }
          />
          <input
            className="input"
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
          />
        </div>
        <button
          type="button"
          onClick={createRule}
          disabled={saving || !cityId}
          className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Creating..." : "Create incentive"}
        </button>
      </section>

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Current rules</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Name</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Threshold</th>
                <th className="pb-2">Reward</th>
                <th className="pb-2">Period</th>
                <th className="pb-2">Window</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ruleId} className="border-t border-slate-100">
                  <td className="py-2 font-semibold">{row.name}</td>
                  <td className="py-2">{row.type}</td>
                  <td className="py-2">{row.threshold}</td>
                  <td className="py-2">{row.rewardAmount}</td>
                  <td className="py-2">{row.period}</td>
                  <td className="py-2">
                    <div>{formatDate(row.startsAt)}</div>
                    <div className="text-xs text-slate-500">{formatDate(row.endsAt)}</div>
                  </td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${
                        row.isActive
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {row.isActive ? "active" : "inactive"}
                    </span>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-slate-500">
                    No incentive rules for this city yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <style jsx>{`
        .input {
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          padding: 0.55rem 0.7rem;
        }
      `}</style>
    </main>
  );
}
