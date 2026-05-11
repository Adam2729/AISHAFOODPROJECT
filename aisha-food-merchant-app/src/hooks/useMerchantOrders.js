import { AppState } from "react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { mockOrders } from "@/src/data/mockData";
import { apiRequest } from "@/src/lib/api";
import { playSound } from "@/src/lib/soundManager";
import { speak } from "@/src/lib/voiceManager";

const ACTIVE_STATUSES = ["new", "accepted", "preparing", "ready", "out_for_delivery"];
const LIVE_FAST_STATUSES = ["new", "accepted", "preparing"];
const PAYMENT_PENDING_STATUSES = ["pending_payment"];
const DEFAULT_POLL_MS = 10000;
const FAST_POLL_MS = 3000;
const PAYMENT_POLL_MS = 2000;
const SLOW_POLL_MS = 15000;
const FAILURE_THRESHOLD = 3;
const MANUAL_REFRESH_DEBOUNCE_MS = 300;
const MUTATION_REFRESH_DEBOUNCE_MS = 450;

function normalizeCurrencyCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "DOP") return "DOP";
  if (normalized === "GBP") return "GBP";
  return "XOF";
}

function normalizeDeliveryMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "platform_driver") return "platform_driver";
  if (normalized === "both") return "both";
  return "self_delivery";
}

function normalizePaymentStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "paid") return "paid";
  if (normalized === "failed" || normalized === "cancelled") return "failed";
  return "pending";
}

function normalizeDriverStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    [
      "assigned",
      "arriving_at_restaurant",
      "picked_up",
      "on_the_way",
      "nearby",
      "delivered",
    ].includes(normalized)
  ) {
    return normalized;
  }
  return "";
}

