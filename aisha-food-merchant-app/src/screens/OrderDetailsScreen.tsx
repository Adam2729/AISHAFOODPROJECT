import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";

import OrangeButton from "@/src/components/OrangeButton";
import ScreenHeader from "@/src/components/ScreenHeader";
import StatusBadge from "@/src/components/StatusBadge";
import { useMerchantApp } from "@/src/context/MerchantAppContext";
import { formatCurrency } from "@/src/lib/formatters";
import { colors } from "@/src/theme/colors";

function toneForStatus(status: string) {
  if (status === "delivered") return "success";
  if (status === "cancelled" || status === "failed") return "danger";
  if (status === "paid") return "success";
  if (status === "pending" || status === "new") return "warning";
  return "orange";
}

export default function OrderDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const { authState, getOrderById, updateOrderStatus } = useMerchantApp();
  const order = getOrderById(String(params.id || ""));

  if (authState !== "approved") {
    return <Redirect href={authState === "pending" ? "/pending" : "/login"} />;
  }

  if (!order) {
    return (
      <View style={styles.emptyScreen}>
        <Text style={styles.emptyTitle}>Order not found</Text>
        <OrangeButton label="Back to orders" onPress={() => router.replace("/(tabs)/orders")} />
      </View>
    );
  }

  const actionButtons = [
    order.status === "new"
      ? { label: "Accept Order", action: () => updateOrderStatus(order.id, "accepted"), variant: "primary" as const }
      : null,
    order.status === "new"
      ? { label: "Reject Order", action: () => updateOrderStatus(order.id, "cancelled"), variant: "outline" as const }
      : null,
    order.status === "accepted"
      ? { label: "Start Preparing", action: () => updateOrderStatus(order.id, "preparing"), variant: "primary" as const }
      : null,
    order.status === "preparing"
      ? { label: "Mark Ready", action: () => updateOrderStatus(order.id, "ready"), variant: "primary" as const }
      : null,
    order.status === "ready"
      ? { label: "Call Driver", action: () => openTel(order.customerPhone), variant: "outline" as const }
      : null,
    order.status === "ready"
      ? { label: "Mark Out for delivery", action: () => updateOrderStatus(order.id, "out_for_delivery"), variant: "primary" as const }
      : null,
    order.status === "out_for_delivery"
      ? { label: "Call Customer", action: () => openTel(order.customerPhone), variant: "outline" as const }
      : null,
    order.status === "out_for_delivery"
      ? { label: "Complete Delivery", action: () => updateOrderStatus(order.id, "delivered"), variant: "primary" as const }
      : null,
    !["delivered", "cancelled"].includes(order.status)
      ? { label: "Cancel Order", action: () => updateOrderStatus(order.id, "cancelled"), variant: "danger" as const }
      : null,
  ].filter(Boolean) as {
    label: string;
    action: () => void;
    variant: "primary" | "outline" | "danger";
  }[];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ScreenHeader
        title={order.orderNumber}
        subtitle={order.customerName}
        onBackPress={() => router.back()}
      />

      <View style={styles.card}>
        <View style={styles.badgeRow}>
          <StatusBadge label={order.status.replace(/_/g, " ")} tone={toneForStatus(order.status) as never} />
          <StatusBadge label={order.paymentStatus} tone={toneForStatus(order.paymentStatus) as never} />
        </View>

        <InfoRow label="Customer phone" value={order.customerPhone} />
        <InfoRow label="Delivery mode" value={order.deliveryMode} />
        <InfoRow label="Payment method" value={order.paymentMethod} />
        <InfoRow label="Delivery address" value={order.address} />
        <InfoRow label="Delivery note" value={order.deliveryNote || "No note"} />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Items</Text>
        {order.items.map((item) => (
          <View key={item.id} style={styles.itemRow}>
            <Text style={styles.itemName}>
              {item.name} x{item.quantity}
            </Text>
            <Text style={styles.itemPrice}>{formatCurrency(item.quantity * item.price)}</Text>
          </View>
        ))}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{formatCurrency(order.total)}</Text>
        </View>
      </View>

      <View style={styles.actionsCard}>
        {actionButtons.map((button) => (
          <OrangeButton
            key={button.label}
            label={button.label}
            onPress={button.action}
            variant={button.variant}
          />
        ))}
      </View>
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function openTel(phone: string) {
  Linking.openURL(`tel:${String(phone || "").trim()}`).catch(() => null);
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingBottom: 36,
    backgroundColor: colors.background,
    gap: 16,
  },
  emptyScreen: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 14,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  badgeRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  infoRow: {
    gap: 4,
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  infoValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  itemName: {
    flex: 1,
    color: colors.text,
    fontWeight: "700",
  },
  itemPrice: {
    color: colors.text,
    fontWeight: "800",
  },
  totalRow: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  totalLabel: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  totalValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  actionsCard: {
    gap: 10,
  },
});
