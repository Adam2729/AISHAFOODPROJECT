import React, { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect, useRouter } from "expo-router";

import BrandLogo from "@/src/components/BrandLogo";
import OrangeButton from "@/src/components/OrangeButton";
import ScreenHeader from "@/src/components/ScreenHeader";
import { type DeliveryModel } from "@/src/data/mockData";
import { useMerchantApp } from "@/src/context/MerchantAppContext";
import { colors } from "@/src/theme/colors";

const deliveryOptions: DeliveryModel[] = ["platform_driver", "self_delivery", "both"];

export default function MerchantSignupScreen() {
  const router = useRouter();
  const { authState, submitApplication } = useMerchantApp();
  const [form, setForm] = useState({
    restaurantName: "",
    ownerName: "",
    phone: "",
    whatsapp: "",
    email: "",
    address: "",
    city: "Bamako",
    cuisineType: "",
    openingHours: "",
    deliveryModel: "both" as DeliveryModel,
    password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const canSubmit = useMemo(
    () =>
      Object.entries(form).every(([key, value]) =>
        key === "whatsapp" ? true : String(value || "").trim().length > 0
      ),
    [form]
  );

  if (authState === "pending") {
    return <Redirect href="/pending" />;
  }

  if (authState === "approved") {
    return <Redirect href="/(tabs)" />;
  }

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  }

  async function onSubmit() {
    if (!canSubmit) {
      setError("Complete all required fields before submitting.");
      return;
    }
    setLoading(true);
    try {
      await submitApplication(form);
      setLoading(false);
      Alert.alert(
        "Application submitted",
        "Application submitted. You can sign in after admin approval."
      );
      router.replace("/pending");
    } catch (submitError: unknown) {
      const message =
        (submitError as { message?: string })?.message || "Could not submit the application.";
      setLoading(false);
      setError(message);
      Alert.alert("Submission failed", message);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ScreenHeader title="Create restaurant account" onBackPress={() => router.back()} />
      <View style={styles.logoWrap}>
        <BrandLogo size={72} />
      </View>
      <View style={styles.formCard}>
        <InputField label="Restaurant name" value={form.restaurantName} onChangeText={(value) => updateField("restaurantName", value)} />
        <InputField label="Owner name" value={form.ownerName} onChangeText={(value) => updateField("ownerName", value)} />
        <InputField label="Phone number" value={form.phone} onChangeText={(value) => updateField("phone", value)} keyboardType="phone-pad" />
        <InputField label="WhatsApp number" value={form.whatsapp} onChangeText={(value) => updateField("whatsapp", value)} keyboardType="phone-pad" />
        <InputField label="Email" value={form.email} onChangeText={(value) => updateField("email", value)} keyboardType="email-address" autoCapitalize="none" />
        <InputField label="Password" value={form.password} onChangeText={(value) => updateField("password", value)} secureTextEntry />
        <InputField label="Restaurant address" value={form.address} onChangeText={(value) => updateField("address", value)} />
        <InputField label="City" value={form.city} onChangeText={(value) => updateField("city", value)} />
        <InputField label="Cuisine type" value={form.cuisineType} onChangeText={(value) => updateField("cuisineType", value)} />
        <InputField label="Opening hours" value={form.openingHours} onChangeText={(value) => updateField("openingHours", value)} placeholder="10:00 - 23:00" />

        <Text style={styles.inputLabel}>Delivery model</Text>
        <View style={styles.optionRow}>
          {deliveryOptions.map((option) => {
            const active = form.deliveryModel === option;
            return (
              <Pressable
                key={option}
                onPress={() => updateField("deliveryModel", option)}
                style={[styles.optionPill, active && styles.optionPillActive]}
              >
                <Text style={[styles.optionText, active && styles.optionTextActive]}>{option}</Text>
              </Pressable>
            );
          })}
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <OrangeButton label="Submit application" onPress={onSubmit} loading={loading} />
      </View>
    </ScrollView>
  );
}

function InputField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  secureTextEntry,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  secureTextEntry?: boolean;
}) {
  return (
    <View style={styles.inputBlock}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#A8A29E"
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        secureTextEntry={secureTextEntry}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    backgroundColor: colors.background,
    padding: 20,
    gap: 16,
  },
  logoWrap: {
    alignItems: "center",
  },
  formCard: {
    backgroundColor: colors.card,
    borderRadius: 26,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  inputBlock: {
    gap: 6,
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
  optionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#FAFAF9",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  optionText: {
    color: colors.text,
    fontWeight: "800",
    fontSize: 12,
  },
  optionTextActive: {
    color: "#FFFFFF",
  },
  errorText: {
    color: colors.danger,
    fontWeight: "700",
    fontSize: 13,
  },
});
