import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { fetchDriverEarnings, fetchDriverPayouts, requestDriverPayout } from "../lib/api";
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
  const [payoutSnapshot, setPayoutSnapshot] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [requestingPayout, setRequestingPayout] = useState(false);
  const [error, setError] = useState("");

  const loadSummary = useCallback(async (nextRefreshing = false) => {
    if (nextRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");

    try {
      const [earningsResponse, payoutResponse] = await Promise.all([
        fetchDriverEarnings(),
        fetchDriverPayouts(),
      ]);
      setSummary(earningsResponse && typeof earningsResponse === "object" ? earningsResponse : {});
      setPayoutSnapshot(payoutResponse && typeof payoutResponse === "object" ? payoutResponse : {});
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
  const payoutProfile =
    payoutSnapshot?.payoutProfile && typeof payoutSnapshot.payoutProfile === "object"
      ? payoutSnapshot.payoutProfile
      : null;
  const payoutRequests = Array.isArray(payoutSnapshot?.payoutRequests)
    ? payoutSnapshot.payoutRequests
    : [];
  const pendingPayoutRows = Array.isArray(payoutSnapshot?.payouts) ? payoutSnapshot.payouts : [];
  const openPayoutRequest =
    payoutRequests.find((request) =>
      ["requested", "approved"].includes(String(request?.status || "").trim().toLowerCase())
    ) || null;
  const payoutMethodLabel = (() => {
    switch (String(payoutProfile?.payoutMethod || "").trim()) {
      case "orange_money":
        return "Orange Money";
      case "moov_money":
        return "Moov Money";
      case "wave":
        return "Wave";
      case "bank_transfer":
        return "Bank transfer";
      case "cash":
        return "Cash";
      default:
        return "Not set";
    }
  })();

  const canRequestPayout =
    availableAmount > 0 &&
    !openPayoutRequest &&
    !requestingPayout &&
    Boolean(String(payoutProfile?.payoutAccountNumber || "").trim());

  const handleRequestPayout = useCallback(async () => {
    if (availableAmount <= 0) {
      Alert.alert("No available balance", "You can only request payout after eligible deliveries are added to your balance.");
      return;
    }
    if (!payoutProfile?.payoutAccountNumber) {
      Alert.alert(
        "Payout details missing",
        "Your payout method or account is missing. Contact support before requesting payout."
      );
      return;
    }
    if (openPayoutRequest) {
      Alert.alert(
        "Request already open",
        "A payout request is already pending review. Wait for admin processing before sending another request."
      );
      return;
    }

    setRequestingPayout(true);
    setError("");
    try {
      const response = await requestDriverPayout();
      Alert.alert(
        "Payout request sent",
        "Payout request sent. Admin will pay by your selected method."
      );
      setPayoutSnapshot((current) => {
        const existingRequests = Array.isArray(current?.payoutRequests) ? current.payoutRequests : [];
        return {
          ...(current && typeof current === "object" ? current : {}),
          payoutRequests: [
            {
              id: response?.requestId || "",
              status: response?.status || "requested",
              requestedAmount: Number(response?.requestedAmount || availableAmount),
              requestedAt: new Date().toISOString(),
              payoutMethod: response?.payoutMethod || payoutProfile?.payoutMethod || "cash",
              payoutAccountName: response?.payoutAccountName || payoutProfile?.payoutAccountName || "",
              payoutAccountNumber:
                response?.payoutAccountNumber || payoutProfile?.payoutAccountNumber || "",
              adminNote: "",
              rejectionReason: "",
              payoutReference: "",
              deliveryCount: Number(response?.deliveryCount || pendingPayoutRows.length || 0),
            },
            ...existingRequests,
          ],
        };
      });
      await loadSummary(true);
    } catch (requestError) {
      setError(requestError?.message || "Unable to request payout.");
    } finally {
      setRequestingPayout(false);
    }
  }, [
    availableAmount,
    loadSummary,
    openPayoutRequest,
    payoutProfile?.payoutAccountName,
    payoutProfile?.payoutAccountNumber,
    payoutProfile?.payoutMethod,
    pendingPayoutRows.length,
  ]);

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

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Payout profile</Text>
          <Text style={styles.cardText}>Method: {payoutMethodLabel}</Text>
          <Text style={styles.cardText}>
            Account holder: {String(payoutProfile?.payoutAccountName || "Not configured")}
          </Text>
          <Text style={styles.cardText}>
            Account: {String(payoutProfile?.payoutAccountNumber || "Not configured")}
          </Text>
          {payoutProfile?.payoutNotes ? (
            <Text style={styles.cardText}>Notes: {String(payoutProfile.payoutNotes)}</Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Request payout</Text>
          <Text style={styles.cardText}>
            Available for request: {formatCurrency(availableAmount, currency)}
          </Text>
          <Text style={styles.cardText}>
            Pending payout rows: {pendingPayoutRows.length}
          </Text>
          {openPayoutRequest ? (
            <View style={styles.noticeCard}>
              <Text style={styles.noticeTitle}>Open request</Text>
              <Text style={styles.noticeText}>
                {formatCurrency(openPayoutRequest.requestedAmount, currency)} ·{" "}
                {String(openPayoutRequest.status || "").replace(/_/g, " ")}
              </Text>
              <Text style={styles.noticeText}>
                Requested: {formatDateTime(openPayoutRequest.requestedAt)}
              </Text>
            </View>
          ) : null}
          <Pressable
            onPress={handleRequestPayout}
            disabled={!canRequestPayout}
            style={({ pressed }) => [
              styles.primaryButton,
              (!canRequestPayout || requestingPayout) && styles.primaryButtonDisabled,
              pressed && canRequestPayout ? styles.primaryButtonPressed : null,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {requestingPayout ? "Sending request..." : "Request payout"}
            </Text>
          </Pressable>
          <Text style={styles.helpText}>
            {openPayoutRequest
              ? "A payout request is already open. Wait for admin approval or payment."
              : !payoutProfile?.payoutAccountNumber
                ? "Your payout details are missing. Contact support to update your payout method."
                : "Admin will pay by your selected method after reviewing the request."}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recent payout requests</Text>
          {payoutRequests.length ? (
            payoutRequests.map((request, index) => (
              <View
                key={String(request.id || `${request.requestedAt || "request"}-${request.status || "unknown"}-${index}`)}
                style={styles.requestRow}
              >
                <View style={styles.requestRowHeader}>
                  <Text style={styles.requestAmount}>
                    {formatCurrency(Number(request.requestedAmount || 0), currency)}
                  </Text>
                  <Text style={styles.requestStatus}>
                    {String(request.status || "requested").replace(/_/g, " ")}
                  </Text>
                </View>
                <Text style={styles.cardText}>Requested: {formatDateTime(request.requestedAt)}</Text>
                {request.payoutReference ? (
                  <Text style={styles.cardText}>Reference: {String(request.payoutReference)}</Text>
                ) : null}
                {request.rejectionReason ? (
                  <Text style={styles.rejectionText}>Reason: {String(request.rejectionReason)}</Text>
                ) : null}
              </View>
            ))
          ) : (
            <Text style={styles.cardText}>No payout requests yet.</Text>
          )}
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
  primaryButton: {
    marginTop: 14,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "#F97316",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  primaryButtonPressed: {
    opacity: 0.92,
  },
  primaryButtonDisabled: {
    backgroundColor: "#FDBA74",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  helpText: {
    marginTop: 10,
    color: "#64748B",
    fontSize: 13,
    lineHeight: 18,
  },
  noticeCard: {
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#FED7AA",
    backgroundColor: "#FFF7ED",
    padding: 12,
    gap: 4,
  },
  noticeTitle: {
    color: "#C2410C",
    fontSize: 13,
    fontWeight: "800",
  },
  noticeText: {
    color: "#9A3412",
    fontSize: 13,
  },
  requestRow: {
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#F8FAFC",
    padding: 12,
    gap: 4,
  },
  requestRowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  requestAmount: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "900",
  },
  requestStatus: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  rejectionText: {
    color: "#B91C1C",
    fontSize: 13,
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
