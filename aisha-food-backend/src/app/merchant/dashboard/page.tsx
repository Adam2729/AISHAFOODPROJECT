"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import MerchantPortalShell from "@/app/merchant/MerchantPortalShell";
import { useMerchantLaunchProfile } from "@/app/merchant/useMerchantLaunchProfile";
import {
  formatDateForProfile,
  formatDateTimeForProfile,
  formatMoneyForProfile,
} from "@/lib/marketFormatting";
import { ORDER_STATUS_TRANSITIONS, isOrderStatus, type OrderStatus } from "@/lib/orderStatus";
import {
  getMerchantDeliveryFinalizationLabel,
  getMerchantPaymentMethodLabel,
  getMerchantPaymentStatusLabel,
  hasOtpFailure,
} from "@/lib/orderPresentation";
import DeliveryOtpModal from "@/components/DeliveryOtpModal";

type OverviewResponse = {
  ok?: boolean;
  ordersTotal?: number;
  ordersDelivered?: number;
  ordersCancelled?: number;
  revenueTotal?: number;
  averageOrderValue?: number;
  error?: { message?: string; code?: string } | string;
};

type SalesDay = {
  date: string;
  revenue: number;
  orders: number;
};

type SalesResponse = {
  ok?: boolean;
  days?: SalesDay[];
  error?: { message?: string; code?: string } | string;
};

type TopItem = {
  name: string;
  quantitySold: number;
  revenue: number;
};

type TopItemsResponse = {
  ok?: boolean;
  items?: TopItem[];
  error?: { message?: string; code?: string } | string;
};

type PeakHour = {
  hour: number;
  orders: number;
};

type PeakHoursResponse = {
  ok?: boolean;
  hours?: PeakHour[];
  error?: { message?: string; code?: string } | string;
};

type DashboardOrder = {
  _id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  status: string;
  createdAt?: string;
  acceptedAt?: string | null;
  acceptanceDelayMinutes?: number | null;
  total: number;
  items?: Array<{ qty?: number; quantity?: number; name?: string }>;
  payment?: {
    method?: string | null;
    status?: string | null;
  };
  merchantDelivery?: {
    riderName?: string | null;
    riderPhone?: string | null;
    assignedAt?: string | null;
  };
  dispatch?: {
    assignedDriverId?: string | null;
    assignedDriverName?: string | null;
    assignedAt?: string | null;
  };
  deliverySnapshot?: {
    mode?: string | null;
  };
  deliveryProof?: {
    required?: boolean;
    otpLast4?: string | null;
    failedAttempts?: number | null;
    verifiedAt?: string | null;
    verifiedBy?: "customer_code" | "admin_override" | null;
  };
};

type OrdersResponse = {
  ok?: boolean;
  orders?: DashboardOrder[];
  error?: { message?: string; code?: string } | string;
};

type AnalyticsRange = "7d" | "30d" | "90d";

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

function hourLabel(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const normalized = hour % 12 || 12;
  return `${normalized}${suffix}`;
}

function sameLocalDay(value: string | undefined, base = new Date()) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === base.getFullYear() &&
    date.getMonth() === base.getMonth() &&
    date.getDate() === base.getDate()
  );
}

function orderStatusLabel(status: string) {
  switch (status) {
    case "new":
      return "New";
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
      return status;
  }
}

function statusBadge(status: string) {
  switch (status) {
    case "new":
      return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
    case "accepted":
      return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
    case "preparing":
      return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
    case "ready":
      return "bg-sky-50 text-sky-700 ring-1 ring-sky-200";
    case "out_for_delivery":
      return "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200";
    case "delivered":
      return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
    case "cancelled":
      return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
    default:
      return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  }
}

