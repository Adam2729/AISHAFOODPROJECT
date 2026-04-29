"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ApiErrorShape = { message?: string };

type CityRow = {
  _id: string;
  code?: string;
  name?: string;
};

type CitiesResponse = {
  ok?: boolean;
  cities?: CityRow[];
  error?: ApiErrorShape | string;
};

type LoyaltyResponse = {
  ok?: boolean;
  cityId?: string;
  points?: number;
  lifetimeOrders?: number;
  lifetimeSpend?: number;
  referralCode?: string | null;
  walletBalance?: number;
  error?: ApiErrorShape | string;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as ApiErrorShape).message || fallback);
  }
  return fallback;
}

function formatMoney(value: unknown) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export default function LoyaltyPage() {
  const [cities, setCities] = useState<CityRow[]>([]);
  const [cityId, setCityId] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<LoyaltyResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCities() {
      try {
        const res = await fetch("/api/public/cities", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as CitiesResponse | null;
        if (!res.ok || !json?.ok) {
          throw new Error(pickError(json?.error, "Could not load cities."));
        }
        if (!cancelled) {
          const rows = Array.isArray(json.cities) ? json.cities : [];
          setCities(rows);
          if (!cityId && rows.length) {
            setCityId(String(rows[0]._id || ""));
          }
        }
      } catch (requestError: unknown) {
        if (!cancelled) {
          setError(
            requestError instanceof Error ? requestError.message : "Could not load cities."
          );
        }
      }
    }

    loadCities();

    return () => {
      cancelled = true;
    };
  }, [cityId]);

  async function loadLoyaltyProfile() {
    if (!phone.trim()) {
      setError("Phone is required.");
      return;
    }
    if (!cityId) {
      setError("Select a city first.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        phone: phone.trim(),
        cityId,
      });
      const res = await fetch(`/api/public/loyalty?${params.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as LoyaltyResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not load loyalty profile."));
      }
      setProfile(json);
    } catch (requestError: unknown) {
      setProfile(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load loyalty profile."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#ecfeff_0%,#ffffff_65%)]">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-700">
              Customer Loyalty
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-950">Check your rewards</h1>
          </div>
          <Link
            href={cityId ? `/restaurants?cityId=${encodeURIComponent(cityId)}` : "/restaurants"}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
          >
            Browse restaurants
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Lookup</h2>
            <p className="mt-2 text-sm text-slate-600">
              Enter your phone number to view loyalty points, wallet balance, and your referral code.
            </p>

            <div className="mt-5 grid gap-4">
              <label className="grid gap-2 text-sm font-medium text-slate-700">
                City
                <select
                  value={cityId}
                  onChange={(event) => setCityId(String(event.target.value || ""))}
                  className="rounded-2xl border border-slate-300 px-4 py-3 outline-none ring-0"
                >
                  <option value="">Select city</option>
                  {cities.map((city) => (
                    <option key={city._id} value={city._id}>
                      {city.name || city.code || city._id}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm font-medium text-slate-700">
                Phone
                <input
                  value={phone}
                  onChange={(event) => setPhone(String(event.target.value || ""))}
                  className="rounded-2xl border border-slate-300 px-4 py-3 outline-none ring-0"
                  placeholder="Enter your phone number"
                />
              </label>

              <button
                type="button"
                onClick={loadLoyaltyProfile}
                disabled={loading}
                className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Loading..." : "Check loyalty"}
              </button>
            </div>

            {error ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <Card
              label="Points"
              value={String(Number(profile?.points || 0))}
              hint="Earned on delivered orders and referrals"
            />
            <Card
              label="Wallet balance"
              value={formatMoney(profile?.walletBalance || 0)}
              hint="City wallet credits"
            />
            <Card
              label="Lifetime orders"
              value={String(Number(profile?.lifetimeOrders || 0))}
              hint="Delivered orders counted for loyalty"
            />
            <Card
              label="Lifetime spend"
              value={formatMoney(profile?.lifetimeSpend || 0)}
              hint="Delivered order spend total"
            />

            <article className="sm:col-span-2 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Referral code
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">
                {profile?.referralCode || "Load your loyalty profile to generate your code"}
              </p>
              <p className="mt-3 text-sm text-slate-600">
                Share this code with friends. Rewards are credited after their first successful delivery.
              </p>
            </article>
          </section>
        </div>
      </section>
    </main>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-950">{value}</p>
      <p className="mt-2 text-sm text-slate-600">{hint}</p>
    </article>
  );
}
