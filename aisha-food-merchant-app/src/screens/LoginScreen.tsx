import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect, useRouter } from "expo-router";

import Logo from "@/src/components/Logo";
import OrangeButton from "@/src/components/OrangeButton";
import { useMerchantApp } from "@/src/context/MerchantAppContext";
import { colors } from "@/src/theme/colors";

export default function LoginScreen() {
  const router = useRouter();
  const { authState, apiUrl, login } = useMerchantApp();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setError("");
  }, [identifier, password]);

  if (authState === "approved") {
    return <Redirect href="/(tabs)" />;
  }

  if (authState === "pending") {
    return <Redirect href="/pending" />;
  }

  async function onLogin() {
    setLoading(true);
    const result = await login(identifier, password);
    setLoading(false);
    if (!result.ok) {
      const message = result.message || "Login failed.";
      setError(message);
      Alert.alert("Login failed", message);
      return;
    }
    router.replace(result.pending ? "/pending" : "/(tabs)");
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.logoWrap}>
        <Logo width={150} height={150} />
      </View>
      <Text style={styles.title}>OranjeEats Merchant</Text>
      <Text style={styles.subtitle}>Sign in with your approved merchant account.</Text>

      <View style={styles.formCard}>
        <Text style={styles.inputLabel}>Email or phone</Text>
        <TextInput
          value={identifier}
          onChangeText={setIdentifier}
          placeholder="owner@oranjeeats.com"
          placeholderTextColor="#A8A29E"
          style={styles.input}
          autoCapitalize="none"
        />

        <Text style={styles.inputLabel}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Enter password"
          placeholderTextColor="#A8A29E"
          style={styles.input}
          secureTextEntry
        />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <OrangeButton label="Login" onPress={onLogin} loading={loading} />

        <Pressable style={styles.linkButton} onPress={() => router.push("/signup")}>
          <Text style={styles.linkText}>Create restaurant account</Text>
        </Pressable>
        <Pressable style={styles.linkButton}>
          <Text style={styles.linkTextMuted}>Forgot password</Text>
        </Pressable>
      </View>

      <View style={styles.demoCard}>
        <Text style={styles.demoTitle}>Server</Text>
        <Text style={styles.demoText}>{apiUrl || "EXPO_PUBLIC_API_URL is not configured."}</Text>
        <Text style={styles.demoHint}>
          Use your approved merchant email or phone and password. Mobile testing must use your local IP, not localhost.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    backgroundColor: colors.background,
    padding: 24,
    justifyContent: "center",
    gap: 18,
  },
  logoWrap: {
    alignItems: "center",
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
    fontSize: 14,
    marginTop: -6,
  },
  formCard: {
    backgroundColor: colors.card,
    borderRadius: 26,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  inputLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: "#FAFAF9",
    color: colors.text,
    fontSize: 15,
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700",
  },
  linkButton: {
    alignItems: "center",
    paddingVertical: 6,
  },
  linkText: {
    color: colors.primaryDark,
    fontWeight: "800",
  },
  linkTextMuted: {
    color: colors.muted,
    fontWeight: "700",
  },
  demoCard: {
    backgroundColor: "#FFF6EF",
    borderWidth: 1,
    borderColor: "#FFD3B3",
    borderRadius: 22,
    padding: 16,
    gap: 6,
  },
  demoTitle: {
    color: colors.primaryDark,
    fontWeight: "900",
  },
  demoText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  demoHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
});
