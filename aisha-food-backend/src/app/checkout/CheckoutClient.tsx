"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  clearCustomerCart,
  computeCartSubtotal,
  readCustomerCart,
  type CustomerCartState,
} from "@/lib/customerOrdering";
import { paymentMethodLabel, type PaymentMethod } from "@/lib/payment";

type ApiErrorShape = { message?: string };

type CityRow = {
  _id: string;
  name?: string;
  paymentMethods?: string[];
};

type CitiesResponse = {
  ok?: boolean;
  cities?: CityRow[];
  error?: ApiErrorShape | string;
};

type CreateOrderResponse = {
  ok?: boolean;
  orderId?: string;
  status?: string;
  error?: ApiErrorShape | string;
};

type ApplyPromoResponse = {
  ok?: boolean;
  code?: string;
  discount?: number;
  finalSubtotal?: number;
  error?: ApiErrorShape | string;
};

type ValidateReferralResponse = {
  ok?: boolean;
  valid?: boolean;
  reason?: string;
  error?: ApiErrorShape | string;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as ApiErrorShape).message || fallback);
  }
  return fallback;
}

function formatMoney(value: number) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function referralReasonLabel(reason: string) {
  switch (String(reason || "").trim().toUpperCase()) {
    case "INVALID_CODE":
      return "Referral code not found for this city.";
    case "SELF_REFERRAL":
      return "You cannot use your own referral code.";
    case "MISSING_PHONE":
      return "Enter your phone number before validating a referral code.";
    case "MISSING_CODE":
      return "Enter a referral code first.";
    default:
      return "Could not validate referral code.";
  }
}

