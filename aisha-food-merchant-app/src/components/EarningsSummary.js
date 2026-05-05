import { StyleSheet, Text, View } from "react-native";

import StatCard from "@/src/components/StatCard";
import { colors } from "@/src/theme/colors";

export default function EarningsSummary({ summary, formatMoney, usingDemoData = false }) {
  return (
    <View style={styles.container}>
      {usingDemoData ? (
        <View style={styles.demoBadge}>
          <Text style={styles.demoText}>Demo data</Text>
        </View>
      ) : null}

      <View style={styles.grid}>
        <StatCard label="Today sales" value={formatMoney(summary.todaySales)} icon="today-outline" />
        <StatCard label="Weekly sales" value={formatMoney(summary.weeklySales)} icon="calendar-outline" />
        <StatCard label="Delivery fees" value={formatMoney(summary.deliveryFees)} icon="car-outline" accent={colors.primaryDark} />
        <StatCard label="OranjeEats commission" value={formatMoney(summary.commission)} icon="pricetag-outline" accent={colors.danger} />
        <StatCard label="Merchant net amount" value={formatMoney(summary.merchantNet)} icon="cash-outline" accent={colors.success} />
        <StatCard label="Pending settlement" value={formatMoney(summary.pendingSettlement)} icon="time-outline" accent={colors.primary} />
        <StatCard label="Paid settlement" value={formatMoney(summary.paidSettlement)} icon="checkmark-circle-outline" accent={colors.success} />
        <StatCard label="Cash to reconcile" value={formatMoney(summary.cashToReconcile)} icon="wallet-outline" accent={colors.text} />
      </View>

      <View style={styles.statusCard}>
        <Text style={styles.statusTitle}>Settlement status</Text>
        <Text style={styles.statusBody}>{summary.settlementStatus}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
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
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  statusCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 8,
  },
  statusTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  statusBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
});
