import { Redirect } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import ScreenHeader from "@/src/components/ScreenHeader";
import StatCard from "@/src/components/StatCard";
import { useMerchantApp } from "@/src/context/MerchantAppContext";
import { formatCurrency } from "@/src/lib/formatters";
import { colors } from "@/src/theme/colors";

export default function PaymentsScreen() {
  const { authState, paymentsSnapshot } = useMerchantApp();

  if (authState !== "approved") {
    return <Redirect href={authState === "pending" ? "/pending" : "/login"} />;
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ScreenHeader title="Payments" subtitle="Track sales, commission and settlement status." />

      <View style={styles.statsGrid}>
        <StatCard label="Today sales" value={formatCurrency(paymentsSnapshot.todaySales)} icon="today-outline" />
        <StatCard label="Weekly sales" value={formatCurrency(paymentsSnapshot.weeklySales)} icon="calendar-outline" />
        <StatCard label="Delivery fees" value={formatCurrency(paymentsSnapshot.deliveryFees)} icon="car-outline" accent={colors.primaryDark} />
        <StatCard label="OranjeEats commission" value={formatCurrency(paymentsSnapshot.commission)} icon="pricetag-outline" accent={colors.danger} />
        <StatCard label="Merchant net amount" value={formatCurrency(paymentsSnapshot.merchantNet)} icon="cash-outline" accent={colors.success} />
      </View>

      <View style={styles.statusCard}>
        <Text style={styles.statusTitle}>Settlement status</Text>
        <Text style={styles.statusBody}>{paymentsSnapshot.settlementStatus}</Text>
      </View>
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
  statsGrid: {
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