function normalizeMoney(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeOptionalNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMerchantOrder(order) {
  const rawId = String(order?._id || order?.id || "").trim();
  if (!rawId) return null;

  const items = Array.isArray(order?.items)
    ? order.items.map((item, index) => ({
        id: String(item?._id || item?.id || item?.productId || `item-${index}`),
        name: String(item?.name || "Item"),
        quantity: Math.max(1, Number(item?.qty || item?.quantity || 1)),
        price: normalizeMoney(item?.unitPrice ?? item?.price ?? item?.productPrice ?? 0),
      }))
    : [];

  return {
    id: rawId,
    orderNumber: String(order?.orderNumber || rawId.slice(-6).toUpperCase()),
    customerName: String(order?.customerName || "Customer"),
    customerPhone: String(order?.phone || order?.customerPhone || "").trim(),
    items,
    total: normalizeMoney(order?.orderTotal ?? order?.total ?? 0),
    paymentMethod: String(order?.payment?.method || order?.paymentMethod || "cash"),
    paymentStatus: normalizePaymentStatus(order?.payment?.status || order?.paymentStatus),
    deliveryMode: normalizeDeliveryMode(
      order?.deliveryMode || order?.deliverySnapshot?.mode || order?.deliveryUi?.modeLabel
    ),
    address: String(order?.address || ""),
    deliveryNote: String(order?.notes || order?.deliveryNote || "").trim(),
    status: String(order?.status || "new"),
    createdAt: String(order?.createdAt || new Date().toISOString()),
    driverName: String(
      order?.dispatch?.assignedDriverName || order?.merchantDelivery?.riderName || order?.driverName || ""
    ).trim(),
    driverPhone: String(order?.dispatch?.assignedDriverPhone || order?.driverPhone || "").trim(),
    driverStatus: normalizeDriverStatus(order?.driverStatus || order?.dispatch?.driverDispatchStatus),
    driverEtaMinutes: normalizeOptionalNumber(order?.driverEtaMinutes),
    driverLastUpdatedAt: String(order?.driverLastUpdatedAt || order?.driverLocation?.updatedAt || "").trim() || null,
    driverLocation:
      order?.driverLocation && Number.isFinite(Number(order.driverLocation.latitude ?? order.driverLocation.lat))
        ? {
            latitude: Number(order.driverLocation.latitude ?? order.driverLocation.lat),
            longitude: Number(order.driverLocation.longitude ?? order.driverLocation.lng),
            lat: Number(order.driverLocation.lat ?? order.driverLocation.latitude),
            lng: Number(order.driverLocation.lng ?? order.driverLocation.longitude),
            updatedAt: String(order?.driverLocation?.updatedAt || "").trim() || null,
          }
        : null,
    deliveryFee: normalizeMoney(order?.deliveryFeeToCustomer ?? order?.deliveryFee ?? 0),
    currencyCode: normalizeCurrencyCode(order?.currency),
    raw: order,
  };
}

function byCreatedAtDesc(left, right) {
  return new Date(String(right?.createdAt || "")).getTime() - new Date(String(left?.createdAt || "")).getTime();
}

function buildDashboardStats(orders) {
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const newOrders = orders.filter((order) => order.status === "new").length;
  const preparing = orders.filter((order) => order.status === "preparing").length;
  const ready = orders.filter((order) => order.status === "ready").length;
  const activeOrders = orders.filter((order) => ACTIVE_STATUSES.includes(order.status)).length;
  const todaySales = orders
    .filter((order) => order.status !== "cancelled" && String(order.createdAt || "").startsWith(todayKey))
    .reduce((sum, order) => sum + normalizeMoney(order.total), 0);

  return {
    newOrders,
    preparing,
    ready,
    activeOrders,
    todaySales,
  };
}

function resolvePollInterval(orders, failedRequests) {
  if (failedRequests >= FAILURE_THRESHOLD) {
    return SLOW_POLL_MS;
  }
  if (orders.some((order) => PAYMENT_PENDING_STATUSES.includes(order.status))) {
    return PAYMENT_POLL_MS;
  }
  if (orders.some((order) => LIVE_FAST_STATUSES.includes(order.status))) {
    return FAST_POLL_MS;
  }
  return DEFAULT_POLL_MS;
}

async function submitOrderStatus(orderId, status, token) {
  const basePath = `/api/merchant/orders/${encodeURIComponent(String(orderId || "").trim())}`;
  const attempts = [
    () => apiRequest(basePath, "PATCH", { status }, token),
    () => apiRequest(`${basePath}/status`, "POST", { status }, token),
  ];

  if (status === "accepted") {
    attempts.push(() => apiRequest(`${basePath}/accept`, "POST", undefined, token));
  }
  if (status === "cancelled") {
    attempts.push(() => apiRequest(`${basePath}/reject`, "POST", undefined, token));
  }

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (error?.status === 404 || error?.status === 405) {
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("Could not update the order status.");
}

export function useMerchantOrders({ token, enabled, onUnauthorized }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [usingDemoData, setUsingDemoData] = useState(false);
  const [connectionSlow, setConnectionSlow] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [isLiveFastMode, setIsLiveFastMode] = useState(false);

  const inFlightRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const ordersRef = useRef([]);
  const failureCountRef = useRef(0);
  const debounceTimerRef = useRef(null);
  const previousStatusesRef = useRef(new Map());

  useEffect(() => {
    ordersRef.current = orders;
    setIsLiveFastMode(resolvePollInterval(orders, failureCountRef.current) < DEFAULT_POLL_MS);
  }, [orders]);

  useEffect(() => {
    const previousStatuses = previousStatusesRef.current;
    const nextStatuses = new Map();
    let deliveredTransitionDetected = false;

    orders.forEach((order) => {
      const orderId = String(order?.id || "").trim();
      const nextStatus = String(order?.status || "").trim().toLowerCase();
      if (!orderId) return;

      const previousStatus = String(previousStatuses.get(orderId) || "").trim().toLowerCase();
      if (previousStatus && previousStatus !== nextStatus && nextStatus === "delivered") {
        deliveredTransitionDetected = true;
      }

      nextStatuses.set(orderId, nextStatus);
    });

    previousStatusesRef.current = nextStatuses;

    if (deliveredTransitionDetected) {
      playSound("delivered_success").catch(() => null);
      speak("Order delivered");
    }
  }, [orders]);

  const runRefresh = useCallback(async (options = {}) => {
    const { silent = false } = options;

    if (!enabled || !token) {
      setOrders([]);
      setUsingDemoData(false);
      setLoading(false);
      setRefreshing(false);
      setConnectionSlow(false);
      setLastUpdatedAt("");
      failureCountRef.current = 0;
      return [];
    }

    if (inFlightRef.current) {
      return ordersRef.current;
    }

    inFlightRef.current = true;
    if (!silent) {
      if (ordersRef.current.length) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
    }

    try {
      const response = await apiRequest("/api/merchant/orders", "GET", undefined, token);
      const normalized = Array.isArray(response?.orders)
        ? response.orders.map(normalizeMerchantOrder).filter(Boolean).sort(byCreatedAtDesc)
        : [];
      failureCountRef.current = 0;
      setOrders(normalized);
      setUsingDemoData(false);
      setError("");
      setConnectionSlow(false);
      setLastUpdatedAt(new Date().toISOString());
      return normalized;
    } catch (requestError) {
      if (requestError?.status === 401) {
        setOrders([]);
        setUsingDemoData(false);
        setError("Your session expired. Please sign in again.");
        setConnectionSlow(false);
        onUnauthorized?.();
        return [];
      }
      if (requestError?.status === 403) {
        setOrders([]);
        setUsingDemoData(false);
        setError(requestError?.message || "Your merchant account cannot load orders right now.");
        setConnectionSlow(false);
        return [];
      }

      failureCountRef.current += 1;
      setConnectionSlow(failureCountRef.current >= FAILURE_THRESHOLD);
      const message =
        requestError?.message ||
        "Cannot connect to OranjeEats server. Check EXPO_PUBLIC_API_URL and backend.";
      setError(message);
      if (!ordersRef.current.length) {
        setOrders(mockOrders);
        setUsingDemoData(true);
      }
      return ordersRef.current.length ? ordersRef.current : mockOrders;
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [enabled, onUnauthorized, token]);

  const refreshOrders = useCallback(
    (options = {}) => {
    const {
        silent = false,
        debounceMs = 0,
      } = options;

      const waitMs = Math.max(
        0,
        Number(debounceMs || (silent ? 0 : MANUAL_REFRESH_DEBOUNCE_MS))
      );
      if (!waitMs) {
        return runRefresh({ silent });
      }

      return new Promise((resolve, reject) => {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
          debounceTimerRef.current = null;
          runRefresh({ silent }).then(resolve).catch(reject);
        }, waitMs);
      });
    },
    [runRefresh]
  );

  const updateOrderStatus = useCallback(async (orderId, status) => {
    if (!token) {
      throw new Error("You are not signed in.");
    }

    try {
      const response = await submitOrderStatus(orderId, status, token);
      const updated = normalizeMerchantOrder(response?.order || null);
      setOrders((current) =>
        current
          .map((order) => (order.id === String(orderId) ? updated || { ...order, status } : order))
          .filter(Boolean)
          .sort(byCreatedAtDesc)
      );
      setError("");
      if (status === "accepted") {
        playSound("accepted").catch(() => null);
      }
      refreshOrders({ silent: true, debounceMs: MUTATION_REFRESH_DEBOUNCE_MS }).catch(() => null);
      return updated;
    } catch (requestError) {
      if (requestError?.status === 401) {
        onUnauthorized?.();
      }
      throw requestError;
    }
  }, [onUnauthorized, refreshOrders, token]);

  const acceptOrder = useCallback(async (orderId) => updateOrderStatus(orderId, "accepted"), [updateOrderStatus]);
  const rejectOrder = useCallback(async (orderId) => updateOrderStatus(orderId, "cancelled"), [updateOrderStatus]);

  useEffect(() => {
    if (!enabled || !token) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    let timerId = null;

    const scheduleNextPoll = () => {
      if (cancelled || appStateRef.current !== "active") {
        return;
      }
      const intervalMs = resolvePollInterval(ordersRef.current, failureCountRef.current);
      setIsLiveFastMode(intervalMs < DEFAULT_POLL_MS && failureCountRef.current < FAILURE_THRESHOLD);
      timerId = setTimeout(() => {
        runRefresh({ silent: true })
          .catch(() => null)
          .finally(() => {
            scheduleNextPoll();
          });
      }, intervalMs);
    };

    runRefresh({ silent: false })
      .catch(() => null)
      .finally(() => {
        scheduleNextPoll();
      });

    const subscription = AppState.addEventListener("change", (nextState) => {
      const wasBackgrounded = appStateRef.current !== "active" && nextState === "active";
      appStateRef.current = nextState;

      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (nextState === "active") {
        if (wasBackgrounded) {
          runRefresh({ silent: true })
            .catch(() => null)
            .finally(() => {
              scheduleNextPoll();
            });
        } else {
          scheduleNextPoll();
        }
      }
    });

    return () => {
      cancelled = true;
      if (timerId) {
        clearTimeout(timerId);
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      subscription.remove();
    };
  }, [enabled, runRefresh, token]);

  const newOrder = useMemo(() => {
    return orders.find((order) => order.status === "new") || null;
  }, [orders]);

  const dashboardStats = useMemo(() => buildDashboardStats(orders), [orders]);

  return {
    orders,
    loading,
    refreshing,
    error,
    usingDemoData,
    connectionSlow,
    lastUpdatedAt,
    isLiveFastMode,
    refreshOrders,
    newOrder,
    acceptOrder,
    rejectOrder,
    updateOrderStatus,
    dashboardStats,
    getOrderById: (orderId) => orders.find((order) => order.id === String(orderId || "")),
  };
}
