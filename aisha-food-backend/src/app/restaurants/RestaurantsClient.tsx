"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readCustomerCart } from "@/lib/customerOrdering";

type CityRow = {
  _id: string;
  code?: string;
  name?: string;
  currency?: string;
};

type RestaurantRow = {
  restaurantId: string;
  name: string;
  slug: string;
  logo?: string;
  zoneLabel?: string | null;
  deliveryFee: number;
  estimatedDeliveryMinutes: number;
  sponsored?: boolean;
  campaignId?: string | null;
  adPriority?: number | null;
  averageRating?: number;
  distanceKm?: number | null;
};

type ApiErrorShape = { message?: string };

type CitiesResponse = {
  ok?: boolean;
  cities?: CityRow[];
  error?: ApiErrorShape | string;
};

type RestaurantsResponse = {
  ok?: boolean;
  rows?: RestaurantRow[];
  error?: ApiErrorShape | string;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as ApiErrorShape).message || fallback);
  }
  return fallback;
}

function formatMoney(value: number, currencyCode?: string) {
  return `${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ${String(currencyCode || "DOP").toUpperCase()}`;
}

export default function RestaurantsClient({
  initialCityId,
  initialQuery,
}: {
  initialCityId: string;
  initialQuery: string;
}) {
  const [cities, setCities] = useState<CityRow[]>([]);
  const [cityId, setCityId] = useState(initialCityId);
  const [query, setQuery] = useState(initialQuery);
  const [restaurants, setRestaurants] = useState<RestaurantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cartCount, setCartCount] = useState(0);

  const selectedCity = cities.find((row) => String(row._id) === String(cityId)) || null;

  useEffect(() => {
    let cancelled = false;

    async function loadCities() {
      try {
        const res = await fetch("/api/public/cities", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as CitiesResponse | null;
        if (!res.ok || !json?.ok) {
          throw new Error(pickError(json?.error, "Could not load cities."));
        }
        if (cancelled) return;
        const rows = Array.isArray(json.cities) ? json.cities : [];
        setCities(rows);
        if (!cityId && rows.length) {
          setCityId(String(rows[0]._id));
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

  useEffect(() => {
    function syncCartCount() {
      const cart = readCustomerCart();
      const totalItems = Array.isArray(cart?.items)
        ? cart.items.reduce((sum, item) => sum + Math.max(1, Number(item.quantity || 1)), 0)
        : 0;
      setCartCount(totalItems);
    }

    syncCartCount();
    window.addEventListener("storage", syncCartCount);
    return () => {
      window.removeEventListener("storage", syncCartCount);
    };
  }, []);

  useEffect(() => {
    if (!cityId) return;

    const timeoutId = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          cityId,
          limit: "50",
          skip: "0",
        });
        if (query.trim()) params.set("q", query.trim());

        const res = await fetch(`/api/public/restaurants?${params.toString()}`, {
          cache: "no-store",
        });
        const json = (await res.json().catch(() => null)) as RestaurantsResponse | null;
        if (!res.ok || !json?.ok) {
          throw new Error(pickError(json?.error, "Could not load restaurants."));
        }
        setRestaurants(Array.isArray(json.rows) ? json.rows : []);
      } catch (requestError: unknown) {
        setRestaurants([]);
        setError(
          requestError instanceof Error ? requestError.message : "Could not load restaurants."
        );
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [cityId, query]);

  function trackSponsoredClick(restaurant: RestaurantRow) {
    if (!restaurant.sponsored || !restaurant.campaignId || !cityId) return;
    const payload = JSON.stringify({
      cityId,
      campaignId: restaurant.campaignId,
      businessId: restaurant.restaurantId,
    });

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon("/api/public/ads/click", blob);
      return;
    }

    void fetch("/api/public/ads/click", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: payload,
      keepalive: true,
    }).catch(() => null);
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fff8ee_0%,#fffdf8_55%,#ffffff_100%)]">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="rounded-[28px] border border-amber-200 bg-white/90 p-6 shadow-[0_24px_80px_rgba(146,64,14,0.12)] backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-amber-700">
                Customer Ordering
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-slate-950 sm:text-4xl">
                Browse restaurants by city
              </h1>
              <p className="mt-3 text-sm text-slate-600 sm:text-base">
                Pick an active city, search the live restaurant list, and jump straight into menu and checkout.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={cityId ? `/cart?cityId=${encodeURIComponent(cityId)}` : "/cart"}
                className="rounded-full border border-slate-300 bg-slate-950 px-4 py-2 text-sm font-medium text-white"
              >
                Cart{cartCount > 0 ? ` (${cartCount})` : ""}
              </Link>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
            <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
              City
              <select
                value={cityId}
                onChange={(event) => setCityId(String(event.target.value || ""))}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none ring-0"
              >
                <option value="">Select city</option>
                {cities.map((city) => (
                  <option key={city._id} value={city._id}>
                    {city.name || city.code || city._id}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
              Search restaurants
              <input
                value={query}
                onChange={(event) => setQuery(String(event.target.value || ""))}
                placeholder="Search by name, address, or zone"
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none ring-0"
              />
            </label>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">
              {selectedCity?.name || "Restaurants"}
            </h2>
            <p className="text-sm text-slate-500">
              {loading
                ? "Refreshing list..."
                : `${restaurants.length} restaurant${restaurants.length === 1 ? "" : "s"} loaded`}
            </p>
          </div>
        </div>

        {loading && !restaurants.length ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 px-6 py-12 text-center text-sm text-slate-500">
            Loading restaurants...
          </div>
        ) : null}

        {!loading && !restaurants.length ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 px-6 py-12 text-center">
            <h3 className="text-lg font-semibold text-slate-900">No restaurants found</h3>
            <p className="mt-2 text-sm text-slate-500">
              Try a different city or clear the search term.
            </p>
          </div>
        ) : null}

        {restaurants.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {restaurants.map((restaurant) => (
              <Link
                key={restaurant.restaurantId}
                href={`/restaurants/${encodeURIComponent(restaurant.slug)}?cityId=${encodeURIComponent(cityId)}`}
                onClick={() => trackSponsoredClick(restaurant)}
                className="group rounded-[28px] border border-amber-100 bg-white p-5 shadow-[0_16px_50px_rgba(148,163,184,0.12)] transition hover:-translate-y-1 hover:shadow-[0_24px_64px_rgba(120,53,15,0.18)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
                        {restaurant.zoneLabel || selectedCity?.code || "Local"}
                      </p>
                      {restaurant.sponsored ? (
                        <span className="rounded-full bg-amber-500 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white">
                          Sponsorisé
                        </span>
                      ) : null}
                    </div>
                    <h3 className="mt-2 text-xl font-semibold text-slate-950">
                      {restaurant.name}
                    </h3>
                  </div>
                  <div className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                    {restaurant.estimatedDeliveryMinutes} min
                  </div>
                </div>

                <div className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                  <div className="flex items-center justify-between">
                    <span>Delivery fee</span>
                    <span className="font-medium text-slate-900">
                      {formatMoney(restaurant.deliveryFee, selectedCity?.currency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Estimated delivery</span>
                    <span className="font-medium text-slate-900">
                      {restaurant.estimatedDeliveryMinutes} minutes
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Rating</span>
                    <span className="font-medium text-slate-900">
                      {Number(restaurant.averageRating || 0) > 0
                        ? `${Number(restaurant.averageRating || 0).toFixed(1)} / 5`
                        : "New"}
                    </span>
                  </div>
                </div>

                <div className="mt-5 inline-flex items-center text-sm font-medium text-slate-950">
                  Open restaurant
                  <span className="ml-2 transition group-hover:translate-x-1">-&gt;</span>
                </div>
              </Link>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
