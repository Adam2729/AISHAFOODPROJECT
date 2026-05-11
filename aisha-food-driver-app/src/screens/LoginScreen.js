import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAuth } from "../lib/auth";
import { API_BASE_URL } from "../lib/config";

export default function LoginScreen({ navigation }) {
  const { signIn } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = useMemo(
    () => Boolean(String(identifier || "").trim() && String(password || "").trim()),
    [identifier, password]
  );

  async function handleSubmit() {
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setError("");

    try {
      const session = await signIn({
        identifier,
        password,
      });
      console.log("[LoginScreen] driver login success", session);
      if (navigation?.replace) {
        navigation.replace("Home");
      } else {
        router.replace("/home");
      }
    } catch (requestError) {
      setError(requestError?.message || "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.content}>
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>AISHA FOOD DRIVER</Text>
            <Text style={styles.title}>Driver login</Text>
            <Text style={styles.subtitle}>
              Sign in with your approved driver account.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Phone or email</Text>
            <TextInput
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="driver@test.oranjeeats.com"
              placeholderTextColor="#94A3B8"
              style={styles.input}
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              secureTextEntry
              placeholder="Enter your password"
              placeholderTextColor="#94A3B8"
              style={styles.input}
            />

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Pressable
              style={[styles.primaryButton, (!canSubmit || submitting) && styles.primaryButtonDisabled]}
              disabled={!canSubmit || submitting}
              onPress={handleSubmit}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>Sign in</Text>
              )}
            </Pressable>

            <Pressable
              style={styles.signupLinkButton}
              onPress={() => router.push("/signup")}
            >
              <Text style={styles.signupLinkText}>Don&apos;t have an account? Sign up</Text>
            </Pressable>
          </View>

          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>API configuration</Text>
            <Text style={styles.noteText}>
              {API_BASE_URL
                ? `Connected base URL: ${API_BASE_URL}`
                : "Missing EXPO_PUBLIC_API_URL. Add it to your Expo env before using the live backend."}
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  keyboard: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    gap: 20,
  },
  hero: {
    gap: 8,
  },
  eyebrow: {
    color: "#F97316",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  title: {
    color: "#0F172A",
    fontSize: 32,
    fontWeight: "900",
  },
  subtitle: {
    color: "#475569",
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 20,
    padding: 18,
    gap: 10,
  },
  label: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "700",
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#0F172A",
    backgroundColor: "#FFFFFF",
    fontSize: 15,
  },
  errorText: {
    color: "#B91C1C",
    marginTop: 4,
  },
  primaryButton: {
    marginTop: 8,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: "#F97316",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
  },
  signupLinkButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
  signupLinkText: {
    color: "#F97316",
    fontWeight: "800",
    fontSize: 14,
  },
  noteCard: {
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA",
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  noteTitle: {
    color: "#9A3412",
    fontWeight: "800",
  },
  noteText: {
    color: "#9A3412",
    lineHeight: 20,
  },
});