function actionButtonTone(status: string) {
  switch (status) {
    case "accepted":
      return "bg-emerald-600 text-white hover:bg-emerald-700";
    case "cancelled":
      return "bg-rose-600 text-white hover:bg-rose-700";
    case "preparing":
      return "bg-amber-500 text-white hover:bg-amber-600";
    case "ready":
      return "bg-sky-600 text-white hover:bg-sky-700";
    case "out_for_delivery":
      return "bg-indigo-600 text-white hover:bg-indigo-700";
    case "delivered":
      return "bg-slate-900 text-white hover:bg-slate-800";
    default:
      return "bg-slate-900 text-white hover:bg-slate-800";
  }
}

function actionButtonLabel(status: string) {
  switch (status) {
    case "accepted":
      return "Accept";
    case "cancelled":
      return "Reject";
    case "preparing":
      return "Mark preparing";
    case "ready":
      return "Mark ready";
    case "out_for_delivery":
      return "Out for delivery";
    case "delivered":
      return "Merchant OTP fallback";
    default:
      return orderStatusLabel(status);
  }
}

function getOrderDeliveryMode(order: DashboardOrder) {
  if (String(order.dispatch?.assignedDriverId || "").trim()) return "platform_driver";
  if (
    String(order.merchantDelivery?.riderName || "").trim() ||
    String(order.merchantDelivery?.riderPhone || "").trim() ||
    String(order.merchantDelivery?.assignedAt || "").trim()
  ) {
    return "self_delivery";
  }
  return String(order.deliverySnapshot?.mode || "").trim() === "platform_driver"
    ? "platform_driver"
    : "self_delivery";
}

function isOtpFallbackEligible(order: DashboardOrder) {
  if (order.status !== "out_for_delivery") return false;
  if (hasOtpFailure(order.deliveryProof)) return true;
  const baseline = order.dispatch?.assignedAt || order.merchantDelivery?.assignedAt || order.createdAt || "";
  const baselineMs = new Date(String(baseline || "")).getTime();
  if (!Number.isFinite(baselineMs)) return false;
  return Date.now() - baselineMs >= 20 * 60_000;
}

function getAllowedNextStatuses(status: string) {
  if (!isOrderStatus(status)) return [];
  return ORDER_STATUS_TRANSITIONS[status as OrderStatus];
}

function sortOrders(rows: DashboardOrder[]) {
  const priority: Record<string, number> = {
    new: 0,
    accepted: 1,
    preparing: 2,
    ready: 3,
    out_for_delivery: 4,
    delivered: 5,
    cancelled: 6,
  };
  return [...rows].sort((left, right) => {
    const priorityDiff = (priority[left.status] ?? 99) - (priority[right.status] ?? 99);
    if (priorityDiff !== 0) return priorityDiff;
    const leftMs = new Date(String(left.createdAt || "")).getTime();
    const rightMs = new Date(String(right.createdAt || "")).getTime();
    return (rightMs || 0) - (leftMs || 0);
  });
}

function sumItemCount(items: DashboardOrder["items"]) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => sum + Number(item.qty || item.quantity || 0), 0);
}

