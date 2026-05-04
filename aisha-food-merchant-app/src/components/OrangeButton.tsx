import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from "react-native";

import { colors } from "@/src/theme/colors";

type OrangeButtonProps = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "outline" | "danger" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
};

export default function OrangeButton({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  style,
}: OrangeButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      disabled={isDisabled}
      onPress={onPress}
      style={[
        styles.button,
        styles[variant],
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" || variant === "danger" ? "#FFFFFF" : colors.text} />
      ) : (
        <Text
          style={[
            styles.label,
            (variant === "primary" || variant === "danger") && styles.labelOnDark,
            variant === "ghost" && styles.labelGhost,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: 18,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.surfaceAlt,
  },
  outline: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  danger: {
    backgroundColor: colors.danger,
  },
  ghost: {
    backgroundColor: "transparent",
  },
  disabled: {
    opacity: 0.55,
  },
  label: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  labelOnDark: {
    color: "#FFFFFF",
  },
  labelGhost: {
    color: colors.muted,
  },
});
