import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import StatusBadge from "@/src/components/StatusBadge";
import type { MerchantOrder } from "@/src/data/mockData";
import { formatCurrency, formatRelativeDate } from "@/src/lib/formatters";
import { colors } from "@/src/theme/colors";

function orderTone(status: MerchantOrder["status"]) {
  switch (status) {
    case "new":
      return "orange";
    case "accepted":
    case "preparing":
    case "ready":
    case "out_for_delivery":
      return "warning";
    case "delivered":
      return "success";
    case "cancelled":
      return "danger";
    default:
      return "neutral";
  }
}

function paymentTone(status: MerchantOrder["paymentStatus"]) {
  switch (status) {
    case "paid":
      return "success";
    case "failed":
      return "danger";
    default:
      return "warning";
  }
}

type OrderCardProps = {
  order: MerchantOrder;
  onPress?: () => void;
  featured?: boolean;
  children?: React.ReactNode;
};

export default function OrderCard({ order, onPress, featured = false, children }: OrderCardProps) {
  const content = (
    <View style={[styles.card, featured && styles.cardFeatured]}>
      <View style={styles.headerRow}>
        <View style={styles.headerMain}>
          <Text style={styles.orderNumber}>{order.orderNumber}</Text>
          <Text style={styles.customerName}>{order.customerName}</Text>
        </View>
        <View style={styles.badgeColumn}>
          <StatusBadge label={order.status.replace(/_/g, " ")} tone={orderTone(order.status)} />
          <StatusBadge label={order.paymentStatus} tone={paymentTone(order.paymentStatus)} />
        </View>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaPill}>
          <Ionicons name="time-outline" size={14} color={colors.primaryDark} />
          <Text style={styles.metaText}>{formatRelativeDate(order.createdAt)}</Text>
        </View>
        <View style={styles.metaPill}>
          <Ionicons name="navigate-outline" size={14} color={colors.primaryDark} />
          <Text style={styles.metaText}>{order.deliveryMode}</Text>
        </View>
        <View style={styles.metaPill}>
          <Ionicons name="wallet-outline" size={14} color={colors.primaryDark} />
          <Text style={styles.metaText}>{order.paymentMethod}</Text>
        </View>
      </View>

      <View style={styles.itemsWrap}>
        {order.items.map((item) => (
          <View key={item.id} style={styles.itemRow}>
            <Text style={styles.itemText}>
              {item.name} x{item.quantity}
            </Text>
            <Text style={styles.itemPrice}>{formatCurrency(item.quantity * item.price)}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.addressText}>{order.address}</Text>
      {order.deliveryNote ? <Text style={styles.noteText}>{order.deliveryNote}</Text> : null}

      <View style={styles.footerRow}>
        <Text style={styles.totalText}>{formatCurrency(order.total)}</Text>
        {children}
      </View>
    </View>
  );

  if (!onPress) return content;

  return <Pressable onPress={onPress}>{content}</Pressable>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 14,
    shadowColor: "#111111",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    elevation: 3,
  },
  cardFeatured: {
    backgroundColor: "#FFF6EF",
    borderColor: "#FFD0B1",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  headerMain: {
    flex: 1,
    gap: 4,
  },
  badgeColumn: {
    alignItems: "flex-end",
    gap: 8,
  },
  orderNumber: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  customerName: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "900",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
  },
  metaText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "700",
  },
  itemsWrap: {
    gap: 8,
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  itemText: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  itemPrice: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  addressText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  noteText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  totalText: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900",
  },
});
