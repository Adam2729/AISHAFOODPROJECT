"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { paymentMethodLabel, paymentStatusLabel } from "@/lib/payment";

type CityRow = {
  _id: string;
  code?: string;
  name?: string;
};

type CitiesResponse = {
  ok?: boolean;
  cities?: CityRow[];
  error?: { message?: string } | string;
};

type StatusResponse = {
  ok?: boolean;
  orderId?: string;
  status?: string;
  driverName?: string | null;
  driverPhone?: string | null;
  etaMinutes?: number | null;
  loyaltyPointsPending?: number | null;
  referralCodeUsed?: string | null;
  referralRewardPending?: boolean;
  error?: { message?: string } | string;
};

type PaymentEventRow = {
  method?: string | null;
  status?: string | null;
  amount?: number | null;
  provider?: string | null;
  reference?: string | null;
  createdAt?: string | Date | null;
};

type PaymentResponse = {
  ok?: boolean;
  orderId?: string;
  payment?: {
    method?: string | null;
    status?: string | null;
    paidAt?: string | Date | null;
    provider?: string | null;
    reference?: string | null;
  } | null;
  events?: PaymentEventRow[];
  error?: { message?: string } | string;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

function statusLabel(status: string) {
  switch (String(status || "").trim()) {
    case "accepted":
      return "Accepted";
    case "preparing":
      return "Preparing";
    case "ready":
      return "Ready";
    case "out_for_delivery":
      return "Out for delivery";
    case "delivered":
      return "Delivered";
    case "cancelled":
      return "Cancelled";
    default:
      return "Order received";
  }
}

function isStepActive(step: string, currentStatus: string, hasDriver: boolean) {
  const status = String(currentStatus || "new");
  if (step === "received") return true;
  if (step === "preparing") {
    return ["accepted", "preparing", "ready", "out_for_delivery", "delivered"].includes(status);
  }
  if (step === "driver_assigned") {
    return hasDriver || ["out_for_delivery", "delivered"].includes(status);
  }
  if (step === "out_for_delivery") {
    return ["out_for_delivery", "delivered"].includes(status);
  }
  if (step === "delivered") {
    return status === "delivered";
  }
  return false;
}

export default function OrderTrackingClient({
  orderId,
  initialCityId,
}: {
  orderId: string;
  initialCityId: string;
}) {
  const [cities, setCities] = useState<CityRow[]>([]);
  const [cityId, setCityId] = useState(initialCityId);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [payment, setPayment] = useState<PaymentResponse["payment"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  const selectedCity = cities.find((row) => String(row._id) === String(cityId)) || null;
  const hasDriver = Boolean(status?.driverName || status?.driverPhone);
  const timeline = [
    { key: "received", label: "Order received" },
    { key: "preparing", label: "Preparing" },
    { key: "driver_assigned", label: "Driver assigned" },
    { key: "out_for_delivery", label: "Out for delivery" },
    { key: "delivered", label: "Delivered" },
  ];

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

    async function loadStatus() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ cityId });
        const [statusRes, paymentRes] = await Promise.all([
          fetch(`/api/public/orders/${encodeURIComponent(orderId)}/status?${params.toString()}`, {
            cache: "no-store",
          }),
          fetch(`/api/public/orders/${encodeURIComponent(orderId)}/payment?${params.toString()}`, {
            cache: "no-store",
          }),
        ]);
        const statusJson = (await statusRes.json().catch(() => null)) as StatusResponse | null;
        const paymentJson = (await paymentRes.json().catch(() => null)) as PaymentResponse | null;
        if (!statusRes.ok || !statusJson?.ok) {
          throw new Error(pickError(statusJson?.error, "Could not load order status."));
        }
        if (!paymentRes.ok || !paymentJson?.ok) {
          throw new Error(pickError(paymentJson?.error, "Could not load payment status."));
        }
        if (!cancelled) {
          setStatus(statusJson);
          setPayment(paymentJson?.payment || null);
        }
      } catch (requestError: unknown) {
        if (!cancelled) {
          setStatus(null);
          setPayment(null);
          setError(
            requestError instanceof Error ? requestError.message : "Could not load order status."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadStatus();
    const intervalId = window.setInterval(loadStatus, 20000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [cityId, orderId, refreshTick]);

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#fff7ed_45%,#ffffff_100%)]">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={cityId ? `/restaurants?cityId=${encodeURIComponent(cityId)}` : "/restaurants"}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
          >
            Browse restaurants
          </Link>
          <button
            type="button"
            onClick={() => setRefreshTick((value) => value + 1)}
            className="rounded-full border border-slate-950 bg-slate-950 px-4 py-2 text-sm font-medium text-white"
          >
            Refresh
          </button>
        </div>

        <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_24px_80px_rgba(148,163,184,0.16)]">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                Order Tracking
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-slate-950">Order {orderId}</h1>
              <p className="mt-3 text-sm text-slate-600">
                Current status: {statusLabel(String(status?.status || "new"))}
              </p>
            </div>

            <label className="grid gap-2 text-sm font-medium text-slate-700">
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
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {Number(status?.loyaltyPointsPending || 0) > 0 &&
        !["delivered", "cancelled"].includes(String(status?.status || "")) ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Earn {Number(status?.loyaltyPointsPending || 0)} loyalty points after this order is
            delivered.
          </div>
        ) : null}

        {status?.referralCodeUsed && Boolean(status?.referralRewardPending) ? (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
            Referral code {status.referralCodeUsed} was applied. Referral rewards are processed
            after a successful delivery.
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-slate-950">Status timeline</h2>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                {loading ? "Updating" : selectedCity?.name || "City not set"}
              </span>
            </div>

            <div className="mt-6 space-y-4">
              {timeline.map((step) => {
                const active = isStepActive(step.key, String(status?.status || "new"), hasDriver);
                return (
                  <div
                    key={step.key}
                    className={`flex items-center gap-4 rounded-2xl border px-4 py-4 ${
                      active
                        ? "border-emerald-200 bg-emerald-50"
                        : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div
                      className={`h-4 w-4 rounded-full ${
                        active ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                    />
                    <div>
                      <p className="font-medium text-slate-950">{step.label}</p>
                      <p className="text-sm text-slate-500">
                        {active ? "Reached" : "Pending"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {String(status?.status || "") === "cancelled" ? (
              <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                This order was cancelled.
              </div>
            ) : null}
          </section>

          <aside className="space-y-4">
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Driver</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">
                {status?.driverName || "Waiting for assignment"}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                {status?.driverPhone || "Phone will appear once a driver is assigned."}
              </p>
            </article>

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">ETA</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">
                {status?.etaMinutes != null ? `${Number(status.etaMinutes)} min` : "Pending"}
              </p>
            </article>

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">
                {paymentMethodLabel(payment?.method || "cash")}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                {paymentStatusLabel(payment?.status || "pending")}
                {payment?.paidAt ? ` - Paid at ${new Date(payment.paidAt).toLocaleString()}` : ""}
              </p>
              {payment?.provider ? (
                <p className="mt-2 text-xs text-slate-500">Provider: {payment.provider}</p>
              ) : null}
            </article>
          </aside>
        </div>
      </section>
    </main>
  );
}
