import { StyleSheet, Text, View } from "react-native";

import Logo from "@/src/components/Logo";
import { colors } from "@/src/theme/colors";

export default function SplashScreen() {
  return (
    <View style={styles.container}>
      <Logo width={170} height={170} />
      <Text style={styles.title}>OranjeEats Merchant</Text>
      <Text style={styles.subtitle}>Manage orders, menu and payments</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 14,
  },
  title: {
    fontSize: 32,
    fontWeight: "900",
    color: colors.text,
  },
  subtitle: {
    fontSize: 15,
    color: colors.muted,
    textAlign: "center",
  },
});
