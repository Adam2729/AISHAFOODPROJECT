import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from "react-native";

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
  const [actionLoading, setActionLoading] = useState("");

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

  const currentOrder = order;
  const isSelfDelivery =
    currentOrder.deliveryMode === "self_delivery" || currentOrder.deliveryMode === "both";
  const assignedDriverPhone = String(
    (
      currentOrder.raw as
        | {
            dispatch?: {
              assignedDriverPhone?: string;
            };
          }
        | undefined
    )?.dispatch?.assignedDriverPhone || ""
  ).trim();

  const actionButtons = [
    currentOrder.status === "new"
      ? { label: "Accept Order", nextStatus: "accepted", variant: "primary" as const }
      : null,
    currentOrder.status === "new"
      ? { label: "Reject Order", nextStatus: "cancelled", variant: "outline" as const }
      : null,
    currentOrder.status === "accepted"
      ? { label: "Start Preparing", nextStatus: "preparing", variant: "primary" as const }
      : null,
    currentOrder.status === "preparing"
      ? { label: "Mark Ready", nextStatus: "ready", variant: "primary" as const }
      : null,
    currentOrder.status === "ready" && isSelfDelivery
      ? {
          label: "Mark Out For Delivery",
          nextStatus: "out_for_delivery",
          variant: "primary" as const,
        }
      : null,
    currentOrder.status === "out_for_delivery" && isSelfDelivery
      ? { label: "Mark Delivered", nextStatus: "delivered", variant: "primary" as const }
      : null,
    !["delivered", "cancelled"].includes(currentOrder.status)
      ? { label: "Cancel Order", nextStatus: "cancelled", variant: "danger" as const }
      : null,
  ].filter(Boolean) as {
    label: string;
    nextStatus: string;
    variant: "primary" | "outline" | "danger";
  }[];

  async function onUpdateStatus(nextStatus: string, label: string) {
    try {
      setActionLoading(label);
      await updateOrderStatus(currentOrder.id, nextStatus);
      setActionLoading("");
    } catch (error: unknown) {
      setActionLoading("");
      Alert.alert(
        "Order update",
        (error as { message?: string })?.message || "Could not update the order."
      );
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ScreenHeader
        title={currentOrder.orderNumber}
        subtitle={currentOrder.customerName}
        onBackPress={() => router.back()}
      />

      <View style={styles.card}>
        <View style={styles.badgeRow}>
          <StatusBadge
            label={currentOrder.status.replace(/_/g, " ")}
            tone={toneForStatus(currentOrder.status) as never}
          />
          <StatusBadge
            label={currentOrder.paymentStatus}
            tone={toneForStatus(currentOrder.paymentStatus) as never}
          />
        </View>

        <InfoRow label="Customer phone" value={currentOrder.customerPhone || "Not available"} />
        <InfoRow label="Delivery mode" value={currentOrder.deliveryMode} />
        <InfoRow label="Payment method" value={currentOrder.paymentMethod} />
        <InfoRow label="Payment status" value={currentOrder.paymentStatus} />
        <InfoRow label="Delivery address" value={currentOrder.address || "Not available"} />
        <InfoRow label="Delivery note" value={currentOrder.deliveryNote || "No note"} />
        {currentOrder.driverName ? (
          <InfoRow label="Driver" value={currentOrder.driverName} />
        ) : null}
      </View>

      {currentOrder.status === "ready" && !isSelfDelivery ? (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Waiting for Driver Pickup</Text>
          <Text style={styles.infoBody}>
            This order is assigned to platform delivery. The merchant can accept, prepare and mark it ready. Driver handoff happens from here.
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Items</Text>
        {currentOrder.items.map((item) => (
          <View key={item.id} style={styles.itemRow}>
            <Text style={styles.itemName}>
              {item.name} x{item.quantity}
            </Text>
            <Text style={styles.itemPrice}>
              {formatCurrency(item.quantity * item.price, currentOrder.currencyCode)}
            </Text>
          </View>
        ))}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>
            {formatCurrency(currentOrder.total, currentOrder.currencyCode)}
          </Text>
        </View>
      </View>

      <View style={styles.actionsCard}>
        <OrangeButton
          label="Call Customer"
          variant="outline"
          onPress={() => openTel(currentOrder.customerPhone)}
          disabled={!currentOrder.customerPhone}
        />
        {currentOrder.driverName ? (
          <OrangeButton
            label="Call Driver"
            variant="outline"
            onPress={() => openTel(assignedDriverPhone)}
            disabled={!assignedDriverPhone}
          />
        ) : null}
        {actionButtons.map((button) => (
          <OrangeButton
            key={button.label}
            label={button.label}
            onPress={() => onUpdateStatus(button.nextStatus, button.label)}
            variant={button.variant}
            loading={actionLoading === button.label}
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
  if (!String(phone || "").trim()) return;
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
  infoCard: {
    backgroundColor: colors.warningSoft,
    borderRadius: 22,
    padding: 16,
    gap: 8,
  },
  infoTitle: {
    color: colors.primaryDark,
    fontSize: 16,
    fontWeight: "900",
  },
  infoBody: {
    color: colors.text,
    lineHeight: 20,
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
