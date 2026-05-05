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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showDemo, setShowDemo] = useState(usingDemoData);

  const refreshSummary = useCallback(async ({ silent = false } = {}) => {
    if (!token) {
      setSummary(buildFallbackSummary(orders));
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
      const response = await apiRequest("/api/merchant/statements/weekly", "GET", undefined, token);
      const nextSummary = buildStatementSummary(response?.pack || {}, orders);
      setSummary(nextSummary);
      setShowDemo(false);
      setError("");
    } catch (requestError: unknown) {
      if ((requestError as { status?: number })?.status === 401) {
        setSummary(buildFallbackSummary([]));
        setShowDemo(false);
        setError("Your session expired. Please sign in again.");
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if ((requestError as { status?: number })?.status === 403) {
        setSummary(buildFallbackSummary([]));
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
        <EarningsSummary
          summary={summary}
          formatMoney={(value: number) => formatCurrency(value, merchantProfile.currencyCode)}
          usingDemoData={showDemo}
        />
      )}
    </ScrollView>
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
});
