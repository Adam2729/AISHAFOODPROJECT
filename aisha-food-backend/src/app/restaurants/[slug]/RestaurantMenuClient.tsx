"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  buildRestaurantWhatsAppText,
  readCustomerCart,
  sanitizeWhatsAppNumber,
  writeCustomerCart,
  type CustomerCartState,
} from "@/lib/customerOrdering";

type CityRow = {
  _id: string;
  code?: string;
  name?: string;
  currency?: string;
};

type MenuItemRow = {
  itemId: string;
  name: string;
  description?: string;
  price: number;
  image?: string;
  category?: string;
};

type MenuResponse = {
  ok?: boolean;
  restaurantId?: string;
  name?: string;
  slug?: string;
  phone?: string | null;
  whatsapp?: string | null;
  logo?: string;
  zoneLabel?: string | null;
  deliveryFee?: number;
  estimatedDeliveryMinutes?: number;
  menu?: MenuItemRow[];
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

function formatMoney(value: number, currencyCode?: string) {
  return `${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ${String(currencyCode || "DOP").toUpperCase()}`;
}

export default function RestaurantMenuClient({
  slug,
  initialCityId,
}: {
  slug: string;
  initialCityId: string;
}) {
  const [cities, setCities] = useState<CityRow[]>([]);
  const [cityId, setCityId] = useState(initialCityId);
  const [restaurant, setRestaurant] = useState<MenuResponse | null>(null);
  const [cart, setCart] = useState<CustomerCartState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedCity = cities.find((row) => String(row._id) === String(cityId)) || null;

  useEffect(() => {
    function syncCart() {
      setCart(readCustomerCart());
    }

    syncCart();
    window.addEventListener("storage", syncCart);
    return () => {
      window.removeEventListener("storage", syncCart);
    };
  }, []);

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
    if (!cityId) return;

    let cancelled = false;

    async function loadMenu() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ cityId });
        const res = await fetch(
          `/api/public/restaurants/${encodeURIComponent(slug)}/menu?${params.toString()}`,
          {
            cache: "no-store",
          }
        );
        const json = (await res.json().catch(() => null)) as MenuResponse | null;
        if (!res.ok || !json?.ok) {
          throw new Error(pickError(json?.error, "Could not load restaurant menu."));
        }
        if (!cancelled) {
          setRestaurant(json);
        }
      } catch (requestError: unknown) {
        if (!cancelled) {
          setRestaurant(null);
          setError(
            requestError instanceof Error ? requestError.message : "Could not load restaurant menu."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadMenu();

    return () => {
      cancelled = true;
    };
  }, [cityId, slug]);

  function persistCart(nextCart: CustomerCartState | null) {
    setCart(nextCart);
    writeCustomerCart(nextCart);
    window.dispatchEvent(new Event("storage"));
  }

  function addToCart(item: MenuItemRow) {
    if (!restaurant?.restaurantId || !restaurant?.slug || !cityId) return;

    const existingCart = cart;
    const differentRestaurant =
      existingCart &&
      (String(existingCart.restaurantId) !== String(restaurant.restaurantId) ||
        String(existingCart.cityId) !== String(cityId));

    if (differentRestaurant) {
      const confirmed = window.confirm(
        "Your cart has items from another restaurant. Replace it with this order?"
      );
      if (!confirmed) return;
    }

    const baseCart: CustomerCartState =
      differentRestaurant || !existingCart
        ? {
            cityId,
            restaurantId: String(restaurant.restaurantId),
            restaurantName: String(restaurant.name || "Restaurant"),
            restaurantSlug: String(restaurant.slug || slug),
            restaurantPhone: restaurant.phone || null,
            restaurantWhatsApp: restaurant.whatsapp || null,
            deliveryFee: Number(restaurant.deliveryFee || 0),
            estimatedDeliveryMinutes: Number(restaurant.estimatedDeliveryMinutes || 30),
            items: [],
          }
        : existingCart;

    const nextItems = [...baseCart.items];
    const existingIndex = nextItems.findIndex((row) => String(row.itemId) === String(item.itemId));
    if (existingIndex >= 0) {
      nextItems[existingIndex] = {
        ...nextItems[existingIndex],
        quantity: Math.max(1, Number(nextItems[existingIndex].quantity || 1) + 1),
      };
    } else {
      nextItems.push({
        itemId: String(item.itemId),
        name: String(item.name || "Item"),
        quantity: 1,
        price: Number(item.price || 0),
        category: String(item.category || "").trim() || null,
        image: String(item.image || "").trim() || null,
      });
    }

    persistCart({
      ...baseCart,
      items: nextItems,
    });
    setNotice(`${item.name} added to cart.`);
  }

  const groupedMenu = new Map<string, MenuItemRow[]>();
  for (const item of restaurant?.menu || []) {
    const category = String(item.category || "").trim() || "Other";
    if (!groupedMenu.has(category)) {
      groupedMenu.set(category, []);
    }
    groupedMenu.get(category)?.push(item);
  }

  const cartCount = Array.isArray(cart?.items)
    ? cart.items.reduce((sum, item) => sum + Math.max(1, Number(item.quantity || 1)), 0)
    : 0;
  const currentRestaurantCart =
    cart &&
    restaurant?.restaurantId &&
    String(cart.restaurantId) === String(restaurant.restaurantId) &&
    String(cart.cityId) === String(cityId)
      ? cart
      : null;
  const whatsappNumber = sanitizeWhatsAppNumber(restaurant?.whatsapp || restaurant?.phone || "");
  const whatsappHref = whatsappNumber
    ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
        buildRestaurantWhatsAppText({
          restaurantName: String(restaurant?.name || "this restaurant"),
          items: currentRestaurantCart?.items || [],
          address: "",
        })
      )}`
    : "";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#fde68a_0%,#fff7ed_32%,#ffffff_78%)]">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={cityId ? `/restaurants?cityId=${encodeURIComponent(cityId)}` : "/restaurants"}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
          >
            Back to restaurants
          </Link>
          <Link
            href={cityId ? `/cart?cityId=${encodeURIComponent(cityId)}` : "/cart"}
            className="rounded-full border border-slate-950 bg-slate-950 px-4 py-2 text-sm font-medium text-white"
          >
            Cart{cartCount > 0 ? ` (${cartCount})` : ""}
          </Link>
        </div>

        <div className="rounded-[32px] border border-amber-200 bg-white/90 p-6 shadow-[0_24px_80px_rgba(120,53,15,0.15)] backdrop-blur">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-amber-700">
                Restaurant Menu
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-slate-950 sm:text-4xl">
                {restaurant?.name || "Loading restaurant"}
              </h1>
              <p className="mt-3 text-sm text-slate-600">
                {restaurant?.zoneLabel || selectedCity?.name || "Active city"} · Delivery in about{" "}
                {Number(restaurant?.estimatedDeliveryMinutes || 30)} minutes
              </p>
            </div>

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
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <article className="rounded-3xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Delivery fee</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">
                {formatMoney(Number(restaurant?.deliveryFee || 0), selectedCity?.currency)}
              </p>
            </article>
            <article className="rounded-3xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">ETA</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">
                {Number(restaurant?.estimatedDeliveryMinutes || 30)} min
              </p>
            </article>
            <article className="rounded-3xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">WhatsApp</p>
              {whatsappHref ? (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex rounded-full border border-amber-300 bg-amber-100 px-4 py-2 text-sm font-medium text-amber-900"
                >
                  Order via WhatsApp
                </a>
              ) : (
                <p className="mt-2 text-sm text-slate-500">WhatsApp contact not available.</p>
              )}
            </article>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        ) : null}

        {loading && !restaurant ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 px-6 py-12 text-center text-sm text-slate-500">
            Loading menu...
          </div>
        ) : null}

        {!loading && restaurant && !(restaurant.menu || []).length ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 px-6 py-12 text-center">
            <h2 className="text-lg font-semibold text-slate-900">Menu unavailable</h2>
            <p className="mt-2 text-sm text-slate-500">
              This restaurant has no active menu items right now.
            </p>
          </div>
        ) : null}

        {Array.from(groupedMenu.entries()).map(([category, items]) => (
          <section key={category} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold text-slate-950">{category}</h2>
                <p className="text-sm text-slate-500">
                  {items.length} item{items.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {items.map((item) => (
                <article
                  key={item.itemId}
                  className="rounded-3xl border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#fffaf0_100%)] p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950">{item.name}</h3>
                      <p className="mt-2 text-sm text-slate-600">
                        {item.description || "Freshly prepared and ready for dispatch."}
                      </p>
                    </div>
                    <div className="rounded-full bg-slate-950 px-3 py-1 text-sm font-semibold text-white">
                      {formatMoney(Number(item.price || 0), selectedCity?.currency)}
                    </div>
                  </div>

                  <div className="mt-5 flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {item.category || "Menu item"}
                    </span>
                    <button
                      type="button"
                      onClick={() => addToCart(item)}
                      className="rounded-full border border-amber-300 bg-amber-100 px-4 py-2 text-sm font-medium text-amber-900"
                    >
                      Add to cart
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </section>
    </main>
  );
}
