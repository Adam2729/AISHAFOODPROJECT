"use client";

import { useEffect, useMemo, useState } from "react";

type DriverOrderRow = {
  orderId: string;
  orderNumber: string;
  businessName: string;
  customerName?: string;
  customerPhone?: string;
  address: string;
  status: string;
  totals?: { total?: number };
  createdAt?: string | Date | null;
  dispatch?: {
    pickupConfirmedAt?: string | Date | null;
    deliveredConfirmedAt?: string | Date | null;
  };
  deliveryProof?: {
    required?: boolean;
    otpLast4?: string | null;
    verifiedAt?: string | Date | null;
  };
};

type OrdersResponse = {
  ok?: boolean;
  city?: { cityId?: string; code?: string; name?: string };
  driver?: {
    id?: string;
    name?: string;
    zoneLabel?: string | null;
    availability?: string | null;
    lastSeenAt?: string | Date | null;
  };
  orders?: DriverOrderRow[];
  error?: { message?: string } | string;
};

type StatusResponse = {
  ok?: boolean;
  changed?: boolean;
  finalized?: boolean;
  idempotent?: boolean;
  status?: string;
  dispatch?: {
    pickupConfirmedAt?: string | Date | null;
    deliveredConfirmedAt?: string | Date | null;
  };
  error?: { message?: string } | string;
};

type AuditResponse = {
  ok?: boolean;
  error?: { message?: string } | string;
};

