import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  formatCurrency,
  formatDateTime,
  formatOrderStatus,
  getAssignedAt,
  getCustomerName,
  getDropoffAddress,
  getOrderCurrency,
  getOrderReference,
  getOrderTotal,
  getPickupAddress,
} from "../lib/orderUtils";

export default function DriverOrderCard({ order, onPress, ctaLabel = "Driver flow only" }) {
  const actionLabel =
    String(order?.assignmentType || "") === "offered" ? "Offer only" : ctaLabel;

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.cardHeader}>
        <Text style={styles.reference}>{getOrderReference(order)}</Text>
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>{formatOrderStatus(order)}</Text>
        </View>
      </View>

      <Text style={styles.customer}>{getCustomerName(order)}</Text>
      <Text style={styles.metaLabel}>Pickup</Text>
      <Text style={styles.metaText}>{getPickupAddress(order)}</Text>
      <Text style={styles.metaLabel}>Drop-off</Text>
      <Text style={styles.metaText}>{getDropoffAddress(order)}</Text>

      <View style={styles.summaryRow}>
        <Text style={styles.summaryText}>{formatDateTime(getAssignedAt(order))}</Text>
        <Text style={styles.summaryAmount}>
          {formatCurrency(getOrderTotal(order), getOrderCurrency(order))}
        </Text>
      </View>

      <Text style={styles.cta}>{actionLabel}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  reference: {
    flex: 1,
    fontSize: 16,
    fontWeight: "800",
    color: "#0F172A",
  },
  statusBadge: {
    backgroundColor: "#FFF7ED",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusText: {
    color: "#C2410C",
    fontWeight: "700",
    fontSize: 12,
  },
  customer: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "800",
  },
  metaLabel: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "700",
  },
  metaText: {
    color: "#334155",
    fontSize: 14,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    gap: 12,
  },
  summaryText: {
    flex: 1,
    color: "#64748B",
    fontSize: 12,
  },
  summaryAmount: {
    color: "#0F172A",
    fontWeight: "800",
  },
  cta: {
    marginTop: 6,
    color: "#F97316",
    fontWeight: "800",
  },
});
