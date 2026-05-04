import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import OrangeButton from "@/src/components/OrangeButton";
import OrderCard from "@/src/components/OrderCard";
import ScreenHeader from "@/src/components/ScreenHeader";
import StatCard from "@/src/components/StatCard";
import { useMerchantApp } from "@/src/context/MerchantAppContext";
import { formatCurrency } from "@/src/lib/formatters";
import { colors } from "@/src/theme/colors";

export default function HomeDashboardScreen() {
  const router = useRouter();
  const { authState, merchantProfile, orders, storeOpen, toggleStoreOpen, updateOrderStatus } =
    useMerchantApp();

  if (authState !== "approved") {
    return <Redirect href={authState === "pending" ? "/pending" : "/login"} />;
  }

  const newOrders = orders.filter((order) => order.status === "new");
  const preparingOrders = orders.filter((order) => order.status === "preparing");
  const readyOrders = orders.filter((order) => order.status === "ready");
  const todaySales = orders
    .filter((order) => order.status !== "cancelled")
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const featuredOrder = newOrders[0];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ScreenHeader
        title={merchantProfile.restaurantName}
        subtitle="Manage live orders, menu and payouts"
        rightNode={
          <View style={styles.switchWrap}>
            <Text style={styles.switchText}>{storeOpen ? "Open" : "Closed"}</Text>
            <Switch
              value={storeOpen}
              onValueChange={toggleStoreOpen}
              trackColor={{ false: "#E7E5E4", true: "#FFB47D" }}
              thumbColor={storeOpen ? colors.primary : "#FFFFFF"}
            />
          </View>
        }
      />

      <View style={styles.statsGrid}>
        <StatCard label="New orders" value={String(newOrders.length)} icon="notifications-outline" />
        <StatCard label="Preparing" value={String(preparingOrders.length)} icon="flame-outline" accent={colors.primaryDark} />
        <StatCard label="Ready" value={String(readyOrders.length)} icon="checkmark-circle-outline" accent={colors.success} />
        <StatCard label="Today sales" value={formatCurrency(todaySales)} icon="cash-outline" accent={colors.text} />
      </View>

      {featuredOrder ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>New Order</Text>
          <OrderCard order={featuredOrder} featured onPress={() => router.push(`/order/${featuredOrder.id}`)}>
            <View style={styles.featuredActions}>
              <OrangeButton
                label="Accept Order"
                onPress={() => updateOrderStatus(featuredOrder.id, "accepted")}
                style={styles.actionButton}
              />
              <OrangeButton
                label="Reject Order"
                variant="outline"
                onPress={() => updateOrderStatus(featuredOrder.id, "cancelled")}
                style={styles.actionButton}
              />
            </View>
          </OrderCard>
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Ionicons name="checkmark-done-circle-outline" size={28} color={colors.success} />
          <Text style={styles.emptyTitle}>No new orders right now</Text>
          <Text style={styles.emptyText}>The dashboard will surface the next incoming order here.</Text>
        </View>
      )}

      <View style={styles.quickGrid}>
        <QuickPanel
          title="Orders queue"
          body="Review accepted, preparing, ready and delivered orders."
          icon="receipt-outline"
          onPress={() => router.push("/(tabs)/orders")}
        />
        <QuickPanel
          title="Menu updates"
          body="Adjust availability and keep the storefront current."
          icon="restaurant-outline"
          onPress={() => router.push("/(tabs)/menu")}
        />
      </View>
    </ScrollView>
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
    <Pressable style={styles.quickPanel} onPress={onPress}>
      <View style={styles.quickIcon}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <Text style={styles.quickTitle}>{title}</Text>
      <Text style={styles.quickBody}>{body}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingBottom: 36,
    backgroundColor: colors.background,
    gap: 18,
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
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  section: {
    gap: 10,
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
