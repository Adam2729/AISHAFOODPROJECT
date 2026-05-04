import { Redirect, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

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
  const { authState, orders } = useMerchantApp();

  if (authState !== "approved") {
    return <Redirect href={authState === "pending" ? "/pending" : "/login"} />;
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ScreenHeader title="Orders" subtitle="Track each order from new to completed." />
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
