import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "@/src/theme/colors";

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  onBackPress?: () => void;
  rightActionLabel?: string;
  onRightActionPress?: () => void;
  rightNode?: React.ReactNode;
};

export default function ScreenHeader({
  title,
  subtitle,
  onBackPress,
  rightActionLabel,
  onRightActionPress,
  rightNode,
}: ScreenHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.titleWrap}>
          {onBackPress ? (
            <Pressable style={styles.backButton} onPress={onBackPress}>
              <Ionicons name="arrow-back" size={20} color={colors.text} />
            </Pressable>
          ) : null}
          <View style={styles.titleTextWrap}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
        </View>
        {rightNode ? rightNode : null}
        {rightActionLabel && onRightActionPress ? (
          <Pressable style={styles.actionButton} onPress={onRightActionPress}>
            <Text style={styles.actionText}>{rightActionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  titleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  titleTextWrap: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    color: colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
  },
  actionButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  actionText: {
    color: colors.text,
    fontWeight: "800",
    fontSize: 13,
  },
});
