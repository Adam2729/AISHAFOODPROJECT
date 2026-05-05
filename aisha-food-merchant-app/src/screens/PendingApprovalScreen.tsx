import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";

import Logo from "@/src/components/Logo";
import OrangeButton from "@/src/components/OrangeButton";
import { useMerchantApp } from "@/src/context/MerchantAppContext";
import { colors } from "@/src/theme/colors";

export default function PendingApprovalScreen() {
  const router = useRouter();
  const { authState, pendingApplication, supportWhatsApp } = useMerchantApp();

  if (authState === "approved") {
    return <Redirect href="/(tabs)" />;
  }

  if (authState === "loggedOut" && !pendingApplication) {
    return <Redirect href="/login" />;
  }

  function openSupport() {
    Linking.openURL(
      `https://wa.me/${supportWhatsApp}?text=${encodeURIComponent(
        "Hello, my OranjeEats merchant application is pending. Please assist."
      )}`
    ).catch(() => null);
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Logo width={170} height={170} />
      <Text style={styles.title}>Your restaurant application is under review.</Text>
      <Text style={styles.subtitle}>
        Application submitted. We will contact you on WhatsApp or email after review.
      </Text>
      {pendingApplication ? (
        <View style={styles.card}>
          <Text style={styles.label}>Application ID</Text>
          <Text style={styles.value}>{pendingApplication.id}</Text>
          <Text style={styles.label}>Restaurant</Text>
          <Text style={styles.value}>{pendingApplication.restaurantName}</Text>
        </View>
      ) : null}
      <OrangeButton label="Contact support on WhatsApp" onPress={openSupport} />
      <OrangeButton label="Back to home" variant="outline" onPress={() => router.push("/")} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    gap: 16,
  },
  title: {
    textAlign: "center",
    fontSize: 28,
    fontWeight: "900",
    color: colors.text,
  },
  subtitle: {
    textAlign: "center",
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 320,
  },
  card: {
    width: "100%",
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 6,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  value: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
});
