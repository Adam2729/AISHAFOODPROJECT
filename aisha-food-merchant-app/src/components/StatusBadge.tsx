import { StyleSheet, Text, View } from "react-native";

import { colors } from "@/src/theme/colors";

type StatusBadgeProps = {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "orange";
};

export default function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  return (
    <View style={[styles.badge, styles[`${tone}Badge`]]}>
      <Text style={[styles.text, styles[`${tone}Text`]]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: "flex-start",
  },
  text: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  neutralBadge: {
    backgroundColor: "#F3F4F6",
  },
  neutralText: {
    color: "#4B5563",
  },
  successBadge: {
    backgroundColor: colors.successSoft,
  },
  successText: {
    color: colors.success,
  },
  warningBadge: {
    backgroundColor: colors.warningSoft,
  },
  warningText: {
    color: colors.primaryDark,
  },
  dangerBadge: {
    backgroundColor: colors.dangerSoft,
  },
  dangerText: {
    color: colors.danger,
  },
  orangeBadge: {
    backgroundColor: colors.surfaceAlt,
  },
  orangeText: {
    color: colors.primaryDark,
  },
});
