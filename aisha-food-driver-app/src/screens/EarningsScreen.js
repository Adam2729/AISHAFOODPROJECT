import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { fetchDriverEarnings } from "../lib/api";
import { formatCurrency, formatDateTime } from "../lib/orderUtils";

function metricValue(summary, keys, fallback = 0) {
  for (const key of keys) {
    const numericValue = Number(summary?.[key]);
    if (Number.isFinite(numericValue)) return numericValue;
  }

  return fallback;
}

export default function EarningsScreen() {
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadSummary = useCallback(async (nextRefreshing = false) => {
    if (nextRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");

    try {
      const response = await fetchDriverEarnings();
      setSummary(response && typeof response === "object" ? response : {});
    } catch (requestError) {
      setError(requestError?.message || "Unable to load earnings.");
    } finally {
      if (nextRefreshing) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSummary().catch(() => null);
      return undefined;
    }, [loadSummary])
  );

  const currency = String(summary?.currency || summary?.city?.currency || "CFA").trim() || "CFA";
  const totalEarnings = metricValue(summary, ["totalEarnings", "completedOrdersEarnings"]);
  const availableAmount = metricValue(summary, ["availableBalance", "pendingAmount"]);
  const deliveredCount = metricValue(summary, ["completedOrders", "completedOrdersCount", "deliveredCount"]);
  const pendingCount = metricValue(summary, ["pendingOrders", "pendingCount"]);
  const lastPayoutAt = String(summary?.lastPayoutAt || summary?.lastSettledAt || "").trim();
  const earningsSource = String(summary?.earningsSource || "").trim();

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadSummary(true)} tintColor="#F97316" />
        }
      >
        <Text style={styles.title}>Driver earnings</Text>
        <Text style={styles.subtitle}>
          Summary is based on platform-driver payouts where available, with delivered order
          expected payout as a safe fallback.
        </Text>

        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color="#F97316" />
            <Text style={styles.stateText}>Loading earnings...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.stateCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Total earned</Text>
            <Text style={styles.metricValue}>{formatCurrency(totalEarnings, currency)}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Available payout</Text>
            <Text style={styles.metricValue}>{formatCurrency(availableAmount, currency)}</Text>
          </View>
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Delivered</Text>
            <Text style={styles.metricValue}>{deliveredCount}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Pending</Text>
            <Text style={styles.metricValue}>{pendingCount}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Settlement</Text>
          <Text style={styles.cardText}>Week: {String(summary?.weekKey || "Current week")}</Text>
          <Text style={styles.cardText}>
            Last payout: {lastPayoutAt ? formatDateTime(lastPayoutAt) : "No payout data yet"}
          </Text>
          <Text style={styles.cardText}>
            Source: {earningsSource || "No payout source yet"}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 14,
  },
  title: {
    color: "#0F172A",
    fontSize: 28,
    fontWeight: "900",
  },
  subtitle: {
    color: "#64748B",
    lineHeight: 20,
  },
  metricsRow: {
    flexDirection: "row",
    gap: 12,
  },
  metricCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 18,
    padding: 16,
    gap: 8,
  },
  metricLabel: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "700",
  },
  metricValue: {
    color: "#0F172A",
    fontSize: 24,
    fontWeight: "900",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 18,
    padding: 16,
    gap: 8,
  },
  cardTitle: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "900",
  },
  cardText: {
    color: "#334155",
  },
  stateCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 18,
    padding: 20,
    gap: 10,
    alignItems: "center",
  },
  stateText: {
    color: "#64748B",
  },
  errorText: {
    color: "#B91C1C",
    textAlign: "center",
  },
});
