import { Redirect, useRouter } from "expo-router";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import OrderCard from "@/src/components/OrderCard";
import ScreenHeader from "@/src/components/ScreenHeader";
import { type OrderStatus } from "@/src/data/mockData";
import { useMerchantApp } from "@/src/context/MerchantAppContext";
import { colors } from "@/src/theme/colors";

const orderedStatuses: OrderStatus[] = [
  "new",
  "accepted",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
  "cancelled",
];

export default function OrdersScreen() {
  const router = useRouter();
  const {
    authState,
    orders,
    ordersError,
    ordersLoading,
    ordersRefreshing,
    refreshOrders,
    usingDemoData,
  } = useMerchantApp();

  if (authState !== "approved") {
    return <Redirect href={authState === "pending" ? "/pending" : "/login"} />;
  }

  return (
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
      <ScreenHeader title="Orders" subtitle="Track each order from new to completed." />

      {usingDemoData ? (
        <View style={styles.demoBadge}>
          <Text style={styles.demoText}>Demo data</Text>
        </View>
      ) : null}

      {ordersError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Orders refresh issue</Text>
          <Text style={styles.errorBody}>{ordersError}</Text>
        </View>
      ) : null}

      {ordersLoading ? (
        <View style={styles.loadingCard}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>Loading orders...</Text>
        </View>
      ) : null}

      {orderedStatuses.map((status) => {
        const rows = orders.filter((order) => order.status === status);
        return (
          <View key={status} style={styles.section}>
            <Text style={styles.sectionTitle}>{status.replace(/_/g, " ")}</Text>
            {rows.length ? (
              rows.map((order) => (
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
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No orders in this group.</Text>
              </View>
            )}
          </View>
        );
      })}
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
  demoBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.warningSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  demoText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
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
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    alignItems: "center",
    gap: 8,
  },
  loadingText: {
    color: colors.muted,
    fontWeight: "700",
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
    textTransform: "capitalize",
  },
  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  emptyText: {
    color: colors.muted,
    fontWeight: "700",
  },
});
