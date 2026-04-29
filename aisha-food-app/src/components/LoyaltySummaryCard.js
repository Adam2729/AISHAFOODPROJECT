import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import formatPrice from "../lib/formatPrice";
import { getMarketConfig } from "../lib/marketConfig";

export default function LoyaltySummaryCard({
  loyalty,
  loading = false,
  error = "",
  onRetry,
  title = "Loyalty",
  city,
}) {
  const market = getMarketConfig(city);
  const isSpanish = market.defaultLanguage === "es";

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>

      {loading ? (
        <Text style={styles.helper}>
          {isSpanish ? "Cargando beneficios..." : "Chargement des avantages..."}
        </Text>
      ) : null}
      {!loading && error ? <Text style={styles.error}>{error}</Text> : null}

      {!loading && !error && loyalty ? (
        <View style={styles.metrics}>
          <Metric label={isSpanish ? "Puntos" : "Points"} value={String(Number(loyalty.points || 0))} />
          <Metric
            label={isSpanish ? "Billetera" : "Portefeuille"}
            value={formatPrice(loyalty.walletBalance || 0, market)}
          />
          <Metric
            label={isSpanish ? "Codigo de referido" : "Code de parrainage"}
            value={String(loyalty.referralCode || "-")}
          />
        </View>
      ) : null}

      {!loading && !error && !loyalty ? (
        <Text style={styles.helper}>
          {isSpanish
            ? "Agrega tu numero para cargar puntos y saldo de billetera."
            : "Ajoute ton numero pour charger les points et le solde du portefeuille."}
        </Text>
      ) : null}

      {error && onRetry ? (
        <Pressable onPress={onRetry} style={styles.retryButton}>
          <Text style={styles.retryText}>{isSpanish ? "Reintentar" : "Reessayer"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Metric({ label, value }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: "900",
    color: "#0F172A",
  },
  helper: {
    color: "#64748B",
    fontSize: 13,
  },
  error: {
    color: "#B91C1C",
    fontSize: 13,
  },
  metrics: {
    gap: 8,
  },
  metric: {
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    padding: 10,
    gap: 2,
  },
  metricLabel: {
    color: "#64748B",
    fontSize: 12,
  },
  metricValue: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "800",
  },
  retryButton: {
    alignSelf: "flex-start",
    backgroundColor: "#0F172A",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  retryText: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
});
