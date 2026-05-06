import { Redirect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import EarningsSummary from "@/src/components/EarningsSummary";
import ScreenHeader from "@/src/components/ScreenHeader";
import { useMerchantApp } from "@/src/context/MerchantAppContext";
import { type MerchantOrder } from "@/src/data/mockData";
import { formatCurrency } from "@/src/lib/formatters";
import { apiRequest } from "@/src/lib/api";
import { colors } from "@/src/theme/colors";

type StatementPack = {
  settlement?: { status?: string | null } | null;
  cash?: { status?: string | null } | null;
  totals?: {
    orderTotal?: number | null;
    deliveryFeeTotal?: number | null;
    commissionTotal?: number | null;
    merchantNetAfterCommission?: number | null;
    cashExpected?: number | null;
    cashReported?: number | null;
    cashVerified?: number | null;
  } | null;
};

type PerformanceSummary = {
  todaySales: number;
  weeklySales: number;
  topDishes: { name: string; quantity: number; revenue: number }[];
  missedOrders: number;
  averagePrepTime: number;
  acceptedOrders: number;
  rejectedOrders: number;
  readyOrders: number;
  cancelledOrders: number;
};

function buildFallbackSummary(orders: MerchantOrder[]) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const deliveredOrders = orders.filter((order) => order.status === "delivered");
  const todaySales = deliveredOrders
    .filter((order) => String(order.createdAt || "").startsWith(todayKey))
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const weeklySales = deliveredOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const deliveryFees = deliveredOrders.reduce((sum, order) => sum + Number(order.deliveryFee || 0), 0);
  const commission = Math.round(weeklySales * 0.08);
  const merchantNet = weeklySales - commission;
  const cashToReconcile = deliveredOrders
    .filter((order) => String(order.paymentMethod || "").toLowerCase() === "cash")
    .reduce((sum, order) => sum + Number(order.total || 0), 0);

  return {
    todaySales,
    weeklySales,
    deliveryFees,
    commission,
    merchantNet,
    pendingSettlement: merchantNet,
    paidSettlement: 0,
    cashToReconcile,
    settlementStatus: "Weekly statement unavailable. Showing delivered-order fallback.",
  };
}

function buildFallbackPerformance(orders: MerchantOrder[]): PerformanceSummary {
  const todayKey = new Date().toISOString().slice(0, 10);
  const topDishMap = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const order of orders) {
    for (const item of order.items) {
      const existing = topDishMap.get(item.name) || {
        name: item.name,
        quantity: 0,
        revenue: 0,
      };
      existing.quantity += Number(item.quantity || 0);
      existing.revenue += Number(item.quantity || 0) * Number(item.price || 0);
      topDishMap.set(item.name, existing);
    }
  }

  return {
    todaySales: orders
      .filter((order) => order.status === "delivered" && String(order.createdAt || "").startsWith(todayKey))
      .reduce((sum, order) => sum + Number(order.total || 0), 0),
    weeklySales: orders
      .filter((order) => order.status === "delivered")
      .reduce((sum, order) => sum + Number(order.total || 0), 0),
    topDishes: Array.from(topDishMap.values())
      .sort((left, right) => right.quantity - left.quantity || right.revenue - left.revenue)
      .slice(0, 5),
    missedOrders: orders.filter((order) => order.status === "new").length,
    averagePrepTime: 0,
    acceptedOrders: orders.filter((order) => order.status === "accepted").length,
    rejectedOrders: 0,
    readyOrders: orders.filter((order) => order.status === "ready").length,
    cancelledOrders: orders.filter((order) => order.status === "cancelled").length,
  };
}

function buildStatementSummary(pack: StatementPack, orders: MerchantOrder[]) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const todaySales = orders
    .filter((order) => order.status === "delivered" && String(order.createdAt || "").startsWith(todayKey))
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const settlementStatus = String(pack?.settlement?.status || "pending").trim().toLowerCase();
  const merchantNet = Number(pack?.totals?.merchantNetAfterCommission || 0);
  const cashExpected = Number(pack?.totals?.cashExpected || 0);
  const cashVerified =
    pack?.totals?.cashVerified == null ? Number(pack?.totals?.cashReported || 0) : Number(pack?.totals?.cashVerified || 0);

  return {
    todaySales,
    weeklySales: Number(pack?.totals?.orderTotal || 0),
    deliveryFees: Number(pack?.totals?.deliveryFeeTotal || 0),
    commission: Number(pack?.totals?.commissionTotal || 0),
    merchantNet,
    pendingSettlement: settlementStatus === "pending" ? merchantNet : 0,
    paidSettlement: settlementStatus === "collected" || settlementStatus === "locked" ? merchantNet : 0,
    cashToReconcile: Math.max(cashExpected - cashVerified, 0),
    settlementStatus: `Settlement: ${settlementStatus || "pending"} / Cash: ${String(pack?.cash?.status || "not submitted")}`,
  };
}

