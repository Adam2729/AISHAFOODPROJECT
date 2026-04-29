"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ORDER_STATUS_TRANSITIONS, isOrderStatus, type OrderStatus } from "@/lib/orderStatus";
import {
  getMaskedOtpLast4,
  getMerchantDeliveryFinalizationLabel,
  getMerchantDeliveryVerificationLabel,
  getMerchantPaymentMethodLabel,
  getMerchantPaymentStatusLabel,
  hasOtpFailure,
} from "@/lib/orderPresentation";
import {
  MERCHANT_CANCELLATION_REASONS,
  MERCHANT_ISSUE_TYPES,
  getMerchantCancellationReasonLabel,
  getMerchantIssueTypeLabel,
} from "@/lib/orderOperations";
import MerchantPortalShell from "@/app/merchant/MerchantPortalShell";
import { useMerchantLaunchProfile } from "@/app/merchant/useMerchantLaunchProfile";
import { formatDateTimeForProfile, formatMoneyForProfile } from "@/lib/marketFormatting";
import DeliveryOtpModal from "@/components/DeliveryOtpModal";

type DeliveryMode = "self_delivery" | "platform_driver";

type Order = {
  _id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  status: string;
  createdAt?: string;
  total: number;
  items?: Array<{ qty?: number }>;
  payment?: {
    method?: string | null;
    status?: string | null;
    paidAt?: string | null;
  };
  deliveryMode?: DeliveryMode;
  deliveryUi?: {
    modeLabel?: string | null;
    handoffLabel?: string | null;
    handoffHint?: string | null;
    driverAssigned?: boolean;
    pickupConfirmed?: boolean;
    outForDelivery?: boolean;
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
    lastFailedAt?: string | null;
    verifiedAt?: string | null;
    verifiedBy?: "customer_code" | "admin_override" | null;
  };
  cancellation?: {
    reason?: string | null;
    note?: string | null;
    cancelledAt?: string | null;
    cancelledBy?: string | null;
  };
  merchantIssues?: Array<{
    issueType?: string | null;
    note?: string | null;
    createdAt?: string | null;
    createdBy?: string | null;
  }>;
  adjustments?: Array<{
    adjustmentType?: string | null;
    amount?: number | null;
    reason?: string | null;
    note?: string | null;
    createdAt?: string | null;
    createdBy?: string | null;
  }>;
  orderEvents?: Array<{
    type?: string | null;
    label?: string | null;
    detail?: string | null;
    actor?: string | null;
    createdAt?: string | null;
  }>;
};

type DigestOrder = {
  orderId: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  subtotal: number;
  total: number;
};

type MerchantNotification = {
  id: string;
  eventType?: string | null;
  status?: string | null;
  deliveryMode?: string | null;
  title: string;
  body: string;
  orderId?: string | null;
  source?: string | null;
  createdAt?: string | null;
};

const statuses = ["new", "accepted", "preparing", "ready", "out_for_delivery", "delivered", "cancelled"];
const OTP_FALLBACK_DELAY_MINUTES = 20;

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
      return "On the way";
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

function actionTone(status: string) {
  switch (status) {
    case "accepted":
      return "border-emerald-200 bg-emerald-600 text-white";
    case "preparing":
      return "border-amber-200 bg-amber-500 text-white";
    case "ready":
      return "border-sky-200 bg-sky-600 text-white";
    case "out_for_delivery":
      return "border-indigo-200 bg-indigo-600 text-white";
    case "delivered":
      return "border-slate-900 bg-slate-900 text-white";
    case "cancelled":
      return "border-rose-200 bg-rose-600 text-white";
    default:
      return "border-slate-200 bg-white text-slate-700";
  }
}

function getAllowedNextStatuses(status: string) {
  if (!isOrderStatus(status)) return [];
  return ORDER_STATUS_TRANSITIONS[status as OrderStatus];
}

function statusPriority(status: string) {
  switch (status) {
    case "new":
      return 0;
    case "accepted":
      return 1;
    case "preparing":
      return 2;
    case "ready":
      return 3;
    case "out_for_delivery":
      return 4;
    case "delivered":
      return 5;
    case "cancelled":
      return 6;
    default:
      return 99;
  }
}

