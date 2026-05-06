import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { signupDriverApplication } from "../lib/driverApi";

function SelectChip({ active, label, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active ? styles.chipActive : null]}
    >
      <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

export default function DriverSignupScreen() {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [zoneLabel, setZoneLabel] = useState("");
  const [vehicleType, setVehicleType] = useState("motorbike");
  const [availability, setAvailability] = useState("flexible");
  const [payoutMethod, setPayoutMethod] = useState("cash");
  const [payoutAccountName, setPayoutAccountName] = useState("");
  const [payoutAccountNumber, setPayoutAccountNumber] = useState("");
  const [payoutNotes, setPayoutNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(null);

  const canSubmit = useMemo(
    () =>
      Boolean(
        String(fullName || "").trim() &&
          String(phone || "").trim() &&
          String(email || "").trim() &&
          String(password || "").trim().length >= 6 &&
          String(zoneLabel || "").trim() &&
          String(payoutAccountName || "").trim() &&
          String(payoutAccountNumber || "").trim()
      ),
    [email, fullName, password, payoutAccountName, payoutAccountNumber, phone, zoneLabel]
  );

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await signupDriverApplication({
        fullName,
        phone,
        email,
        password,
        zoneLabel,
        vehicleType,
        availability,
        payoutMethod,
        payoutAccountName,
        payoutAccountNumber,
        payoutNotes,
      });
      setSuccess({
        applicationId: String(response?.applicationId || "").trim(),
      });
    } catch (requestError) {
      setError(requestError?.message || "Unable to submit application.");
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setFullName("");
    setPhone("");
    setEmail("");
    setPassword("");
    setZoneLabel("");
    setVehicleType("motorbike");
    setAvailability("flexible");
    setPayoutMethod("cash");
    setPayoutAccountName("");
    setPayoutAccountNumber("");
    setPayoutNotes("");
    setError("");
    setSuccess(null);
    setSubmitting(false);
  }

  if (success) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.successWrap}>
          <View style={styles.successCard}>
            <Text style={styles.successEyebrow}>APPLICATION RECEIVED</Text>
            <Text style={styles.successTitle}>Application submitted.</Text>
            <Text style={styles.successBody}>
              Application submitted. You can sign in after admin approval.
            </Text>
            {success.applicationId ? (
              <View style={styles.referenceCard}>
                <Text style={styles.referenceLabel}>Application ID</Text>
                <Text style={styles.referenceValue}>{success.applicationId}</Text>
              </View>
            ) : null}
            <View style={styles.successActions}>
              <Pressable
                style={styles.primaryButton}
                onPress={() => router.replace("/login")}
              >
                <Text style={styles.primaryButtonText}>Back to sign in</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={resetForm}>
                <Text style={styles.secondaryButtonText}>Submit another application</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>AISHA FOOD DRIVER</Text>
            <Text style={styles.title}>Driver sign up</Text>
            <Text style={styles.subtitle}>
              Apply for a driver account. After admin approval, you can sign in with the same phone/email and password.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Full name</Text>
            <TextInput
              value={fullName}
              onChangeText={setFullName}
              placeholder="Aisha Driver"
              placeholderTextColor="#94A3B8"
              style={styles.input}
            />

            <Text style={styles.label}>Phone</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="+22370000000"
              placeholderTextColor="#94A3B8"
              style={styles.input}
            />

            <Text style={styles.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="driver@example.com"
              placeholderTextColor="#94A3B8"
              style={styles.input}
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              secureTextEntry
              placeholder="Minimum 6 characters"
              placeholderTextColor="#94A3B8"
              style={styles.input}
            />

            <Text style={styles.label}>Zone / area</Text>
            <TextInput
              value={zoneLabel}
              onChangeText={setZoneLabel}
              placeholder="Hamdallaye / ACI 2000"
              placeholderTextColor="#94A3B8"
              style={styles.input}
            />

            <Text style={styles.label}>Vehicle type</Text>
            <View style={styles.chipRow}>
              {[
                ["motorbike", "Motorbike"],
                ["bike", "Bike"],
                ["car", "Car"],
                ["other", "Other"],
              ].map(([value, label]) => (
                <SelectChip
                  key={value}
                  active={vehicleType === value}
                  label={label}
                  onPress={() => setVehicleType(value)}
                />
              ))}
            </View>

            <Text style={styles.label}>Availability</Text>
            <View style={styles.chipRow}>
              {[
                ["flexible", "Flexible"],
                ["full_time", "Full time"],
                ["part_time", "Part time"],
                ["evenings", "Evenings"],
                ["weekends", "Weekends"],
              ].map(([value, label]) => (
                <SelectChip
                  key={value}
                  active={availability === value}
                  label={label}
                  onPress={() => setAvailability(value)}
                />
              ))}
            </View>

            <Text style={styles.label}>Preferred payout method</Text>
            <View style={styles.chipRow}>
              {[
                ["orange_money", "Orange Money"],
                ["moov_money", "Moov Money"],
                ["wave", "Wave"],
                ["bank_transfer", "Bank transfer"],
                ["cash", "Cash"],
              ].map(([value, label]) => (
                <SelectChip
                  key={value}
                  active={payoutMethod === value}
                  label={label}
                  onPress={() => setPayoutMethod(value)}
                />
              ))}
            </View>

            <Text style={styles.label}>Account holder name</Text>
            <TextInput
              value={payoutAccountName}
              onChangeText={setPayoutAccountName}
              placeholder="Driver full name"
              placeholderTextColor="#94A3B8"
              style={styles.input}
            />

            <Text style={styles.label}>Payout phone/account number</Text>
            <TextInput
              value={payoutAccountNumber}
              onChangeText={setPayoutAccountNumber}
              keyboardType="phone-pad"
              placeholder="+22370000000"
              placeholderTextColor="#94A3B8"
              style={styles.input}
            />

            <Text style={styles.label}>Payout notes</Text>
            <TextInput
              value={payoutNotes}
              onChangeText={setPayoutNotes}
              placeholder="Optional payout instructions"
              placeholderTextColor="#94A3B8"
              style={[styles.input, styles.textArea]}
              multiline
              textAlignVertical="top"
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
                <Text style={styles.primaryButtonText}>Submit application</Text>
              )}
            </Pressable>

            <Pressable style={styles.linkButton} onPress={() => router.replace("/login")}>
              <Text style={styles.linkText}>Already applied? Back to sign in</Text>
            </Pressable>
          </View>
        </ScrollView>
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
    padding: 24,
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
    marginTop: 2,
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
  textArea: {
    minHeight: 104,
    paddingTop: 14,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
  },
  chip: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chipActive: {
    borderColor: "#F97316",
    backgroundColor: "#FFF7ED",
  },
  chipText: {
    color: "#475569",
    fontSize: 13,
    fontWeight: "700",
  },
  chipTextActive: {
    color: "#C2410C",
  },
  errorText: {
    color: "#B91C1C",
    marginTop: 4,
  },
  primaryButton: {
    marginTop: 10,
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
  linkButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  linkText: {
    color: "#F97316",
    fontWeight: "800",
    fontSize: 14,
  },
  successWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  successCard: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D1FAE5",
    borderRadius: 24,
    padding: 22,
    gap: 10,
  },
  successEyebrow: {
    color: "#059669",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  successTitle: {
    color: "#064E3B",
    fontSize: 28,
    fontWeight: "900",
  },
  successBody: {
    color: "#065F46",
    fontSize: 15,
    lineHeight: 22,
  },
  referenceCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#D1FAE5",
    backgroundColor: "#F0FDF4",
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  referenceLabel: {
    color: "#047857",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
  },
  referenceValue: {
    color: "#064E3B",
    fontSize: 15,
    fontWeight: "700",
  },
  successActions: {
    gap: 10,
    marginTop: 8,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: "#334155",
    fontWeight: "800",
    fontSize: 14,
  },
});