export default function MerchantDashboardPage() {
  const router = useRouter();
  const { market, usingPlatformDriver } = useMerchantLaunchProfile();
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingStatus, setSavingStatus] = useState("");
  const [overview, setOverview] = useState({
    ordersTotal: 0,
    ordersDelivered: 0,
    ordersCancelled: 0,
    revenueTotal: 0,
    averageOrderValue: 0,
  });
  const [sales, setSales] = useState<SalesDay[]>([]);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [peakHours, setPeakHours] = useState<PeakHour[]>([]);
  const [orders, setOrders] = useState<DashboardOrder[]>([]);
  const [otpOrder, setOtpOrder] = useState<DashboardOrder | null>(null);
  const [otpValue, setOtpValue] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpSaving, setOtpSaving] = useState(false);
  const formatMoney = (value: number) => formatMoneyForProfile(value, market);
  const formatTime = (value: string | null | undefined) =>
    formatDateTimeForProfile(value || null, market, {
      hour: "numeric",
      minute: "2-digit",
    });
  const formatShortDate = (value: string) =>
    formatDateForProfile(`${value}T00:00:00`, market);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const query = `?range=${encodeURIComponent(range)}`;
      const [overviewRes, salesRes, topItemsRes, peakHoursRes, ordersRes] = await Promise.all([
        fetch(`/api/merchant/analytics/overview${query}`, { cache: "no-store" }),
        fetch(`/api/merchant/analytics/sales${query}`, { cache: "no-store" }),
        fetch(`/api/merchant/analytics/top-items${query}`, { cache: "no-store" }),
        fetch(`/api/merchant/analytics/peak-hours${query}`, { cache: "no-store" }),
        fetch("/api/merchant/orders", { cache: "no-store" }),
      ]);

      const [overviewJson, salesJson, topItemsJson, peakHoursJson, ordersJson] = await Promise.all([
        overviewRes.json().catch(() => null) as Promise<OverviewResponse | null>,
        salesRes.json().catch(() => null) as Promise<SalesResponse | null>,
        topItemsRes.json().catch(() => null) as Promise<TopItemsResponse | null>,
        peakHoursRes.json().catch(() => null) as Promise<PeakHoursResponse | null>,
        ordersRes.json().catch(() => null) as Promise<OrdersResponse | null>,
      ]);

      const failures = [
        { res: overviewRes, json: overviewJson },
        { res: salesRes, json: salesJson },
        { res: topItemsRes, json: topItemsJson },
        { res: peakHoursRes, json: peakHoursJson },
        { res: ordersRes, json: ordersJson },
      ];
      const firstFailure = failures.find(({ res, json }) => !res.ok || !json?.ok);
      if (firstFailure) {
        const message = pickError(firstFailure.json?.error, "Could not load merchant dashboard.");
        const code =
          firstFailure.json && typeof firstFailure.json.error !== "string"
            ? firstFailure.json.error?.code
            : undefined;
        if (firstFailure.res.status === 401) {
          router.push("/merchant/login");
          return;
        }
        if (code === "PIN_CHANGE_REQUIRED") {
          router.push("/merchant/set-pin");
          return;
        }
        throw new Error(message);
      }

      setOverview({
        ordersTotal: Number(overviewJson?.ordersTotal || 0),
        ordersDelivered: Number(overviewJson?.ordersDelivered || 0),
        ordersCancelled: Number(overviewJson?.ordersCancelled || 0),
        revenueTotal: Number(overviewJson?.revenueTotal || 0),
        averageOrderValue: Number(overviewJson?.averageOrderValue || 0),
      });
      setSales(Array.isArray(salesJson?.days) ? salesJson.days : []);
      setTopItems(Array.isArray(topItemsJson?.items) ? topItemsJson.items : []);
      setPeakHours(Array.isArray(peakHoursJson?.hours) ? peakHoursJson.hours : []);
      setOrders(Array.isArray(ordersJson?.orders) ? sortOrders(ordersJson.orders) : []);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Could not load merchant dashboard.");
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(orderId: string, nextStatus: string, deliveryOtp = "") {
    setSavingStatus(orderId + nextStatus);
    try {
      const response = await fetch(`/api/merchant/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: nextStatus,
          ...(deliveryOtp ? { deliveryOtp } : {}),
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        const message =
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          "Could not update order.";
        throw new Error(message);
      }
      await load();
      return true;
    } catch (updateError: unknown) {
      const message =
        updateError instanceof Error ? updateError.message : "Could not update order.";
      setError(message);
      if (nextStatus === "delivered") {
        setOtpError(message);
      }
      return false;
    } finally {
      setSavingStatus("");
    }
  }

  async function submitOtp() {
    if (!otpOrder || otpSaving) return;
    const normalizedOtp = String(otpValue || "").trim();
    if (normalizedOtp.length !== 6) {
      setOtpError("Enter the 6-digit customer OTP.");
      return;
    }

    setOtpSaving(true);
    setOtpError("");
    try {
      const ok = await updateStatus(otpOrder._id, "delivered", normalizedOtp);
      if (ok) {
        setOtpOrder(null);
        setOtpValue("");
      }
    } catch {
      // updateStatus already sets page-level errors
    } finally {
      setOtpSaving(false);
    }
  }

  useEffect(() => {
    load().catch(() => null);
  }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveOrders = useMemo(
    () => orders.filter((order) => order.status !== "delivered" && order.status !== "cancelled").slice(0, 6),
    [orders]
  );

  const todaysOrders = useMemo(() => orders.filter((order) => sameLocalDay(order.createdAt)), [orders]);
  const ordersToday = todaysOrders.length;
  const revenueToday = todaysOrders
    .filter((order) => order.status !== "cancelled")
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const preparingNow = orders.filter((order) =>
    order.status === "accepted" || order.status === "preparing" || order.status === "ready"
  ).length;

  const averageResponseMinutes = useMemo(() => {
    const values = orders
      .map((order) => Number(order.acceptanceDelayMinutes))
      .filter((value) => Number.isFinite(value) && value >= 0);
    if (!values.length) return 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }, [orders]);

  const statusSummary = useMemo(
    () =>
      [
        { label: "New", value: orders.filter((order) => order.status === "new").length },
        { label: "Preparing", value: orders.filter((order) => order.status === "preparing").length },
        { label: "Ready", value: orders.filter((order) => order.status === "ready").length },
        { label: "On the way", value: orders.filter((order) => order.status === "out_for_delivery").length },
      ],
    [orders]
  );

  const recentSales = useMemo(() => sales.slice(-7), [sales]);
  const maxRecentRevenue = useMemo(
    () => recentSales.reduce((max, day) => Math.max(max, Number(day.revenue || 0)), 0),
    [recentSales]
  );
  const busiestHours = useMemo(
    () =>
      [...peakHours]
        .sort((left, right) => Number(right.orders || 0) - Number(left.orders || 0))
        .slice(0, 4),
    [peakHours]
  );

  const kpis = [
    {
      label: "Orders today",
      value: String(ordersToday),
      helper: `${liveOrders.length} live`,
      tone: "text-emerald-600",
    },
    {
      label: "Revenue today",
      value: formatMoneyForProfile(revenueToday, market),
      helper: `${formatMoneyForProfile(overview.revenueTotal, market)} in ${range}`,
      tone: "text-slate-950",
    },
    {
      label: "Orders preparing",
      value: String(preparingNow),
      helper: `${overview.ordersDelivered} delivered`,
      tone: "text-blue-600",
    },
    {
      label: "Avg. response time",
      value: `${averageResponseMinutes || 0} min`,
      helper: `${overview.ordersCancelled} cancelled`,
      tone: "text-amber-600",
    },
  ];

  return (
    <MerchantPortalShell
      title="Dashboard"
      subtitle="Run the kitchen from one place: live orders, service speed, top sellers, and the operating pulse of the store."
      actions={
        <label className="text-sm font-medium text-slate-700">
          Range
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as AnalyticsRange)}
            className="ml-2 rounded-2xl border border-slate-300 bg-white px-3 py-2"
          >
            <option value="7d">7 days</option>
            <option value="30d">30 days</option>
            <option value="90d">90 days</option>
          </select>
        </label>
      }
    >
      <DeliveryOtpModal
        open={Boolean(otpOrder)}
        orderNumber={otpOrder?.orderNumber}
        otpLast4={otpOrder?.deliveryProof?.otpLast4 || null}
        deliveryMode={otpOrder ? getOrderDeliveryMode(otpOrder) : "self_delivery"}
        value={otpValue}
        error={otpError}
        saving={otpSaving}
        onChange={setOtpValue}
        onClose={() => {
          if (otpSaving) return;
          setOtpOrder(null);
          setOtpValue("");
          setOtpError("");
        }}
        onSubmit={submitOtp}
      />

      {error ? (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((item) => (
          <article
            key={item.label}
            className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_16px_38px_rgba(15,23,42,0.05)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
            <p className={`mt-3 text-3xl font-semibold tracking-tight ${item.tone}`}>{item.value}</p>
            <p className="mt-2 text-sm text-slate-500">{item.helper}</p>
          </article>
        ))}
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_390px]">
        <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">Current orders</h2>
              <p className="mt-1 text-sm text-slate-500">Act on incoming orders without leaving the dashboard.</p>
            </div>
            <Link
              href="/merchant/orders"
              className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
            >
              Open full board
            </Link>
          </div>

          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-semibold">
              {usingPlatformDriver
                ? "Platform dispatch vs final delivery"
                : "Merchant rider handoff vs final delivery"}
            </p>
            <p className="mt-1">
              {usingPlatformDriver
                ? "Platform-driver orders should close from the driver link first. Merchant OTP entry stays hidden unless the handoff is delayed or the OTP already failed."
                : "Self-delivery orders should close here with the customer OTP. Merchant fallback appears only after an OTP failure or delayed handoff."}
            </p>
          </div>

          {loading ? (
            <div className="mt-4 space-y-3">
              {[0, 1, 2].map((index) => (
                <div key={index} className="h-40 animate-pulse rounded-[22px] bg-slate-100" />
              ))}
            </div>
          ) : liveOrders.length ? (
            <div className="mt-4 space-y-3">
              {liveOrders.map((order) => {
                const actions = getAllowedNextStatuses(order.status).filter((nextStatus) => {
                  if (nextStatus === "cancelled") return false;
                  if (nextStatus !== "delivered") return true;
                  const deliveryMode = getOrderDeliveryMode(order);
                  return deliveryMode === "self_delivery" || isOtpFallbackEligible(order);
                });
                return (
                  <article
                    key={order._id}
                    className="rounded-[24px] border border-slate-200 bg-[#f8fafc] p-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-semibold text-slate-950">{order.orderNumber}</span>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusBadge(order.status)}`}>
                            {orderStatusLabel(order.status)}
                          </span>
                        </div>
                        <p className="mt-2 text-sm font-medium text-slate-800">{order.customerName}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {sumItemCount(order.items)} item(s) - {formatTime(order.createdAt)}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">{order.address || "Address pending"}</p>
                      </div>

                      <div className="text-right">
                        <p className="text-2xl font-semibold tracking-tight text-slate-950">
                          {formatMoney(order.total)}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          {getMerchantPaymentMethodLabel(order.payment)} - {getMerchantPaymentStatusLabel(order.payment, order.status)}
                        </p>
                        {order.merchantDelivery?.riderName ? (
                          <p className="mt-2 text-sm text-slate-600">Rider: {order.merchantDelivery.riderName}</p>
                        ) : null}
                        <p className="mt-2 text-sm text-slate-500">
                          {getMerchantDeliveryFinalizationLabel(order.status, order.deliveryProof)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {actions.map((nextStatus) => (
                        <button
                          key={nextStatus}
                          type="button"
                          disabled={savingStatus === order._id + nextStatus}
                          onClick={() => {
                            if (nextStatus === "delivered") {
                              setOtpOrder(order);
                              setOtpValue("");
                              setOtpError("");
                              return;
                            }
                            updateStatus(order._id, nextStatus);
                          }}
                          className={`rounded-2xl px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${actionButtonTone(
                            nextStatus
                          )}`}
                        >
                          {savingStatus === order._id + nextStatus
                            ? "Saving..."
                            : nextStatus === "delivered"
                            ? getOrderDeliveryMode(order) === "platform_driver"
                              ? "Fallback OTP"
                              : hasOtpFailure(order.deliveryProof)
                              ? "Retry OTP"
                              : "Enter OTP"
                            : actionButtonLabel(nextStatus)}
                        </button>
                      ))}
                    </div>

                    {order.status === "out_for_delivery" ? (
                      <p className="mt-2 text-[11px] text-slate-500">
                        {getOrderDeliveryMode(order) === "platform_driver"
                          ? "Driver OTP completion is primary. Merchant fallback only opens after a failed OTP or a delayed handoff."
                          : "Final delivery requires the customer OTP. Use the OTP action only when the customer shares the code."}
                      </p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
              No active orders right now.
            </div>
          )}
        </article>

        <div className="space-y-5">
          <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">Top selling items</h2>
                <p className="mt-1 text-sm text-slate-500">What is driving the most revenue this period.</p>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                {range}
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              {topItems.slice(0, 4).map((item, index) => (
                <div
                  key={item.name}
                  className="flex items-center gap-3 rounded-[22px] border border-slate-200 bg-[#f8fafc] p-3"
                >
                  <div
                    className={`flex h-14 w-16 shrink-0 items-center justify-center rounded-[18px] text-sm font-bold text-white ${
                      index % 3 === 0
                        ? "bg-[linear-gradient(135deg,#ef4444_0%,#f97316_100%)]"
                        : index % 3 === 1
                        ? "bg-[linear-gradient(135deg,#0f766e_0%,#22c55e_100%)]"
                        : "bg-[linear-gradient(135deg,#2563eb_0%,#6366f1_100%)]"
                    }`}
                  >
                    {item.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-950">{item.name}</p>
                    <p className="mt-1 text-sm text-slate-500">{item.quantitySold} sold</p>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">{formatMoney(item.revenue)}</p>
                </div>
              ))}
              {!loading && !topItems.length ? (
                <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  No item performance yet for this range.
                </div>
              ) : null}
            </div>
          </article>

          <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
            <h2 className="text-xl font-semibold text-slate-950">Business overview</h2>
            <p className="mt-1 text-sm text-slate-500">Live order mix, sales pace, and busiest service windows.</p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {statusSummary.map((item) => (
                <div key={item.label} className="rounded-[20px] border border-slate-200 bg-[#f8fafc] px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">{item.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-[22px] border border-slate-200 bg-[#f8fafc] p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Recent sales trend</p>
                  <p className="text-xs text-slate-500">Last 7 days</p>
                </div>
                <span className="text-sm font-semibold text-slate-700">{formatMoney(overview.averageOrderValue)} AOV</span>
              </div>

              <div className="mt-4 flex items-end gap-2">
                {recentSales.map((day) => {
                  const revenue = Number(day.revenue || 0);
                  const height =
                    maxRecentRevenue > 0 ? Math.max(14, Math.round((revenue / maxRecentRevenue) * 92)) : 14;
                  return (
                    <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                      <div
                        className="w-full rounded-t-2xl bg-[linear-gradient(180deg,#10b981_0%,#0f172a_100%)]"
                        style={{ height }}
                        title={`${formatShortDate(day.date)} - ${formatMoney(revenue)}`}
                      />
                      <span className="text-[11px] text-slate-500">{formatShortDate(day.date)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 rounded-[22px] border border-slate-200 bg-[#f8fafc] p-4">
              <p className="text-sm font-semibold text-slate-900">Peak hours</p>
              <div className="mt-3 space-y-3">
                {busiestHours.length ? (
                  busiestHours.map((row) => {
                    const maxOrders = Math.max(...busiestHours.map((item) => Number(item.orders || 0)), 1);
                    const width = `${Math.max(10, Math.round((Number(row.orders || 0) / maxOrders) * 100))}%`;
                    return (
                      <div key={row.hour}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-slate-700">{hourLabel(Number(row.hour || 0))}</span>
                          <span className="text-slate-500">{Number(row.orders || 0)} orders</span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-slate-200">
                          <div
                            className="h-2 rounded-full bg-[linear-gradient(90deg,#f97316_0%,#22c55e_100%)]"
                            style={{ width }}
                          />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-500">No peak-hour signal yet.</p>
                )}
              </div>
            </div>
          </article>
        </div>
      </section>
    </MerchantPortalShell>
  );
}
