import { AppState } from "react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { mockOrders } from "@/src/data/mockData";
import { apiRequest } from "@/src/lib/api";

const ACTIVE_STATUSES = ["new", "accepted", "preparing", "ready", "out_for_delivery"];

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

function normalizeMoney(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

  const inFlightRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const ordersRef = useRef([]);

  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  const refreshOrders = useCallback(async (options = {}) => {
    const { silent = false } = options;

    if (!enabled || !token) {
      setOrders([]);
      setUsingDemoData(false);
      setLoading(false);
      setRefreshing(false);
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
      setOrders(normalized);
      setUsingDemoData(false);
      setError("");
      return normalized;
    } catch (requestError) {
      if (requestError?.status === 401) {
        setOrders([]);
        setUsingDemoData(false);
        setError("Your session expired. Please sign in again.");
        onUnauthorized?.();
        return [];
      }
      if (requestError?.status === 403) {
        setOrders([]);
        setUsingDemoData(false);
        setError(requestError?.message || "Your merchant account cannot load orders right now.");
        return [];
      }

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
      return updated;
    } catch (requestError) {
      if (requestError?.status === 401) {
        onUnauthorized?.();
      }
      throw requestError;
    }
  }, [onUnauthorized, token]);

  const acceptOrder = useCallback(async (orderId) => updateOrderStatus(orderId, "accepted"), [updateOrderStatus]);
  const rejectOrder = useCallback(async (orderId) => updateOrderStatus(orderId, "cancelled"), [updateOrderStatus]);

  useEffect(() => {
    if (!enabled || !token) {
      setLoading(false);
      return undefined;
    }

    refreshOrders().catch(() => null);

    const startPolling = () => {
      return setInterval(() => {
        if (appStateRef.current === "active") {
          refreshOrders({ silent: true }).catch(() => null);
        }
      }, 10000);
    };

    let intervalId = startPolling();
    const subscription = AppState.addEventListener("change", (nextState) => {
      const wasBackgrounded = appStateRef.current !== "active" && nextState === "active";
      appStateRef.current = nextState;

      clearInterval(intervalId);
      if (nextState === "active") {
        intervalId = startPolling();
        if (wasBackgrounded) {
          refreshOrders({ silent: true }).catch(() => null);
        }
      }
    });

    return () => {
      clearInterval(intervalId);
      subscription.remove();
    };
  }, [enabled, refreshOrders, token]);

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
    refreshOrders,
    newOrder,
    acceptOrder,
    rejectOrder,
    updateOrderStatus,
    dashboardStats,
    getOrderById: (orderId) => orders.find((order) => order.id === String(orderId || "")),
  };
}