export default function PaymentsScreen() {
  const { authState, merchantProfile, orders, token, usingDemoData } = useMerchantApp();
  const [summary, setSummary] = useState(() => buildFallbackSummary(orders));
  const [performance, setPerformance] = useState<PerformanceSummary>(() => buildFallbackPerformance(orders));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showDemo, setShowDemo] = useState(usingDemoData);

  const refreshSummary = useCallback(async ({ silent = false } = {}) => {
    if (!token) {
      setSummary(buildFallbackSummary(orders));
      setPerformance(buildFallbackPerformance(orders));
      setShowDemo(true);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const [statementResult, performanceResult] = await Promise.allSettled([
        apiRequest("/api/merchant/statements/weekly", "GET", undefined, token),
        apiRequest("/api/merchant/performance", "GET", undefined, token),
      ]);
      const nextSummary =
        statementResult.status === "fulfilled"
          ? buildStatementSummary(statementResult.value?.pack || {}, orders)
          : buildFallbackSummary(orders);
      const nextPerformance =
        performanceResult.status === "fulfilled"
          ? {
              todaySales: Number(performanceResult.value?.todaySales || 0),
              weeklySales: Number(performanceResult.value?.weeklySales || 0),
              topDishes: Array.isArray(performanceResult.value?.topDishes)
                ? performanceResult.value.topDishes
                : [],
              missedOrders: Number(performanceResult.value?.missedOrders || 0),
              averagePrepTime: Number(performanceResult.value?.averagePrepTime || 0),
              acceptedOrders: Number(performanceResult.value?.acceptedOrders || 0),
              rejectedOrders: Number(performanceResult.value?.rejectedOrders || 0),
              readyOrders: Number(performanceResult.value?.readyOrders || 0),
              cancelledOrders: Number(performanceResult.value?.cancelledOrders || 0),
            }
          : buildFallbackPerformance(orders);
      setSummary(nextSummary);
      setPerformance(nextPerformance);
      setShowDemo(statementResult.status !== "fulfilled" || performanceResult.status !== "fulfilled");
      setError("");
    } catch (requestError: unknown) {
      if ((requestError as { status?: number })?.status === 401) {
        setSummary(buildFallbackSummary([]));
        setPerformance(buildFallbackPerformance([]));
        setShowDemo(false);
        setError("Your session expired. Please sign in again.");
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if ((requestError as { status?: number })?.status === 403) {
        setSummary(buildFallbackSummary([]));
        setPerformance(buildFallbackPerformance([]));
        setShowDemo(false);
        setError(
          (requestError as { message?: string })?.message ||
            "Your merchant account cannot load statement data right now."
        );
        setLoading(false);
        setRefreshing(false);
        return;
      }
      setSummary(buildFallbackSummary(orders));
      setPerformance(buildFallbackPerformance(orders));
      setShowDemo(true);
      setError(
        (requestError as { message?: string })?.message ||
          "Could not load the weekly statement. Showing fallback totals."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orders, token]);

  useEffect(() => {
    refreshSummary().catch(() => null);
  }, [refreshSummary]);

  if (authState !== "approved") {
    return <Redirect href={authState === "pending" ? "/pending" : "/login"} />;
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => refreshSummary({ silent: true })}
          tintColor={colors.primary}
        />
      }
    >
      <ScreenHeader
        title="Payments"
        subtitle="Track sales, commission and settlement status."
        rightActionLabel="Refresh"
        onRightActionPress={() => refreshSummary({ silent: true })}
      />

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Payments refresh issue</Text>
          <Text style={styles.errorBody}>{error}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loadingCard}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>Loading payments data...</Text>
        </View>
      ) : (
        <>
          <EarningsSummary
            summary={summary}
            formatMoney={(value: number) => formatCurrency(value, merchantProfile.currencyCode)}
            usingDemoData={showDemo}
          />

          <View style={styles.performanceCard}>
            <Text style={styles.performanceTitle}>Merchant performance</Text>
            <View style={styles.performanceGrid}>
              <MetricCell label="Today sales" value={formatCurrency(performance.todaySales, merchantProfile.currencyCode)} />
              <MetricCell label="Weekly sales" value={formatCurrency(performance.weeklySales, merchantProfile.currencyCode)} />
              <MetricCell label="Missed orders" value={String(performance.missedOrders)} />
              <MetricCell label="Average prep" value={`${performance.averagePrepTime} min`} />
              <MetricCell label="Accepted" value={String(performance.acceptedOrders)} />
              <MetricCell label="Rejected" value={String(performance.rejectedOrders)} />
              <MetricCell label="Ready" value={String(performance.readyOrders)} />
              <MetricCell label="Cancelled" value={String(performance.cancelledOrders)} />
            </View>
            <Text style={styles.performanceTitle}>Top dishes</Text>
            {performance.topDishes.length ? (
              performance.topDishes.map((dish, index) => (
                <View key={`${dish.name}-${index}`} style={styles.topDishRow}>
                  <View style={styles.topDishMeta}>
                    <Text style={styles.topDishName}>{dish.name}</Text>
                    <Text style={styles.topDishHint}>{dish.quantity} sold</Text>
                  </View>
                  <Text style={styles.topDishValue}>
                    {formatCurrency(Number(dish.revenue || 0), merchantProfile.currencyCode)}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.emptyStateText}>No dish performance data yet.</Text>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCell}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingBottom: 36,
    backgroundColor: colors.background,
    gap: 18,
  },
  errorCard: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#F4B7B2",
    padding: 16,
    gap: 6,
  },
  errorTitle: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: "900",
  },
  errorBody: {
    color: colors.muted,
    lineHeight: 19,
  },
  loadingCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 10,
    alignItems: "center",
  },
  loadingText: {
    color: colors.muted,
    fontWeight: "700",
  },
  performanceCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 14,
  },
  performanceTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  performanceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  metricCell: {
    width: "47%",
    borderRadius: 18,
    backgroundColor: colors.surfaceAlt,
    padding: 14,
    gap: 6,
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  metricValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  topDishRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  topDishMeta: {
    flex: 1,
    gap: 4,
  },
  topDishName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  topDishHint: {
    color: colors.muted,
    fontSize: 13,
  },
  topDishValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  emptyStateText: {
    color: colors.muted,
    lineHeight: 20,
  },
});