function sortOrders(rows: Order[]) {
  return [...rows].sort((left, right) => {
    const priorityDiff = statusPriority(left.status) - statusPriority(right.status);
    if (priorityDiff !== 0) return priorityDiff;

    const leftMs = new Date(String(left.createdAt || "")).getTime();
    const rightMs = new Date(String(right.createdAt || "")).getTime();
    return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
  });
}

function getOrderDeliveryMode(order: Order): DeliveryMode {
  if (String(order.deliveryMode || "").trim() === "platform_driver") return "platform_driver";
  if (String(order.deliveryMode || "").trim() === "self_delivery") return "self_delivery";
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

function getDeliveryActorLabel(order: Order) {
  return getOrderDeliveryMode(order) === "platform_driver"
    ? "AishaFood driver"
    : "Own driver";
}

function getDeliveryModeLabel(order: Order) {
  return getOrderDeliveryMode(order) === "platform_driver"
    ? "AishaFood driver"
    : "Own driver";
}

function getDeliveryActorName(order: Order) {
  return getOrderDeliveryMode(order) === "platform_driver"
    ? String(order.dispatch?.assignedDriverName || "").trim() || "-"
    : String(order.merchantDelivery?.riderName || "").trim() || "-";
}

function getDeliveryActorPhone(order: Order) {
  return getOrderDeliveryMode(order) === "platform_driver"
    ? "-"
    : String(order.merchantDelivery?.riderPhone || "").trim() || "-";
}

function getDeliveryAssignedAt(order: Order) {
  return getOrderDeliveryMode(order) === "platform_driver"
    ? order.dispatch?.assignedAt || null
    : order.merchantDelivery?.assignedAt || null;
}

function isOtpFallbackEligible(order: Order) {
  if (order.status !== "out_for_delivery") return false;
  if (hasOtpFailure(order.deliveryProof)) return true;
  const baseline = getDeliveryAssignedAt(order) || order.createdAt || "";
  const baselineMs = new Date(String(baseline || "")).getTime();
  if (!Number.isFinite(baselineMs)) return false;
  return Date.now() - baselineMs >= OTP_FALLBACK_DELAY_MINUTES * 60_000;
}

function getDeliveryFinalizationLabel(order: Order) {
  return getMerchantDeliveryFinalizationLabel(order.status, order.deliveryProof);
}

function canAssignMerchantRider(order: Order) {
  return (
    getOrderDeliveryMode(order) === "self_delivery" &&
    order.status !== "delivered" &&
    order.status !== "cancelled"
  );
}

function canMarkCashReceived(order: Order) {
  return (
    String(order.payment?.method || "cash").trim() === "cash" &&
    String(order.payment?.status || "").trim() !== "paid" &&
    order.status === "delivered" &&
    Boolean(
      order.deliveryProof?.verifiedAt ||
        order.deliveryProof?.verifiedBy === "admin_override" ||
        order.deliveryProof?.required === false
    )
  );
}

function getLatestIssue(order: Order) {
  if (!Array.isArray(order.merchantIssues) || !order.merchantIssues.length) return null;
  return order.merchantIssues[order.merchantIssues.length - 1];
}

function getRecentEvents(order: Order) {
  if (!Array.isArray(order.orderEvents) || !order.orderEvents.length) return [];
  return [...order.orderEvents]
    .slice(-4)
    .reverse()
    .filter((event) => String(event?.label || "").trim());
}

function getActionLabel(order: Order, status: string) {
  if (status !== "delivered") {
    switch (status) {
      case "accepted":
        return "Accept";
      case "preparing":
        return "Mark preparing";
      case "ready":
        return "Mark ready";
      case "out_for_delivery":
        return "Out for delivery";
      case "cancelled":
        return "Cancel";
      default:
        return orderStatusLabel(status);
    }
  }

  const deliveryMode = getOrderDeliveryMode(order);
  if (deliveryMode === "platform_driver") {
    return isOtpFallbackEligible(order) ? "Fallback OTP" : "";
  }
  return hasOtpFailure(order.deliveryProof) ? "Retry OTP" : "Enter OTP";
}

export default function MerchantOrdersPage() {
  const router = useRouter();
  const { market, usingPlatformDriver } = useMerchantLaunchProfile();
  const [rows, setRows] = useState<Order[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState("");
  const [savingRider, setSavingRider] = useState("");
  const [savingCash, setSavingCash] = useState("");
  const [savingCancellation, setSavingCancellation] = useState("");
  const [savingIssue, setSavingIssue] = useState("");
  const [editingRiderOrderId, setEditingRiderOrderId] = useState("");
  const [editingCancellationOrderId, setEditingCancellationOrderId] = useState("");
  const [editingIssueOrderId, setEditingIssueOrderId] = useState("");
  const [riderNameDraft, setRiderNameDraft] = useState("");
  const [riderPhoneDraft, setRiderPhoneDraft] = useState("");
  const [cancelReasonDraft, setCancelReasonDraft] = useState<string>(
    MERCHANT_CANCELLATION_REASONS[0]
  );
  const [cancelNoteDraft, setCancelNoteDraft] = useState("");
  const [issueTypeDraft, setIssueTypeDraft] = useState<string>(MERCHANT_ISSUE_TYPES[0]);
  const [issueNoteDraft, setIssueNoteDraft] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [merchantNotifications, setMerchantNotifications] = useState<MerchantNotification[]>([]);
  const [otpOrder, setOtpOrder] = useState<Order | null>(null);
  const [otpValue, setOtpValue] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpSaving, setOtpSaving] = useState(false);
  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const lastSeenCreatedAtRef = useRef("");
  const pollingRef = useRef(false);
  const notificationPollingRef = useRef(false);
  const formatMoney = (value: number | string | null | undefined) =>
    formatMoneyForProfile(Number(value || 0), market);
  const formatDateTime = (value: string | null | undefined) =>
    formatDateTimeForProfile(value || null, market);

  function toIso(value: unknown) {
    const date = new Date(String(value || ""));
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString();
  }

  function setLastSeen(value: unknown) {
    const next = toIso(value);
    if (!next) return;
    if (!lastSeenCreatedAtRef.current || next > lastSeenCreatedAtRef.current) {
      lastSeenCreatedAtRef.current = next;
    }
  }

  function playNotificationSound() {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof window.AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      void ctx.resume?.();
      const playTone = (delayMs: number, frequency: number) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.value = 0.035;
        const startAt = ctx.currentTime + delayMs / 1000;
        oscillator.start(startAt);
        oscillator.stop(startAt + 0.13);
      };
      playTone(0, 880);
      playTone(180, 1175);
      setTimeout(() => {
        ctx.close().catch(() => null);
      }, 450);
    } catch {
      // no-op
    }
  }

  function mergeNotifications(nextRows: MerchantNotification[]) {
    setMerchantNotifications((prev) => {
      const merged = new Map<string, MerchantNotification>();
      for (const row of prev) {
        merged.set(String(row.id), row);
      }
      for (const row of nextRows) {
        merged.set(String(row.id), row);
      }
      return [...merged.values()]
        .sort((left, right) => {
          const leftMs = new Date(String(left.createdAt || "")).getTime();
          const rightMs = new Date(String(right.createdAt || "")).getTime();
          return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
        })
        .slice(0, 8);
    });
  }

  async function load() {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    const res = await fetch(`/api/merchant/orders${qs}`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Failed to load orders");
      if (res.status === 401) router.push("/merchant/login");
      if (json?.error?.code === "PIN_CHANGE_REQUIRED") router.push("/merchant/set-pin");
      return;
    }
    setError("");
    const nextRows = Array.isArray(json.orders) ? sortOrders(json.orders as Order[]) : [];
    setRows(nextRows);
    for (const row of nextRows) {
      knownOrderIdsRef.current.add(String(row._id));
      setLastSeen(row.createdAt);
    }
    if (otpOrder) {
      const refreshedOtpOrder =
        nextRows.find((row) => String(row._id) === String(otpOrder._id)) || null;
      setOtpOrder(refreshedOtpOrder);
      if (refreshedOtpOrder?.deliveryProof?.verifiedAt) {
        setOtpOrder(null);
        setOtpValue("");
        setOtpError("");
      }
    }
    setLastUpdatedAt(new Date().toLocaleTimeString());
  }

  async function pollDigest() {
    if (pollingRef.current) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    pollingRef.current = true;
    try {
      const params = new URLSearchParams();
      if (lastSeenCreatedAtRef.current) params.set("since", lastSeenCreatedAtRef.current);
      params.set("limit", "20");
      const qs = params.toString();
      const res = await fetch(`/api/merchant/orders/digest${qs ? `?${qs}` : ""}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        if (res.status === 401) router.push("/merchant/login");
        return;
      }
      const digestRows = Array.isArray(json.orders) ? (json.orders as DigestOrder[]) : [];
      if (!digestRows.length) {
        setLastUpdatedAt(new Date().toLocaleTimeString());
        return;
      }

      let newCount = 0;
      for (const row of digestRows) {
        const id = String(row.orderId || "");
        if (!id) continue;
        setLastSeen(row.createdAt);
        if (!knownOrderIdsRef.current.has(id)) {
          knownOrderIdsRef.current.add(id);
          newCount += 1;
        }
      }

      if (digestRows.length > 0) {
        await load();
      }
      if (!newCount) {
        setLastUpdatedAt(new Date().toLocaleTimeString());
      }
    } finally {
      pollingRef.current = false;
    }
  }

  async function acknowledgeNotifications(ids: string[]) {
    if (!ids.length) return;
    await fetch("/api/merchant/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => null);
  }

  async function pollNotifications() {
    if (notificationPollingRef.current) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    notificationPollingRef.current = true;
    try {
      const res = await fetch("/api/merchant/notifications?status=pending&limit=10", {
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        if (res.status === 401) router.push("/merchant/login");
        return;
      }

      const nextRows = Array.isArray(json.rows)
        ? (json.rows as MerchantNotification[])
            .filter((row) => String(row?.id || "").trim())
            .sort((left, right) => {
              const leftMs = new Date(String(left?.createdAt || "")).getTime();
              const rightMs = new Date(String(right?.createdAt || "")).getTime();
              return (Number.isFinite(leftMs) ? leftMs : 0) - (Number.isFinite(rightMs) ? rightMs : 0);
            })
        : [];

      if (!nextRows.length) return;

      mergeNotifications(nextRows);
      playNotificationSound();
      await Promise.all([
        acknowledgeNotifications(nextRows.map((row) => row.id)),
        load(),
      ]);
    } finally {
      notificationPollingRef.current = false;
    }
  }

  function openOtpModal(order: Order) {
    setOtpOrder(order);
    setOtpValue("");
    setOtpError("");
  }

  async function patchOrderStatus(
    orderId: string,
    nextStatus: string,
    options?: {
      deliveryOtp?: string;
      cancelReasonCode?: string;
      cancelNote?: string;
    }
  ) {
    setSaving(orderId + nextStatus);
    setError("");
    const res = await fetch(`/api/merchant/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: nextStatus,
        ...(options?.deliveryOtp ? { deliveryOtp: options.deliveryOtp } : {}),
        ...(options?.cancelReasonCode ? { cancelReasonCode: options.cancelReasonCode } : {}),
        ...(options?.cancelNote ? { cancelNote: options.cancelNote } : {}),
      }),
    });
    const json = await res.json().catch(() => null);
    setSaving("");
    if (!res.ok || !json?.ok) {
      const message = json?.error?.message || json?.error || "Update failed";
      if (json?.error?.code === "PIN_CHANGE_REQUIRED") router.push("/merchant/set-pin");
      throw new Error(String(message));
    }
    await load();
  }

  async function updateStatus(order: Order, nextStatus: string) {
    if (nextStatus === "delivered") {
      openOtpModal(order);
      return;
    }
    if (nextStatus === "cancelled") {
      startCancellationEditor(order._id);
      return;
    }

    try {
      await patchOrderStatus(order._id, nextStatus);
      setSuccess(`${orderStatusLabel(nextStatus)} saved.`);
    } catch (updateError: unknown) {
      setError(updateError instanceof Error ? updateError.message : "Update failed");
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
      await patchOrderStatus(otpOrder._id, "delivered", { deliveryOtp: normalizedOtp });
      setOtpOrder(null);
      setOtpValue("");
      setSuccess("Delivery confirmed.");
    } catch (updateError: unknown) {
      const message =
        updateError instanceof Error ? updateError.message : "Could not finalize delivery.";
      setOtpError(message);
      setError(message);
    } finally {
      setOtpSaving(false);
    }
  }

  function startRiderEditor(order: Order) {
    setEditingRiderOrderId(order._id);
    setRiderNameDraft(String(order.merchantDelivery?.riderName || ""));
    setRiderPhoneDraft(String(order.merchantDelivery?.riderPhone || ""));
    setEditingCancellationOrderId("");
    setEditingIssueOrderId("");
  }

  function closeRiderEditor() {
    setEditingRiderOrderId("");
    setRiderNameDraft("");
    setRiderPhoneDraft("");
  }

  function startCancellationEditor(orderId: string) {
    setEditingCancellationOrderId(orderId);
    setCancelReasonDraft(MERCHANT_CANCELLATION_REASONS[0]);
    setCancelNoteDraft("");
    setEditingRiderOrderId("");
    setEditingIssueOrderId("");
  }

  function closeCancellationEditor() {
    setEditingCancellationOrderId("");
    setCancelReasonDraft(MERCHANT_CANCELLATION_REASONS[0]);
    setCancelNoteDraft("");
  }

  function startIssueEditor(orderId: string) {
    setEditingIssueOrderId(orderId);
    setIssueTypeDraft(MERCHANT_ISSUE_TYPES[0]);
    setIssueNoteDraft("");
    setEditingRiderOrderId("");
    setEditingCancellationOrderId("");
  }

  function closeIssueEditor() {
    setEditingIssueOrderId("");
    setIssueTypeDraft(MERCHANT_ISSUE_TYPES[0]);
    setIssueNoteDraft("");
  }

  async function saveRider(orderId: string) {
    if (savingRider) return;
    setSavingRider(orderId);
    setError("");
    const res = await fetch(`/api/merchant/orders/${orderId}/assign-rider`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        riderName: String(riderNameDraft || "").slice(0, 60),
        riderPhone: String(riderPhoneDraft || "").slice(0, 30),
      }),
    });
    const json = await res.json().catch(() => null);
    setSavingRider("");
    if (!res.ok || !json?.ok) {
      setError(
        (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          "Could not save rider assignment."
      );
      return;
    }
    closeRiderEditor();
    setSuccess("Own-driver handoff updated.");
    await load();
  }

  async function markCashReceived(orderId: string) {
    if (savingCash) return;
    setSavingCash(orderId);
    setError("");
    const res = await fetch(`/api/merchant/orders/${orderId}/cash-received`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirm: "RECEIVED",
        note: "",
      }),
    });
    const json = await res.json().catch(() => null);
    setSavingCash("");
    if (!res.ok || !json?.ok) {
      setError(
        (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          "Could not mark cash received."
      );
      return;
    }
    setSuccess("Cash confirmation saved.");
    await load();
  }

  async function saveCancellation(orderId: string) {
    if (savingCancellation) return;
    setSavingCancellation(orderId);
    setError("");
    setSuccess("");
    try {
      await patchOrderStatus(orderId, "cancelled", {
        cancelReasonCode: cancelReasonDraft,
        cancelNote: cancelNoteDraft,
      });
      closeCancellationEditor();
      setSuccess("Order cancelled.");
    } catch (cancelError: unknown) {
      setError(cancelError instanceof Error ? cancelError.message : "Could not cancel order.");
    } finally {
      setSavingCancellation("");
    }
  }

  async function saveIssue(orderId: string) {
    if (savingIssue) return;
    setSavingIssue(orderId);
    setError("");
    setSuccess("");
    const res = await fetch(`/api/merchant/orders/${orderId}/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        issueType: issueTypeDraft,
        note: issueNoteDraft,
      }),
    });
    const json = await res.json().catch(() => null);
    setSavingIssue("");
    if (!res.ok || !json?.ok) {
      setError(
        (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          "Could not report issue."
      );
      return;
    }
    closeIssueEditor();
    setSuccess("Issue reported for ops follow-up.");
    await load();
  }

  useEffect(() => {
    load().catch(() => null);
    pollNotifications().catch(() => null);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const interval = window.setInterval(() => {
      pollDigest().catch(() => null);
      pollNotifications().catch(() => null);
    }, 12000);
    return () => window.clearInterval(interval);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handleFocus() {
      load().catch(() => null);
      pollNotifications().catch(() => null);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        load().catch(() => null);
        pollNotifications().catch(() => null);
      }
    }

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusSummary = statuses.map((entry) => ({
    key: entry,
    label: orderStatusLabel(entry),
    count: rows.filter((row) => row.status === entry).length,
  }));

  return (
    <MerchantPortalShell
      title="Orders"
      subtitle="Monitor live orders, move them through each stage, and coordinate delivery without leaving the portal."
      actions={
        <>
          <select
            className="rounded-2xl border border-slate-300 px-3 py-2"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button onClick={load} className="rounded-2xl bg-slate-900 px-4 py-2 text-white">
            Refresh now
          </button>
          <span className="self-center text-xs text-slate-500">
            Last updated: {lastUpdatedAt || "-"}
          </span>
        </>
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

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mb-3 text-sm text-emerald-700">{success}</p> : null}
      <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <p className="font-semibold">Final delivery rule</p>
        <p className="mt-1">
          {usingPlatformDriver
            ? "Platform-driver orders should close from the driver link first. Merchant OTP entry only appears if the delivery is stuck or the OTP already failed."
            : "Self-delivery orders should close here with the customer OTP. Merchant fallback stays hidden until an OTP failure or a delayed handoff requires it."}
        </p>
      </div>
      {merchantNotifications.length > 0 ? (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold">
              Merchant notifications ({merchantNotifications.length})
            </span>
            <button
              type="button"
              onClick={() => setMerchantNotifications([])}
              className="rounded-xl border border-emerald-300 px-3 py-1.5 text-xs font-semibold"
            >
              Dismiss
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {merchantNotifications.map((notification) => (
              <div
                key={notification.id}
                className="rounded-2xl border border-emerald-200 bg-white/80 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-emerald-900">
                      {notification.title || "Merchant notification"}
                    </div>
                    {notification.body ? (
                      <div className="mt-0.5 text-xs text-emerald-800">{notification.body}</div>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-emerald-700">
                    {formatDateTime(notification.createdAt || null)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statusSummary.slice(0, 4).map((item) => (
          <div key={item.key} className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{item.count}</p>
          </div>
        ))}
      </section>

      <div className="overflow-x-auto rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="border-b border-slate-100 pb-3">Order</th>
              <th className="border-b border-slate-100 pb-3">Customer</th>
              <th className="border-b border-slate-100 pb-3">Status</th>
              <th className="border-b border-slate-100 pb-3">Total</th>
              <th className="border-b border-slate-100 pb-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const deliveryMode = getOrderDeliveryMode(o);
              const latestIssue = getLatestIssue(o);
              const recentEvents = getRecentEvents(o);
              const hasRiderAssignment =
                Boolean(String(o.merchantDelivery?.riderName || "").trim()) ||
                Boolean(String(o.merchantDelivery?.riderPhone || "").trim()) ||
                Boolean(String(o.merchantDelivery?.assignedAt || "").trim());
              const showOtpAction =
                getAllowedNextStatuses(o.status).includes("delivered" as OrderStatus) &&
                (deliveryMode === "self_delivery" || isOtpFallbackEligible(o));

              return (
                <tr key={o._id} className="border-t border-slate-100 align-top">
                  <td className="py-4">
                    <div className="font-semibold text-slate-950">{o.orderNumber}</div>
                    <div className="text-xs text-slate-500">{o.address}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {Array.isArray(o.items)
                        ? `${o.items.reduce((sum, item) => sum + Number(item.qty || 0), 0)} item(s)`
                        : "Items pending"}
                    </div>
                  </td>
                  <td className="py-4">
                    <div className="font-medium text-slate-900">{o.customerName}</div>
                    <div className="text-xs text-slate-500">{o.phone}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Payment: {getMerchantPaymentMethodLabel(o.payment)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Payment status: {getMerchantPaymentStatusLabel(o.payment, o.status)}
                    </div>
                  </td>
                  <td className="py-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge(o.status)}`}>
                      {orderStatusLabel(o.status)}
                    </span>
                    <div className="mt-2 text-xs text-slate-600">
                      Delivery mode: {getDeliveryModeLabel(o)}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      Handoff: {String(o.deliveryUi?.handoffLabel || "-")}
                    </div>
                    {o.deliveryUi?.handoffHint ? (
                      <div className="mt-1 text-xs text-slate-500">{o.deliveryUi.handoffHint}</div>
                    ) : null}
                    <div className="mt-2 text-xs text-slate-600">
                      {getDeliveryActorLabel(o)}: {getDeliveryActorName(o)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">Phone: {getDeliveryActorPhone(o)}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Assigned: {getDeliveryAssignedAt(o) ? formatDateTime(getDeliveryAssignedAt(o)) : "-"}
                    </div>
                    <div className="mt-2 text-xs text-slate-600">
                      Delivery finalization: {getDeliveryFinalizationLabel(o)}
                    </div>
                    {getMerchantDeliveryVerificationLabel(o.status, o.deliveryProof) ? (
                      <div className="mt-1 text-xs text-slate-500">
                        Verification: {getMerchantDeliveryVerificationLabel(o.status, o.deliveryProof)}
                      </div>
                    ) : null}
                    {o.cancellation?.reason ? (
                      <div className="mt-1 text-xs text-rose-700">
                        Cancellation: {getMerchantCancellationReasonLabel(o.cancellation.reason)}
                        {o.cancellation.note ? ` - ${o.cancellation.note}` : ""}
                      </div>
                    ) : null}
                    {latestIssue ? (
                      <div className="mt-1 text-xs text-amber-700">
                        Latest issue: {getMerchantIssueTypeLabel(latestIssue.issueType)}
                        {latestIssue.note ? ` - ${latestIssue.note}` : ""}
                      </div>
                    ) : null}
                    <div className="mt-1 text-xs text-slate-500">
                      Customer code: {getMaskedOtpLast4(o.deliveryProof?.otpLast4)}
                    </div>
                    {deliveryMode === "platform_driver" && !showOtpAction && o.status === "out_for_delivery" ? (
                      <div className="mt-1 text-xs text-amber-700">
                        Driver completes OTP first. Merchant fallback unlocks only after a failure or delayed handoff.
                      </div>
                    ) : null}
                  </td>
                  <td className="py-4 text-sm font-semibold text-slate-950">{formatMoney(o.total)}</td>
                  <td className="py-4">
                    <div className="flex flex-wrap gap-2">
                      {statuses
                        .filter((s) => getAllowedNextStatuses(o.status).includes(s as OrderStatus))
                        .filter((s) => s !== "delivered" || showOtpAction)
                        .map((s) => (
                          <button
                            key={s}
                            disabled={saving === o._id + s}
                            onClick={() => updateStatus(o, s)}
                            className={`rounded-xl border px-3 py-2 text-xs font-semibold transition disabled:opacity-60 ${actionTone(
                              s
                            )}`}
                          >
                            {s === "delivered" ? getActionLabel(o, s) : getActionLabel(o, s)}
                          </button>
                        ))}
                      <button
                        type="button"
                        disabled={!canAssignMerchantRider(o)}
                        onClick={() => startRiderEditor(o)}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40"
                      >
                        {canAssignMerchantRider(o)
                          ? hasRiderAssignment
                            ? "Edit own driver"
                            : "Assign own driver"
                          : deliveryMode === "platform_driver"
                          ? "AishaFood driver"
                          : "Rider assigned"}
                      </button>
                      <button
                        type="button"
                        disabled={o.status === "delivered" || o.status === "cancelled"}
                        onClick={() => startIssueEditor(o._id)}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40"
                      >
                        Report issue
                      </button>
                      <button
                        type="button"
                        disabled={savingCash === o._id || !canMarkCashReceived(o)}
                        onClick={() => markCashReceived(o._id)}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40"
                      >
                        {savingCash === o._id ? "Saving..." : "Cash received"}
                      </button>
                    </div>
                    {editingRiderOrderId === o._id && canAssignMerchantRider(o) ? (
                      <div className="mt-3 grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-xs font-semibold text-slate-700">Own-driver handoff (optional)</div>
                        <input
                          value={riderNameDraft}
                          onChange={(e) => setRiderNameDraft(e.target.value)}
                          placeholder="Name"
                          className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
                        />
                        <input
                          value={riderPhoneDraft}
                          onChange={(e) => setRiderPhoneDraft(e.target.value)}
                          placeholder="Phone"
                          className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={savingRider === o._id}
                            onClick={() => saveRider(o._id)}
                            className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
                          >
                            {savingRider === o._id ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={closeRiderEditor}
                            className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {editingCancellationOrderId === o._id ? (
                      <div className="mt-3 grid gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3">
                        <div className="text-xs font-semibold text-rose-800">Cancellation reason</div>
                        <select
                          value={cancelReasonDraft}
                          onChange={(e) => setCancelReasonDraft(e.target.value)}
                          className="rounded-xl border border-rose-200 px-3 py-2 text-xs"
                        >
                          {MERCHANT_CANCELLATION_REASONS.map((reason) => (
                            <option key={reason} value={reason}>
                              {getMerchantCancellationReasonLabel(reason)}
                            </option>
                          ))}
                        </select>
                        <textarea
                          value={cancelNoteDraft}
                          onChange={(e) => setCancelNoteDraft(e.target.value)}
                          placeholder="Optional note"
                          className="min-h-[84px] rounded-xl border border-rose-200 px-3 py-2 text-xs"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={savingCancellation === o._id}
                            onClick={() => saveCancellation(o._id)}
                            className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white"
                          >
                            {savingCancellation === o._id ? "Saving..." : "Confirm cancel"}
                          </button>
                          <button
                            type="button"
                            onClick={closeCancellationEditor}
                            className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700"
                          >
                            Back
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {editingIssueOrderId === o._id ? (
                      <div className="mt-3 grid gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                        <div className="text-xs font-semibold text-amber-800">Merchant issue report</div>
                        <select
                          value={issueTypeDraft}
                          onChange={(e) => setIssueTypeDraft(e.target.value)}
                          className="rounded-xl border border-amber-200 px-3 py-2 text-xs"
                        >
                          {MERCHANT_ISSUE_TYPES.map((issueType) => (
                            <option key={issueType} value={issueType}>
                              {getMerchantIssueTypeLabel(issueType)}
                            </option>
                          ))}
                        </select>
                        <textarea
                          value={issueNoteDraft}
                          onChange={(e) => setIssueNoteDraft(e.target.value)}
                          placeholder="Optional note"
                          className="min-h-[84px] rounded-xl border border-amber-200 px-3 py-2 text-xs"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={savingIssue === o._id}
                            onClick={() => saveIssue(o._id)}
                            className="rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-white"
                          >
                            {savingIssue === o._id ? "Saving..." : "Save issue"}
                          </button>
                          <button
                            type="button"
                            onClick={closeIssueEditor}
                            className="rounded-xl border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-700"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {recentEvents.length ? (
                      <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-xs font-semibold text-slate-700">Latest events</div>
                        <div className="mt-2 space-y-2">
                          {recentEvents.map((event, index) => (
                            <div key={`${o._id}-event-${index}`} className="text-xs text-slate-600">
                              <div className="font-semibold text-slate-700">
                                {event.label}
                                {event.actor ? ` - ${event.actor}` : ""}
                              </div>
                              {event.detail ? <div className="mt-0.5">{event.detail}</div> : null}
                              <div className="mt-0.5 text-slate-500">
                                {event.createdAt ? formatDateTime(event.createdAt) : "-"}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </MerchantPortalShell>
  );
}
