import { useEffect, useMemo, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect } from "expo-router";

import OrangeButton from "@/src/components/OrangeButton";
import ScreenHeader from "@/src/components/ScreenHeader";
import { useMerchantApp } from "@/src/context/MerchantAppContext";
import { colors } from "@/src/theme/colors";

export default function ProfileScreen() {
  const {
    apiUrl,
    authState,
    logout,
    merchantProfile,
    supportWhatsApp,
    updateProfile,
  } = useMerchantApp();
  const [form, setForm] = useState(merchantProfile);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm(merchantProfile);
  }, [merchantProfile]);

  const hasChanges = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(merchantProfile),
    [form, merchantProfile]
  );

  if (authState !== "approved") {
    return <Redirect href={authState === "pending" ? "/pending" : "/login"} />;
  }

  function updateField(field: keyof typeof form, value: string) {
    setSaved(false);
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function onSave() {
    try {
      setSaving(true);
      await updateProfile(form);
      setSaving(false);
      setSaved(true);
    } catch (error: unknown) {
      setSaving(false);
      Alert.alert(
        "Profile update",
        (error as { message?: string })?.message || "Could not update the profile."
      );
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ScreenHeader title="Profile" subtitle="Update store details and support settings." />

      <View style={styles.card}>
        <InputField label="Restaurant name" value={form.restaurantName} onChangeText={(value) => updateField("restaurantName", value)} />
        <InputField label="Owner name" value={form.ownerName} onChangeText={(value) => updateField("ownerName", value)} />
        <InputField label="Phone" value={form.phone} onChangeText={(value) => updateField("phone", value)} />
        <InputField label="WhatsApp" value={form.whatsapp} onChangeText={(value) => updateField("whatsapp", value)} />
        <InputField label="Address" value={form.address} onChangeText={(value) => updateField("address", value)} />
        <InputField label="Area" value={form.area || ""} onChangeText={(value) => updateField("area", value)} />
        <InputField label="City" value={form.city} onChangeText={(value) => updateField("city", value)} />

        <View style={styles.infoBlock}>
          <Text style={styles.inputLabel}>Delivery model</Text>
          <View style={styles.valuePill}>
            <Text style={styles.valuePillText}>{form.deliveryModel}</Text>
          </View>
        </View>

        <View style={styles.infoBlock}>
          <Text style={styles.inputLabel}>API URL</Text>
          <Text style={styles.apiValue}>{apiUrl || "EXPO_PUBLIC_API_URL is not configured."}</Text>
        </View>

        {saved ? <Text style={styles.successText}>Profile updated.</Text> : null}

        <OrangeButton
          label="Update profile"
          onPress={onSave}
          loading={saving}
          disabled={!hasChanges}
        />
        <OrangeButton
          label="Contact support"
          variant="outline"
          onPress={() =>
            Linking.openURL(
              `https://wa.me/${supportWhatsApp}?text=${encodeURIComponent(
                "Hello, I need help with my OranjeEats merchant account."
              )}`
            ).catch(() => null)
          }
        />
        <OrangeButton label="Logout" variant="danger" onPress={() => logout()} />
      </View>
    </ScrollView>
  );
}

function InputField({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.inputBlock}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor="#A8A29E"
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingBottom: 36,
    backgroundColor: colors.background,
    gap: 16,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  inputBlock: {
    gap: 6,
  },
  infoBlock: {
    gap: 8,
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
  valuePill: {
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceAlt,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  valuePillText: {
    color: colors.primaryDark,
    fontWeight: "800",
  },
  apiValue: {
    color: colors.muted,
    lineHeight: 20,
  },
  successText: {
    color: colors.success,
    fontWeight: "800",
    fontSize: 13,
  },
});
