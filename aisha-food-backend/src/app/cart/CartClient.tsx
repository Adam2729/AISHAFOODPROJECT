"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  clearCustomerCart,
  computeCartSubtotal,
  readCustomerCart,
  writeCustomerCart,
  type CustomerCartState,
} from "@/lib/customerOrdering";

function formatMoney(value: number) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export default function CartClient({ initialCityId }: { initialCityId: string }) {
  const [cart, setCart] = useState<CustomerCartState | null>(null);

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

  function persistCart(nextCart: CustomerCartState | null) {
    setCart(nextCart);
    writeCustomerCart(nextCart);
    window.dispatchEvent(new Event("storage"));
  }

  function updateQuantity(itemId: string, nextQuantity: number) {
    if (!cart) return;
    const nextItems = cart.items
      .map((item) =>
        String(item.itemId) === String(itemId)
          ? { ...item, quantity: Math.max(0, Number(nextQuantity || 0)) }
          : item
      )
      .filter((item) => Number(item.quantity || 0) > 0);

    if (!nextItems.length) {
      clearCustomerCart();
      setCart(null);
      window.dispatchEvent(new Event("storage"));
      return;
    }

    persistCart({
      ...cart,
      items: nextItems,
    });
  }

  const subtotal = computeCartSubtotal(cart?.items || []);
  const deliveryFee = Number(cart?.deliveryFee || 0);
  const total = subtotal + deliveryFee;
  const cityId = cart?.cityId || initialCityId;

  if (!cart || !cart.items.length) {
    return (
      <main className="min-h-screen bg-[linear-gradient(180deg,#fff7ed_0%,#ffffff_70%)]">
        <section className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center gap-4 px-4 py-10 text-center">
          <h1 className="text-3xl font-semibold text-slate-950">Your cart is empty</h1>
          <p className="max-w-md text-sm text-slate-600">
            Add menu items from a restaurant before checkout.
          </p>
          <Link
            href={cityId ? `/restaurants?cityId=${encodeURIComponent(cityId)}` : "/restaurants"}
            className="rounded-full border border-slate-950 bg-slate-950 px-5 py-3 text-sm font-medium text-white"
          >
            Browse restaurants
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fff7ed_0%,#ffffff_70%)]">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/restaurants/${encodeURIComponent(cart.restaurantSlug)}?cityId=${encodeURIComponent(cart.cityId)}`}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
          >
            Back to menu
          </Link>
          <button
            type="button"
            onClick={() => {
              clearCustomerCart();
              setCart(null);
              window.dispatchEvent(new Event("storage"));
            }}
            className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700"
          >
            Clear cart
          </button>
        </div>

        <div className="rounded-[32px] border border-amber-200 bg-white p-6 shadow-[0_24px_80px_rgba(120,53,15,0.12)]">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-amber-700">Cart</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950">{cart.restaurantName}</h1>
          <p className="mt-3 text-sm text-slate-600">
            {cart.items.length} item{cart.items.length === 1 ? "" : "s"} · Delivery in about{" "}
            {Number(cart.estimatedDeliveryMinutes || 30)} minutes
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-4">
            {cart.items.map((item) => (
              <article
                key={item.itemId}
                className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">{item.name}</h2>
                    <p className="mt-1 text-sm text-slate-500">{item.category || "Menu item"}</p>
                    <p className="mt-3 text-sm font-medium text-slate-900">
                      {formatMoney(Number(item.price || 0))} each
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        updateQuantity(String(item.itemId), Math.max(0, Number(item.quantity || 1) - 1))
                      }
                      className="h-10 w-10 rounded-full border border-slate-300 bg-white text-lg text-slate-700"
                    >
                      -
                    </button>
                    <div className="min-w-12 text-center text-lg font-semibold text-slate-950">
                      {Math.max(1, Number(item.quantity || 1))}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateQuantity(String(item.itemId), Math.max(1, Number(item.quantity || 1) + 1))
                      }
                      className="h-10 w-10 rounded-full border border-slate-300 bg-white text-lg text-slate-700"
                    >
                      +
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>

          <aside className="rounded-3xl border border-slate-200 bg-slate-950 p-6 text-white shadow-[0_24px_60px_rgba(15,23,42,0.28)]">
            <h2 className="text-xl font-semibold">Order summary</h2>

            <div className="mt-6 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Subtotal</span>
                <span>{formatMoney(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Delivery fee</span>
                <span>{formatMoney(deliveryFee)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-700 pt-3 text-base font-semibold">
                <span>Total</span>
                <span>{formatMoney(total)}</span>
              </div>
            </div>

            <Link
              href={`/checkout?cityId=${encodeURIComponent(cart.cityId)}`}
              className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-amber-300 px-5 py-3 text-sm font-semibold text-slate-950"
            >
              Checkout
            </Link>
          </aside>
        </div>
      </section>
    </main>
  );
}
