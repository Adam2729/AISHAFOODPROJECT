"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type CityRow = {
  _id: string;
  code?: string;
  name?: string;
  currency?: string;
};

type BusinessRow = {
  id: string;
  cityId?: string | null;
  type?: "restaurant" | "colmado";
  name: string;
  isActive?: boolean;
};

type CampaignRow = {
  id: string;
  cityId: string;
  cityName?: string | null;
  cityCode?: string | null;
  businessId: string;
  businessName?: string | null;
  name: string;
  dailyBudget: number;
  totalBudget: number;
  spent: number;
  spentToday: number;
  remainingBudget: number;
  startDate?: string | null;
  endDate?: string | null;
  priority: number;
  isActive: boolean;
  status:
    | "active"
    | "inactive"
    | "scheduled"
    | "ended"
    | "budget_exhausted"
    | "daily_budget_exhausted";
  impressions: number;
  clicks: number;
  ctr: number;
  createdAt?: string | null;
};

type ApiErrorShape = { message?: string };

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as ApiErrorShape).message || fallback);
  }
  return fallback;
}

function formatMoney(value: number, currency = "DOP") {
  return `${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function statusTone(status: CampaignRow["status"]) {
  if (status === "active") return "bg-emerald-100 text-emerald-800";
  if (status === "scheduled") return "bg-blue-100 text-blue-800";
  if (status === "ended") return "bg-slate-200 text-slate-700";
  if (status === "budget_exhausted" || status === "daily_budget_exhausted") {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-red-100 text-red-800";
}

export default function AdminAdsPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [cityId, setCityId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState("");
  const [form, setForm] = useState(() => {
    const now = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 7);
    return {
      businessId: "",
      name: "",
      dailyBudget: "500",
      totalBudget: "5000",
      priority: "1",
      startDate: toDateInputValue(now),
      endDate: toDateInputValue(end),
    };
  });

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;

    async function loadBase() {
      try {
        setError("");
        const [citiesRes, businessesRes] = await Promise.all([
          fetch("/api/public/cities", { cache: "no-store" }),
          fetch("/api/admin/businesses", { cache: "no-store" }),
        ]);
        if (businessesRes.status === 401) {
          if (!cancelled) setAuthenticated(false);
          return;
        }

        const [citiesJson, businessesJson] = await Promise.all([
          citiesRes.json().catch(() => null),
          businessesRes.json().catch(() => null),
        ]);

        if (!citiesRes.ok || !citiesJson?.ok) {
          throw new Error(pickError(citiesJson?.error, "Could not load cities."));
        }
        if (!businessesRes.ok || !businessesJson?.ok) {
          throw new Error(pickError(businessesJson?.error, "Could not load businesses."));
        }

        if (cancelled) return;

        const nextCities = Array.isArray(citiesJson.cities) ? (citiesJson.cities as CityRow[]) : [];
        const nextBusinesses = Array.isArray(businessesJson.businesses)
          ? (businessesJson.businesses as BusinessRow[])
          : [];

        setCities(nextCities);
        setBusinesses(nextBusinesses);
        setCityId((current) => current || String(nextCities[0]?._id || ""));
      } catch (loadError: unknown) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load ad setup data.");
        }
      }
    }

    void loadBase();

    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated || !cityId) return;
    let cancelled = false;

    async function loadCampaigns() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/admin/ads?cityId=${encodeURIComponent(cityId)}`, {
          cache: "no-store",
        });
        if (res.status === 401) {
          if (!cancelled) setAuthenticated(false);
          return;
        }
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          throw new Error(pickError(json?.error, "Could not load campaigns."));
        }
        if (cancelled) return;
        setCampaigns(Array.isArray(json.rows) ? (json.rows as CampaignRow[]) : []);
      } catch (loadError: unknown) {
        if (!cancelled) {
          setCampaigns([]);
          setError(loadError instanceof Error ? loadError.message : "Could not load campaigns.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadCampaigns();

    return () => {
      cancelled = true;
    };
  }, [authenticated, cityId]);

  const selectedCity = cities.find((row) => row._id === cityId) || null;
  const restaurants = useMemo(() => {
    return businesses
      .filter((row) => row.type === "restaurant" && row.isActive !== false)
      .filter((row) => !cityId || String(row.cityId || "") === cityId)
      .sort((left, right) => left.name.localeCompare(right.name, "fr"));
  }, [businesses, cityId]);

  useEffect(() => {
    if (!restaurants.length) {
      setForm((current) => ({ ...current, businessId: "" }));
      return;
    }
    setForm((current) =>
      current.businessId && restaurants.some((row) => row.id === current.businessId)
        ? current
        : { ...current, businessId: restaurants[0].id }
    );
  }, [restaurants]);

  const summary = useMemo(() => {
    return campaigns.reduce(
      (acc, row) => {
        acc.total += 1;
        acc.active += row.status === "active" ? 1 : 0;
        acc.spent += Number(row.spent || 0);
        acc.impressions += Number(row.impressions || 0);
        acc.clicks += Number(row.clicks || 0);
        return acc;
      },
      { total: 0, active: 0, spent: 0, impressions: 0, clicks: 0 }
    );
  }, [campaigns]);

  async function createCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authenticated || !cityId) return;

    setSaving(true);
    setError("");
    setBanner("");
    try {
      const res = await fetch("/api/admin/ads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cityId,
          businessId: form.businessId,
          name: form.name,
          dailyBudget: Number(form.dailyBudget || 0),
          totalBudget: Number(form.totalBudget || 0),
          priority: Number(form.priority || 1),
          startDate: form.startDate,
          endDate: form.endDate,
        }),
      });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not create campaign."));
      }

      setBanner("Campaign created.");
      setForm((current) => ({
        ...current,
        name: "",
        dailyBudget: "500",
        totalBudget: "5000",
        priority: "1",
      }));

      const reload = await fetch(`/api/admin/ads?cityId=${encodeURIComponent(cityId)}`, {
        cache: "no-store",
      });
      const reloadJson = await reload.json().catch(() => null);
      if (reload.ok && reloadJson?.ok) {
        setCampaigns(Array.isArray(reloadJson.rows) ? (reloadJson.rows as CampaignRow[]) : []);
      }
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : "Could not create campaign.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const res = await fetch("/api/admin/session", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { authenticated?: boolean } | null;
        if (!mounted) return;
        setAuthenticated(Boolean(res.ok && json?.authenticated));
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
      <main className="mx-auto min-h-screen max-w-6xl p-6">
        <h1 className="text-2xl font-bold">Sponsored Restaurants</h1>
        <p className="mt-2 text-sm text-red-600">
          Admin access requires a secure browser session.
        </p>
        <Link
          href="/admin/access?next=/admin/ads"
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Sponsored Restaurants</h1>
          <p className="text-sm text-slate-600">
            Manage sponsored restaurant placement, budgets, and campaign activity by city.
          </p>
        </div>
        <Link
          href="/admin"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          Back to Admin
        </Link>
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Campaigns" value={String(summary.total)} />
        <SummaryCard label="Active" value={String(summary.active)} />
        <SummaryCard
          label="Spend"
          value={formatMoney(summary.spent, selectedCity?.currency || "DOP")}
        />
        <SummaryCard label="Impressions" value={String(summary.impressions)} />
        <SummaryCard label="Clicks" value={String(summary.clicks)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-950">Create Campaign</h2>
            <select
              value={cityId}
              onChange={(event) => setCityId(String(event.target.value || ""))}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Select city</option>
              {cities.map((city) => (
                <option key={city._id} value={city._id}>
                  {city.name || city.code || city._id}
                </option>
              ))}
            </select>
          </div>

          <form onSubmit={createCampaign} className="mt-4 grid gap-3">
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Restaurant
              <select
                value={form.businessId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, businessId: String(event.target.value || "") }))
                }
                className="rounded-xl border border-slate-300 px-3 py-2"
              >
                {!restaurants.length ? <option value="">No active restaurants</option> : null}
                {restaurants.map((restaurant) => (
                  <option key={restaurant.id} value={restaurant.id}>
                    {restaurant.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Campaign name
              <input
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: String(event.target.value || "") }))
                }
                placeholder="Weekend visibility boost"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Daily budget
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.dailyBudget}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      dailyBudget: String(event.target.value || ""),
                    }))
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Total budget
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.totalBudget}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      totalBudget: String(event.target.value || ""),
                    }))
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Priority
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.priority}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, priority: String(event.target.value || "") }))
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="grid gap-1 text-sm font-medium text-slate-700 sm:col-span-1">
                Start date
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, startDate: String(event.target.value || "") }))
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="grid gap-1 text-sm font-medium text-slate-700 sm:col-span-1">
                End date
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, endDate: String(event.target.value || "") }))
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={saving || !cityId || !form.businessId}
              className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Creating..." : "Create campaign"}
            </button>
          </form>

          {banner ? (
            <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {banner}
            </p>
          ) : null}
          {error ? (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Campaigns</h2>
              <p className="text-sm text-slate-500">
                {selectedCity?.name || "Selected city"} sponsored listings and analytics.
              </p>
            </div>
            {loading ? <span className="text-sm text-slate-500">Refreshing...</span> : null}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-3 font-medium">Campaign</th>
                  <th className="pb-3 font-medium">Restaurant</th>
                  <th className="pb-3 font-medium">Budget</th>
                  <th className="pb-3 font-medium">Spent</th>
                  <th className="pb-3 font-medium">Analytics</th>
                  <th className="pb-3 font-medium">Priority</th>
                  <th className="pb-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-t border-slate-100 align-top">
                    <td className="py-3">
                      <div className="font-medium text-slate-900">{campaign.name}</div>
                      <div className="text-xs text-slate-500">
                        {formatDate(campaign.startDate)} to {formatDate(campaign.endDate)}
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="font-medium text-slate-800">
                        {campaign.businessName || campaign.businessId}
                      </div>
                      <div className="text-xs text-slate-500">
                        {campaign.cityName || campaign.cityCode || campaign.cityId}
                      </div>
                    </td>
                    <td className="py-3">
                      <div>{formatMoney(campaign.dailyBudget, selectedCity?.currency || "DOP")} / day</div>
                      <div className="text-xs text-slate-500">
                        {formatMoney(campaign.totalBudget, selectedCity?.currency || "DOP")} total
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="font-medium text-slate-900">
                        {formatMoney(campaign.spent, selectedCity?.currency || "DOP")}
                      </div>
                      <div className="text-xs text-slate-500">
                        Today {formatMoney(campaign.spentToday, selectedCity?.currency || "DOP")}
                      </div>
                      <div className="text-xs text-slate-500">
                        Remaining {formatMoney(campaign.remainingBudget, selectedCity?.currency || "DOP")}
                      </div>
                    </td>
                    <td className="py-3">
                      <div>{campaign.impressions} impressions</div>
                      <div>{campaign.clicks} clicks</div>
                      <div className="text-xs text-slate-500">{campaign.ctr}% CTR</div>
                    </td>
                    <td className="py-3">{campaign.priority}</td>
                    <td className="py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statusTone(
                          campaign.status
                        )}`}
                      >
                        {campaign.status.replaceAll("_", " ")}
                      </span>
                    </td>
                  </tr>
                ))}
                {!loading && !campaigns.length ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No campaigns for this city yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
    </article>
  );
}
