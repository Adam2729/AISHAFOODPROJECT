import { useMemo, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect } from "expo-router";

import OrangeButton from "@/src/components/OrangeButton";
import ScreenHeader from "@/src/components/ScreenHeader";
import { type DeliveryModel } from "@/src/data/mockData";
import { useMerchantApp } from "@/src/context/MerchantAppContext";
import { colors } from "@/src/theme/colors";

const deliveryOptions: DeliveryModel[] = ["platform_driver", "self_delivery", "both"];

export default function ProfileScreen() {
  const { authState, merchantProfile, updateProfile, logout, supportWhatsApp } = useMerchantApp();
  const [form, setForm] = useState(merchantProfile);
  const [saved, setSaved] = useState(false);
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

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ScreenHeader title="Profile" subtitle="Update store details and support settings." />

      <View style={styles.card}>
        <InputField label="Restaurant name" value={form.restaurantName} onChangeText={(value) => updateField("restaurantName", value)} />
        <InputField label="Owner name" value={form.ownerName} onChangeText={(value) => updateField("ownerName", value)} />
        <InputField label="Phone" value={form.phone} onChangeText={(value) => updateField("phone", value)} />
        <InputField label="WhatsApp" value={form.whatsapp} onChangeText={(value) => updateField("whatsapp", value)} />
        <InputField label="Address" value={form.address} onChangeText={(value) => updateField("address", value)} />
        <InputField label="City" value={form.city} onChangeText={(value) => updateField("city", value)} />
        <InputField label="Opening hours" value={form.openingHours} onChangeText={(value) => updateField("openingHours", value)} />

        <Text style={styles.inputLabel}>Delivery model</Text>
        <View style={styles.optionRow}>
          {deliveryOptions.map((option) => {
            const active = form.deliveryModel === option;
            return (
              <OrangeButton
                key={option}
                label={option}
                variant={active ? "primary" : "outline"}
                onPress={() => updateField("deliveryModel", option)}
                style={styles.optionButton}
              />
            );
          })}
        </View>

        {saved ? <Text style={styles.successText}>Profile updated.</Text> : null}

        <OrangeButton
          label="Update profile"
          onPress={() => {
            updateProfile(form);
            setSaved(true);
          }}
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
        <OrangeButton label="Logout" variant="danger" onPress={logout} />
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
    marginBottom: 4,
  },
  optionButton: {
    minHeight: 42,
  },
  successText: {
    color: colors.success,
    fontWeight: "800",
    fontSize: 13,
  },
});
