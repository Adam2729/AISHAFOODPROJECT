import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import Logo from "@/src/components/Logo";
import NewOrderPopup from "@/src/components/NewOrderPopup";
import OrangeButton from "@/src/components/OrangeButton";
import OrderCancellationModal, {
  buildMerchantCancellationPayload,
} from "@/src/components/OrderCancellationModal";
import OrderCard from "@/src/components/OrderCard";
import ScreenHeader from "@/src/components/ScreenHeader";
import StatCard from "@/src/components/StatCard";
import { useMerchantApp } from "@/src/context/MerchantAppContext";
import { type MerchantOrder } from "@/src/data/mockData";
import { formatCurrency } from "@/src/lib/formatters";
import { colors } from "@/src/theme/colors";

export default function HomeDashboardScreen() {
  const router = useRouter();
  const {
    authState,
    acceptOrder,
    dashboardStats,
    merchantProfile,
    newOrder,
    orders,
    ordersConnectionSlow,
    ordersError,
    ordersIsLiveFastMode,
    ordersLastUpdatedAt,
    ordersLoading,
    ordersRefreshing,
    refreshOrders,
    rejectOrder,
    storeOpen,
    toggleStoreOpen,
    usingDemoData,
  } = useMerchantApp();
  const [toggleBusy, setToggleBusy] = useState(false);
  const [rejectingOrderId, setRejectingOrderId] = useState("");
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [selectedCancellationReason, setSelectedCancellationReason] = useState("");
  const [cancellationNote, setCancellationNote] = useState("");
  const [cancellationError, setCancellationError] = useState("");
  const [cancelSubmitting, setCancelSubmitting] = useState(false);

  if (authState !== "approved") {
    return <Redirect href={authState === "pending" ? "/pending" : "/login"} />;
  }

  const activeOrders = orders.filter((order) =>
    ["new", "accepted", "preparing", "ready", "out_for_delivery"].includes(order.status)
  );
  const featuredOrder = activeOrders[0] || null;
  const lastUpdatedLabel = ordersLastUpdatedAt
    ? new Date(ordersLastUpdatedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Waiting for first sync";

  async function onToggleStoreOpen() {
    try {
      setToggleBusy(true);
      await toggleStoreOpen();
    } catch (error: unknown) {
      Alert.alert(
        "Store status",
        (error as { message?: string })?.message || "Could not update the store status."
      );
    } finally {
      setToggleBusy(false);
    }
  }

  async function onAccept(orderId: string) {
    try {
      await acceptOrder(orderId);
    } catch (error: unknown) {
      Alert.alert(
        "Order update",
        (error as { message?: string })?.message || "Could not accept the order."
      );
    }
  }

  async function onReject(orderId: string) {
    setRejectingOrderId(orderId);
    setCancellationError("");
    setCancelModalVisible(true);
  }

  function resetCancellationModal() {
    setCancelModalVisible(false);
    setRejectingOrderId("");
    setSelectedCancellationReason("");
    setCancellationNote("");
    setCancellationError("");
    setCancelSubmitting(false);
  }

  async function confirmCancellation() {
    if (!selectedCancellationReason) {
      setCancellationError("Please select a cancellation reason.");
      return;
    }
    if (!rejectingOrderId) {
      resetCancellationModal();
      return;
    }

    try {
      setCancelSubmitting(true);
      await rejectOrder(
        rejectingOrderId,
        buildMerchantCancellationPayload(selectedCancellationReason, cancellationNote)
      );
      resetCancellationModal();
      Alert.alert("Order cancelled", "The order was cancelled successfully.");
    } catch (error: unknown) {
      setCancellationError(
        (error as { message?: string })?.message || "Could not reject the order."
      );
      setCancelSubmitting(false);
    }
  }

  return (
    <>
      <NewOrderPopup
        order={usingDemoData ? null : newOrder}
        onAccept={(order: MerchantOrder) => onAccept(order.id)}
        onReject={(order: MerchantOrder) => onReject(order.id)}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={ordersRefreshing}
            onRefresh={() => refreshOrders()}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.brandBanner}>
          <Logo width={110} height={44} />
          <Text style={styles.brandBannerText}>OranjeEats Merchant</Text>
        </View>

        <ScreenHeader
          title={merchantProfile.restaurantName}
          subtitle="Manage live orders, menu and payouts"
          rightNode={
            <View style={styles.switchWrap}>
              <Text style={styles.switchText}>{storeOpen ? "Open" : "Closed"}</Text>
              <Switch
                value={storeOpen}
                disabled={toggleBusy}
                onValueChange={onToggleStoreOpen}
                trackColor={{ false: "#E7E5E4", true: "#FFB47D" }}
                thumbColor={storeOpen ? colors.primary : "#FFFFFF"}
              />
            </View>
          }
        />

        {usingDemoData ? (
          <View style={styles.demoBanner}>
            <Text style={styles.demoBannerText}>Demo data</Text>
          </View>
        ) : null}

        <View style={styles.liveStrip}>
          <View style={styles.livePill}>
            <View
              style={[
                styles.liveDot,
                ordersConnectionSlow
                  ? styles.liveDotSlow
                  : ordersIsLiveFastMode
                  ? styles.liveDotFast
                  : styles.liveDotStandard,
              ]}
            />
            <Text style={styles.livePillText}>
              {ordersConnectionSlow ? "Connection slow" : ordersIsLiveFastMode ? "Live" : "Syncing"}
            </Text>
          </View>
          <Text style={styles.liveMetaText}>Last updated: {lastUpdatedLabel}</Text>
        </View>

        {ordersError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Orders refresh issue</Text>
            <Text style={styles.errorBody}>{ordersError}</Text>
          </View>
        ) : null}

        <View style={styles.statsGrid}>
          <StatCard label="New orders" value={String(dashboardStats.newOrders)} icon="notifications-outline" />
          <StatCard label="Preparing" value={String(dashboardStats.preparing)} icon="flame-outline" accent={colors.primaryDark} />
          <StatCard label="Ready" value={String(dashboardStats.ready)} icon="checkmark-circle-outline" accent={colors.success} />
          <StatCard
            label="Today sales"
            value={formatCurrency(dashboardStats.todaySales, merchantProfile.currencyCode)}
            icon="cash-outline"
            accent={colors.text}
          />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>New Order</Text>
            <OrangeButton
              label="Refresh"
              variant="outline"
              onPress={() => refreshOrders({ debounceMs: 300 })}
            />
          </View>

          {ordersLoading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>Loading live orders...</Text>
            </View>
          ) : featuredOrder ? (
            <OrderCard
              order={featuredOrder}
              featured
              onPress={() =>
                router.push({
                  pathname: "/order/[id]",
                  params: { id: featuredOrder.id },
                })
              }
            >
              {featuredOrder.status === "new" ? (
                <View style={styles.featuredActions}>
                  <OrangeButton
                    label="Accept Order"
                    onPress={() => onAccept(featuredOrder.id)}
                    style={styles.actionButton}
                  />
                  <OrangeButton
                    label="Reject Order"
                    variant="outline"
                    onPress={() => onReject(featuredOrder.id)}
                    style={styles.actionButton}
                  />
                </View>
              ) : null}
            </OrderCard>
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="checkmark-done-circle-outline" size={28} color={colors.success} />
              <Text style={styles.emptyTitle}>No new orders right now</Text>
              <Text style={styles.emptyText}>
                The dashboard will surface the next incoming order here.
              </Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent active orders</Text>
          {activeOrders.length ? (
            activeOrders.slice(0, 5).map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onPress={() =>
                  router.push({
                    pathname: "/order/[id]",
                    params: { id: order.id },
                  })
                }
              />
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No active orders</Text>
              <Text style={styles.emptyText}>Accepted and preparing orders will appear here.</Text>
            </View>
          )}
        </View>

        <View style={styles.quickGrid}>
          <QuickPanel
            title="Orders queue"
            body="Review accepted, preparing, ready and delivered orders."
            icon="receipt-outline"
            onPress={() => router.push("/(tabs)/orders")}
          />
          <QuickPanel
            title="Payments"
            body="Track statements, commission and settlements."
            icon="wallet-outline"
            onPress={() => router.push("/(tabs)/payments")}
          />
        </View>
      </ScrollView>

      <OrderCancellationModal
        visible={cancelModalVisible}
        loading={cancelSubmitting}
        selectedReasonLabel={selectedCancellationReason}
        note={cancellationNote}
        inlineError={cancellationError}
        onSelectReason={(value) => {
          setSelectedCancellationReason(value);
          setCancellationError("");
        }}
        onChangeNote={setCancellationNote}
        onClose={() => {
          if (cancelSubmitting) return;
          resetCancellationModal();
        }}
        onConfirm={confirmCancellation}
      />
    </>
  );
}

