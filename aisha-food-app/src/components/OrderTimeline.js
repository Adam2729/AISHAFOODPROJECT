import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { buildOrderTimeline } from "../lib/formatters";

export default function OrderTimeline({ status, city, rows: providedRows }) {
  const rows = Array.isArray(providedRows) && providedRows.length
    ? providedRows
    : buildOrderTimeline(status, city);

  return (
    <View style={styles.wrap}>
      {rows.map((step, index) => (
        <View key={step.key} style={styles.row}>
          <View style={styles.markerCol}>
            <View
              style={[
                styles.marker,
                step.done && styles.markerDone,
                step.active && styles.markerActive,
              ]}
            />
            {index < rows.length - 1 ? <View style={styles.line} /> : null}
          </View>
          <View style={styles.textCol}>
            <Text style={[styles.label, step.active && styles.labelActive]}>{step.label}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 0,
  },
  row: {
    flexDirection: "row",
    gap: 12,
    minHeight: 42,
  },
  markerCol: {
    width: 18,
    alignItems: "center",
  },
  marker: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
    marginTop: 2,
  },
  markerDone: {
    borderColor: "#0F766E",
    backgroundColor: "#0F766E",
  },
  markerActive: {
    borderColor: "#F97316",
    backgroundColor: "#FFF7ED",
  },
  line: {
    flex: 1,
    width: 2,
    backgroundColor: "#E2E8F0",
    marginTop: 4,
  },
  textCol: {
    flex: 1,
    paddingBottom: 12,
  },
  label: {
    color: "#475569",
    fontSize: 14,
    fontWeight: "700",
  },
  labelActive: {
    color: "#0F172A",
  },
});