type AvailabilityResponse = {
  ok?: boolean;
  driverId?: string;
  cityId?: string;
  availability?: "offline" | "available" | "busy" | "paused";
  error?: { message?: string } | string;
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
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function formatMoney(value: unknown) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function displayStatus(status: string) {
  if (status === "out_for_delivery") return "Out for delivery";
  return status || "-";
}

export default function DriverDashboardClient({ cityId }: { cityId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [city, setCity] = useState<{ cityId?: string; code?: string; name?: string } | null>(null);
  const [driver, setDriver] = useState<{
    id?: string;
    name?: string;
    zoneLabel?: string | null;
    availability?: string | null;
    lastSeenAt?: string | Date | null;
  } | null>(null);
  const [orders, setOrders] = useState<DriverOrderRow[]>([]);
  const [busyOrderId, setBusyOrderId] = useState("");
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [problemText, setProblemText] = useState<Record<string, string>>({});
  const [deliveryOtpText, setDeliveryOtpText] = useState<Record<string, string>>({});

  const cityQuery = useMemo(
    () => (cityId ? `?cityId=${encodeURIComponent(cityId)}` : ""),
    [cityId]
  );

  async function loadOrders() {
    if (!cityId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/driver/orders${cityQuery}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as OrdersResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not load assigned jobs."));
      }
      setCity(json.city || null);
      setDriver(json.driver || null);
      setOrders(Array.isArray(json.orders) ? json.orders : []);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not load assigned jobs."
      );
      setOrders([]);
      setCity(null);
      setDriver(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrders();
  }, [cityId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function updateStatus(
    orderId: string,
    action: "picked_up" | "delivered",
    deliveryOtp = ""
  ) {
    if (!cityId || !orderId) return;
    setBusyOrderId(orderId);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(
        `/api/driver/orders/${encodeURIComponent(orderId)}/status?cityId=${encodeURIComponent(cityId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            deliveryOtp: String(deliveryOtp || "").trim() || undefined,
          }),
        }
      );
      const json = (await res.json().catch(() => null)) as StatusResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Status update failed."));
      }

      if (action === "picked_up") {
        setSuccess("Status updated to out for delivery.");
      } else if (json?.finalized || json?.status === "delivered") {
        setSuccess(
          json?.idempotent
            ? "Delivery was already finalized."
            : "Delivery finalized with the customer OTP."
        );
        setDeliveryOtpText((prev) => ({ ...prev, [orderId]: "" }));
      } else {
        setSuccess("Handoff confirmed. Merchant can still finalize later if OTP is unavailable.");
      }

      await loadOrders();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Status update failed.");
    } finally {
      setBusyOrderId("");
    }
  }

  async function reportProblem(orderId: string) {
    if (!cityId || !orderId) return;
    const note = String(problemText[orderId] || "").trim().slice(0, 280);
    if (!note) {
      setError("Enter a short note to report the problem.");
      return;
    }
    setBusyOrderId(orderId);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/driver/audit?cityId=${encodeURIComponent(cityId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "PROBLEM",
          note,
          orderId,
        }),
      });
      const json = (await res.json().catch(() => null)) as AuditResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not report problem."));
      }
      setProblemText((prev) => ({ ...prev, [orderId]: "" }));
      setSuccess("Problem reported to ops.");
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not report problem."
      );
    } finally {
      setBusyOrderId("");
    }
  }

  async function updateAvailability(nextAvailability: "offline" | "available" | "busy" | "paused") {
    if (!cityId) return;
    setAvailabilityBusy(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/driver/availability?cityId=${encodeURIComponent(cityId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availability: nextAvailability }),
      });
      const json = (await res.json().catch(() => null)) as AvailabilityResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not update availability."));
      }
      setDriver((prev) =>
        prev
          ? {
              ...prev,
              availability: nextAvailability,
              lastSeenAt: new Date().toISOString(),
            }
          : prev
      );
      setSuccess(`Availability updated to ${nextAvailability}.`);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not update availability."
      );
    } finally {
      setAvailabilityBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h1 className="text-xl font-semibold">Driver Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          City: {city?.name || "-"} ({String(city?.code || "").toUpperCase() || "-"})
        </p>
        <p className="text-sm text-slate-600">
          Driver: {driver?.name || "-"} {driver?.zoneLabel ? `- ${driver.zoneLabel}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold uppercase text-slate-700">
            {String(driver?.availability || "offline")}
          </span>
          {(["offline", "available", "busy", "paused"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => updateAvailability(value)}
              disabled={availabilityBusy || driver?.availability === value}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              {availabilityBusy && driver?.availability !== value ? "Saving..." : value}
            </button>
          ))}
        </div>
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
          <p className="font-semibold">Delivery confirmation flow</p>
          <p className="mt-1">
            Preferred flow: enter the customer OTP here to close the order when you arrive. If the
            OTP is not available yet, you can still record the handoff and the merchant can
            finalize later as a fallback.
          </p>
        </div>
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Active deliveries</h2>
          <button
            type="button"
            onClick={loadOrders}
            disabled={loading}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm font-semibold"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {!orders.length ? (
          <p className="text-sm text-slate-600">No assigned orders right now.</p>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => {
              const isBusy = busyOrderId === order.orderId;
              const isFinal = order.status === "delivered" || order.status === "cancelled";
              const driverConfirmed = Boolean(order.dispatch?.deliveredConfirmedAt);
              const otpVerified = Boolean(order.deliveryProof?.verifiedAt);
              const statusLabel =
                order.status === "delivered"
                  ? "Delivered"
                  : otpVerified
                    ? "OTP verified"
                    : driverConfirmed
                      ? "Handoff confirmed - awaiting OTP finalization"
                      : displayStatus(order.status);

              return (
                <article
                  key={order.orderId}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">
                        #{order.orderNumber || "-"} - {order.businessName || "-"}
                      </p>
                      <p className="text-xs text-slate-600">
                        {order.customerName || "Customer"}{" "}
                        {order.customerPhone ? `- ${order.customerPhone}` : ""}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold uppercase">
                      {statusLabel}
                    </span>
                  </div>

                  <p className="mt-2 text-sm text-slate-700">{order.address || "-"}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Total: {formatMoney(order.totals?.total)} | Created: {formatDate(order.createdAt)}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => updateStatus(order.orderId, "picked_up")}
                      disabled={isBusy || isFinal}
                      className="rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      Picked up / Out for delivery
                    </button>
                  </div>

                  <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-emerald-900">
                        Customer OTP
                        {order.deliveryProof?.otpLast4
                          ? ` (last 4: ${order.deliveryProof.otpLast4})`
                          : ""}
                      </p>
                      {order.deliveryProof?.verifiedAt ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-800">
                          Verified {formatDate(order.deliveryProof.verifiedAt)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <input
                        value={deliveryOtpText[order.orderId] || ""}
                        onChange={(event) =>
                          setDeliveryOtpText((prev) => ({
                            ...prev,
                            [order.orderId]: event.target.value.replace(/\D/g, "").slice(0, 6),
                          }))
                        }
                        placeholder="Enter 6-digit customer OTP"
                        inputMode="numeric"
                        className="w-full rounded border border-emerald-200 bg-white px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          updateStatus(
                            order.orderId,
                            "delivered",
                            String(deliveryOtpText[order.orderId] || "")
                          )
                        }
                        disabled={
                          isBusy ||
                          isFinal ||
                          String(deliveryOtpText[order.orderId] || "").trim().length !== 6
                        }
                        className="rounded bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Verify OTP and close order
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-emerald-900">
                      Ask the customer for the 6-digit code before closing the order.
                    </p>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => updateStatus(order.orderId, "delivered")}
                      disabled={isBusy || isFinal}
                      className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                    >
                      Confirm handoff only
                    </button>
                  </div>

                  <p className="mt-2 text-[11px] text-slate-500">
                    Use handoff only if you cannot get the OTP right away. Merchant OTP finalization
                    remains available as a fallback.
                  </p>

                  <div className="mt-2 flex gap-2">
                    <input
                      value={problemText[order.orderId] || ""}
                      onChange={(event) =>
                        setProblemText((prev) => ({
                          ...prev,
                          [order.orderId]: event.target.value,
                        }))
                      }
                      placeholder="Problem (traffic, no answer, etc.)"
                      className="w-full rounded border border-slate-300 px-3 py-2 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => reportProblem(order.orderId)}
                      disabled={isBusy}
                      className="rounded border border-red-300 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"
                    >
                      Problem
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