function QuickPanel({
  title,
  body,
  icon,
  onPress,
}: {
  title: string;
  body: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <View style={styles.quickPanel}>
      <View style={styles.quickIcon}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <Text style={styles.quickTitle}>{title}</Text>
      <Text style={styles.quickBody}>{body}</Text>
      <OrangeButton label="Open" variant="outline" onPress={onPress} />
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
  brandBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  brandBannerText: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "900",
  },
  switchWrap: {
    alignItems: "center",
    gap: 4,
  },
  switchText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
  },
  demoBanner: {
    alignSelf: "flex-start",
    backgroundColor: colors.warningSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  demoBannerText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
  },
  liveStrip: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  liveDotFast: {
    backgroundColor: colors.success,
  },
  liveDotStandard: {
    backgroundColor: colors.primary,
  },
  liveDotSlow: {
    backgroundColor: colors.danger,
  },
  livePillText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  liveMetaText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
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
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900",
  },
  featuredActions: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
  },
  actionButton: {
    flex: 1,
  },
  loadingCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: "center",
    gap: 10,
  },
  loadingText: {
    color: colors.muted,
    fontWeight: "700",
  },
  emptyState: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: "center",
    gap: 10,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  emptyText: {
    color: colors.muted,
    textAlign: "center",
    lineHeight: 20,
  },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  quickPanel: {
    flex: 1,
    minWidth: "47%",
    backgroundColor: colors.card,
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  quickIcon: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
  },
  quickTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  quickBody: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
});