export default function CheckoutClient({ initialCityId }: { initialCityId: string }) {
  const router = useRouter();
  const [cart, setCart] = useState<CustomerCartState | null>(null);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [promoCode, setPromoCode] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState("");
  const [referralLoading, setReferralLoading] = useState(false);
  const [referralError, setReferralError] = useState("");
  const [referralApplied, setReferralApplied] = useState(false);
  const [promoApplied, setPromoApplied] = useState<{
    code: string;
    discount: number;
    finalSubtotal: number;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCart(readCustomerCart());
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
        if (!cancelled) {
          setCities(Array.isArray(json.cities) ? json.cities : []);
        }
      } catch {
        if (!cancelled) {
          setCities([]);
        }
      }
    }

    loadCities();

    return () => {
      cancelled = true;
    };
  }, []);

  const subtotal = computeCartSubtotal(cart?.items || []);
  const deliveryFee = Number(cart?.deliveryFee || 0);
  const cityId = cart?.cityId || initialCityId;
  const selectedCity = cities.find((row) => String(row._id) === String(cityId)) || null;
  const cityPaymentMethods = Array.isArray(selectedCity?.paymentMethods)
    ? selectedCity?.paymentMethods || []
    : [];
  const mobileMoneyEnabled =
    !cityPaymentMethods.length ||
    cityPaymentMethods.some((value) =>
      ["mobilemoney", "orangemoney", "moovmoney", "wave", "wavemoney"].includes(
        String(value || "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z]/g, "")
      )
    );

  useEffect(() => {
    if (!mobileMoneyEnabled && paymentMethod === "mobile_money") {
      setPaymentMethod("cash");
    }
  }, [mobileMoneyEnabled, paymentMethod]);

  useEffect(() => {
    setPromoApplied(null);
    setPromoError("");
  }, [cityId, subtotal]);

  useEffect(() => {
    setReferralApplied(false);
    setReferralError("");
  }, [cityId, phone]);

  const appliedDiscount = Number(promoApplied?.discount || 0);
  const finalSubtotal = Math.max(0, Number(promoApplied?.finalSubtotal ?? subtotal));
  const finalTotal = finalSubtotal + deliveryFee;

  async function applyPromoCode() {
    if (!cityId) {
      setPromoError("City is missing.");
      return;
    }
    if (!promoCode.trim()) {
      setPromoError("Enter a promo code first.");
      return;
    }

    setPromoLoading(true);
    setPromoError("");
    try {
      const res = await fetch("/api/public/promo/apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-city-id": cityId,
        },
        body: JSON.stringify({
          code: promoCode.trim(),
          orderSubtotal: subtotal,
          cityId,
        }),
      });
      const json = (await res.json().catch(() => null)) as ApplyPromoResponse | null;
      if (!res.ok || !json?.ok || !json.code) {
        throw new Error(pickError(json?.error, "Could not apply promo code."));
      }

      setPromoApplied({
        code: String(json.code || "").trim().toUpperCase(),
        discount: Number(json.discount || 0),
        finalSubtotal: Number(json.finalSubtotal || subtotal),
      });
    } catch (requestError: unknown) {
      setPromoApplied(null);
      setPromoError(
        requestError instanceof Error ? requestError.message : "Could not apply promo code."
      );
    } finally {
      setPromoLoading(false);
    }
  }

  async function validateReferralCode() {
    if (!cityId) {
      setReferralError("City is missing.");
      return;
    }
    if (!referralCode.trim()) {
      setReferralError("Enter a referral code first.");
      return;
    }

    setReferralLoading(true);
    setReferralError("");
    try {
      const res = await fetch("/api/public/referral/validate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-city-id": cityId,
        },
        body: JSON.stringify({
          code: referralCode.trim(),
          phone: phone.trim(),
        }),
      });
      const json = (await res.json().catch(() => null)) as ValidateReferralResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not validate referral code."));
      }
      if (!json.valid) {
        throw new Error(referralReasonLabel(String(json.reason || "")));
      }
      setReferralApplied(true);
    } catch (requestError: unknown) {
      setReferralApplied(false);
      setReferralError(
        requestError instanceof Error
          ? requestError.message
          : "Could not validate referral code."
      );
    } finally {
      setReferralLoading(false);
    }
  }

  async function submitOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cart?.restaurantId || !cart.items.length || !cityId) {
      setError("Cart is empty or city is missing.");
      return;
    }
    if (!customerName.trim() || !phone.trim() || !address.trim()) {
      setError("Name, phone, and address are required.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/public/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-city-id": cityId,
        },
        body: JSON.stringify({
          cityId,
          restaurantId: cart.restaurantId,
          items: cart.items.map((item) => ({
            itemId: item.itemId,
            name: item.name,
            quantity: item.quantity,
            price: item.price,
          })),
          customerName: customerName.trim(),
          phone: phone.trim(),
          address: address.trim(),
          notes: notes.trim(),
          paymentMethod,
          promoCode: promoApplied?.code || undefined,
          referralCode: referralCode.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => null)) as CreateOrderResponse | null;
      if (!res.ok || !json?.ok || !json.orderId) {
        throw new Error(pickError(json?.error, "Could not place order."));
      }

      clearCustomerCart();
      setCart(null);
      router.push(`/order/${encodeURIComponent(json.orderId)}?cityId=${encodeURIComponent(cityId)}`);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not place order.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!cart || !cart.items.length) {
    return (
      <main className="min-h-screen bg-[linear-gradient(180deg,#fff7ed_0%,#ffffff_70%)]">
        <section className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center gap-4 px-4 py-10 text-center">
          <h1 className="text-3xl font-semibold text-slate-950">Checkout is empty</h1>
          <p className="max-w-md text-sm text-slate-600">
            Add items to the cart before placing an order.
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
            href={`/cart?cityId=${encodeURIComponent(cart.cityId)}`}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
          >
            Back to cart
          </Link>
        </div>

        <div className="rounded-[32px] border border-amber-200 bg-white p-6 shadow-[0_24px_80px_rgba(120,53,15,0.12)]">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-amber-700">Checkout</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950">Delivery details</h1>
          <p className="mt-3 text-sm text-slate-600">
            Submit the order as a public customer order in the selected city.
          </p>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <form onSubmit={submitOrder} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="grid gap-4">
              <label className="grid gap-2 text-sm font-medium text-slate-700">
                Name
                <input
                  value={customerName}
                  onChange={(event) => setCustomerName(String(event.target.value || ""))}
                  className="rounded-2xl border border-slate-300 px-4 py-3 outline-none ring-0"
                  placeholder="Your full name"
                />
              </label>

              <label className="grid gap-2 text-sm font-medium text-slate-700">
                Phone
                <input
                  value={phone}
                  onChange={(event) => setPhone(String(event.target.value || ""))}
                  className="rounded-2xl border border-slate-300 px-4 py-3 outline-none ring-0"
                  placeholder="Phone number"
                />
              </label>

              <label className="grid gap-2 text-sm font-medium text-slate-700">
                Address
                <textarea
                  value={address}
                  onChange={(event) => setAddress(String(event.target.value || ""))}
                  rows={4}
                  className="rounded-2xl border border-slate-300 px-4 py-3 outline-none ring-0"
                  placeholder="Delivery address"
                />
              </label>

              <label className="grid gap-2 text-sm font-medium text-slate-700">
                Notes
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(String(event.target.value || ""))}
                  rows={3}
                  className="rounded-2xl border border-slate-300 px-4 py-3 outline-none ring-0"
                  placeholder="Optional notes for the restaurant or rider"
                />
              </label>

              <div className="grid gap-3">
                <p className="text-sm font-medium text-slate-700">Payment method</p>

                {(["cash", "mobile_money"] as PaymentMethod[]).map((method) => {
                  const disabled = method === "mobile_money" && !mobileMoneyEnabled;
                  return (
                    <label
                      key={method}
                      className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-4 ${
                        paymentMethod === method
                          ? "border-slate-950 bg-slate-50"
                          : "border-slate-200 bg-white"
                      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                    >
                      <input
                        type="radio"
                        name="paymentMethod"
                        value={method}
                        checked={paymentMethod === method}
                        onChange={() => setPaymentMethod(method)}
                        disabled={disabled}
                        className="mt-1"
                      />
                      <span>
                        <span className="block text-sm font-semibold text-slate-950">
                          {paymentMethodLabel(method)}
                        </span>
                        <span className="mt-1 block text-sm text-slate-500">
                          {method === "cash"
                            ? "Pay in cash when the order is delivered."
                            : mobileMoneyEnabled
                              ? "Creates a pending mobile money payment placeholder."
                              : "Mobile money is not enabled for this city yet."}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>

              <div className="grid gap-3 rounded-3xl border border-amber-200 bg-amber-50/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-700">Promo code</p>
                    <p className="text-xs text-slate-500">
                      Apply a city promo before placing the order.
                    </p>
                  </div>
                  {promoApplied ? (
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                      {promoApplied.code}
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    value={promoCode}
                    onChange={(event) => setPromoCode(String(event.target.value || "").toUpperCase())}
                    className="min-w-0 flex-1 rounded-2xl border border-slate-300 px-4 py-3 outline-none ring-0"
                    placeholder="Enter promo code"
                  />
                  <button
                    type="button"
                    onClick={applyPromoCode}
                    disabled={promoLoading || !promoCode.trim()}
                    className="rounded-full border border-slate-950 px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {promoLoading ? "Applying..." : "Apply"}
                  </button>
                </div>

                {promoError ? (
                  <p className="text-sm text-red-600">{promoError}</p>
                ) : null}
                {promoApplied ? (
                  <p className="text-sm text-emerald-700">
                    {promoApplied.code} applied. Discount: {formatMoney(appliedDiscount)}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-3 rounded-3xl border border-sky-200 bg-sky-50/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-700">Referral code</p>
                    <p className="text-xs text-slate-500">
                      Optional. Referral rewards are credited after a successful delivery.
                    </p>
                  </div>
                  {referralApplied ? (
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                      Validated
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    value={referralCode}
                    onChange={(event) => {
                      setReferralCode(String(event.target.value || "").toUpperCase());
                      setReferralApplied(false);
                      setReferralError("");
                    }}
                    className="min-w-0 flex-1 rounded-2xl border border-slate-300 px-4 py-3 outline-none ring-0"
                    placeholder="Enter referral code"
                  />
                  <button
                    type="button"
                    onClick={validateReferralCode}
                    disabled={referralLoading || !referralCode.trim()}
                    className="rounded-full border border-slate-950 px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {referralLoading ? "Checking..." : "Validate"}
                  </button>
                </div>

                {referralError ? (
                  <p className="text-sm text-red-600">{referralError}</p>
                ) : null}
                {referralApplied ? (
                  <p className="text-sm text-emerald-700">
                    Referral accepted. Reward processing happens after delivery.
                  </p>
                ) : null}
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Placing order..." : "Place order"}
            </button>
          </form>

          <aside className="rounded-3xl border border-slate-200 bg-slate-950 p-6 text-white shadow-[0_24px_60px_rgba(15,23,42,0.28)]">
            <h2 className="text-xl font-semibold">{cart.restaurantName}</h2>

            <div className="mt-5 space-y-3 text-sm">
              {cart.items.map((item) => (
                <div key={item.itemId} className="flex items-center justify-between gap-3">
                  <span className="text-slate-300">
                    {item.name} x{Math.max(1, Number(item.quantity || 1))}
                  </span>
                  <span>
                    {formatMoney(Number(item.price || 0) * Math.max(1, Number(item.quantity || 1)))}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-6 space-y-3 border-t border-slate-700 pt-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Subtotal</span>
                <span>{formatMoney(subtotal)}</span>
              </div>
              {promoApplied ? (
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">Promo discount</span>
                  <span>-{formatMoney(appliedDiscount)}</span>
                </div>
              ) : null}
              {promoApplied ? (
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">Subtotal after promo</span>
                  <span>{formatMoney(finalSubtotal)}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Delivery fee</span>
                <span>{formatMoney(deliveryFee)}</span>
              </div>
              <div className="flex items-center justify-between text-base font-semibold">
                <span>Total</span>
                <span>{formatMoney(finalTotal)}</span>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
