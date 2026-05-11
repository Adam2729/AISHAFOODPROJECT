import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Redirect } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import Logo from "@/src/components/Logo";
import OrangeButton from "@/src/components/OrangeButton";
import ScreenHeader from "@/src/components/ScreenHeader";
import { useMerchantApp } from "@/src/context/MerchantAppContext";
import { compressImage, pickImage, uploadImage } from "@/src/lib/imageUpload";
import { colors } from "@/src/theme/colors";

type LocalLogoAsset = {
  uri: string;
  mimeType?: string;
  fileName?: string;
};

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
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState("");
  const [localLogo, setLocalLogo] = useState<LocalLogoAsset | null>(null);

  useEffect(() => {
    setForm(merchantProfile);
    setLocalLogo(null);
  }, [merchantProfile]);

  const hasChanges = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(merchantProfile) || Boolean(localLogo?.uri),
    [form, localLogo, merchantProfile]
  );
  const previewLogoUri = String(localLogo?.uri || form.logoUrl || "").trim();

  if (authState !== "approved") {
    return <Redirect href={authState === "pending" ? "/pending" : "/login"} />;
  }

  function updateField(field: keyof typeof form, value: string) {
    setSaved(false);
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function chooseLogo(source: "camera" | "library") {
    try {
      setLogoError("");
      const picked = await pickImage({ source, aspect: [1, 1] });
      if (!picked) return;
      const compressed = await compressImage(picked.uri);
      setLocalLogo({
        uri: compressed.uri,
        mimeType: compressed.mimeType,
        fileName: compressed.fileName,
      });
    } catch (error) {
      Alert.alert("Logo", error instanceof Error ? error.message : "Could not prepare the logo.");
    }
  }

  async function uploadSelectedLogo() {
    if (!localLogo?.uri) return String(form.logoUrl || "").trim();
    setUploadingLogo(true);
    setLogoError("");
    try {
      const logoUrl = await uploadImage(localLogo, "merchant_logo");
      setForm((current) => ({ ...current, logoUrl }));
      setLocalLogo(null);
      return logoUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed. Try again.";
      setLogoError(message);
      throw error;
    } finally {
      setUploadingLogo(false);
    }
  }

  async function onSave() {
    try {
      setSaving(true);
      const logoUrl = await uploadSelectedLogo();
      await updateProfile({
        ...form,
        logoUrl,
      });
      setSaved(true);
    } catch (error: unknown) {
      Alert.alert(
        "Profile update",
        (error as { message?: string })?.message || "Could not update the profile."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ScreenHeader title="Profile" subtitle="Business details, logo and payout settings." />

      <View style={styles.heroCard}>
        <View style={styles.logoFrame}>
          {previewLogoUri ? (
            <Image source={{ uri: previewLogoUri }} style={styles.logoImage} contentFit="cover" transition={150} cachePolicy="disk" />
          ) : (
            <View style={styles.logoFallback}>
              <Logo width={92} height={38} />
            </View>
          )}
          {uploadingLogo ? (
            <View style={styles.logoOverlay}>
              <Ionicons name="cloud-upload-outline" size={22} color="#FFFFFF" />
            </View>
          ) : null}
        </View>
        <View style={styles.heroText}>
          <Text style={styles.heroTitle}>{form.restaurantName}</Text>
          <Text style={styles.heroMeta}>{form.city ? `${form.city}, Mali` : "Bamako, Mali"}</Text>
          <Text style={styles.heroMeta}>{form.phone}</Text>
        </View>
        <View style={styles.heroActions}>
          <OrangeButton label="Camera" variant="secondary" onPress={() => chooseLogo("camera").catch(() => null)} />
          <OrangeButton label="Gallery" variant="outline" onPress={() => chooseLogo("library").catch(() => null)} />
          <OrangeButton
            label="Remove"
            variant="ghost"
            onPress={() => {
              setLocalLogo(null);
              setLogoError("");
              setForm((current) => ({ ...current, logoUrl: "" }));
            }}
          />
        </View>
        {logoError ? <Text style={styles.logoError}>{logoError}</Text> : null}
      </View>

      <SectionCard title="Business Information">
        <InputField label="Business name" value={form.restaurantName} onChangeText={(value) => updateField("restaurantName", value)} />
        <InputField label="Owner name" value={form.ownerName} onChangeText={(value) => updateField("ownerName", value)} />
        <InputField label="Phone" value={form.phone} onChangeText={(value) => updateField("phone", value)} />
        <InputField label="WhatsApp" value={form.whatsapp} onChangeText={(value) => updateField("whatsapp", value)} />
        <InputField label="Address" value={form.address} onChangeText={(value) => updateField("address", value)} multiline />
        <InputField label="Opening hours" value={form.openingHours} onChangeText={(value) => updateField("openingHours", value)} placeholder="08:00 - 22:00" />
      </SectionCard>

      <SectionCard title="Payment Information">
        <InfoRow label="Delivery model" value={form.deliveryModel} />
        <InputField label="Preferred payout method" value={form.payoutMethod || "cash"} onChangeText={(value) => updateField("payoutMethod", value)} />
        <InputField label="Account holder name" value={form.payoutAccountName || ""} onChangeText={(value) => updateField("payoutAccountName", value)} />
        <InputField label="Payout phone / account number" value={form.payoutAccountNumber || ""} onChangeText={(value) => updateField("payoutAccountNumber", value)} />
        <InputField label="Payout notes" value={form.payoutNotes || ""} onChangeText={(value) => updateField("payoutNotes", value)} multiline />
      </SectionCard>

      <SectionCard title="Bank Details">
        <InfoRow label="Currency" value="FCFA / XOF" />
        <InfoRow label="API URL" value={apiUrl || "EXPO_PUBLIC_API_URL is not configured."} />
      </SectionCard>

      {saved ? (
        <View style={styles.successCard}>
          <Ionicons name="checkmark-circle" size={24} color={colors.success} />
          <View style={{ flex: 1 }}>
            <Text style={styles.successTitle}>Profile Updated Successfully</Text>
            <Text style={styles.successText}>The merchant profile is ready for live operations.</Text>
          </View>
        </View>
      ) : null}

      <OrangeButton label="Save Changes" onPress={onSave} loading={saving} disabled={!hasChanges} />
      <OrangeButton
        label="Contact support"
        variant="outline"
        onPress={() =>
          Linking.openURL(
            `https://wa.me/${supportWhatsApp}?text=${encodeURIComponent(
              "Bonjour, j'ai besoin d'aide avec mon compte marchand OranjeEats."
            )}`
          ).catch(() => null)
        }
      />
      <OrangeButton label="Logout" variant="danger" onPress={() => logout()} />
    </ScrollView>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function InputField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <View style={styles.inputBlock}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#A8A29E"
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={[styles.input, multiline && styles.textarea]}
      />
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.inputLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
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
  heroCard: {
    backgroundColor: colors.card,
    borderRadius: 28,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 14,
  },
  logoFrame: {
    width: 112,
    height: 112,
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
  },
  logoImage: {
    width: "100%",
    height: "100%",
  },
  logoFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  logoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(17,17,17,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroText: {
    gap: 4,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  heroMeta: {
    color: colors.muted,
    lineHeight: 19,
  },
  heroActions: {
    gap: 10,
  },
  logoError: {
    color: colors.danger,
    fontWeight: "700",
  },
  sectionCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  sectionBody: {
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
  textarea: {
    minHeight: 90,
  },
  infoRow: {
    gap: 6,
  },
  infoValue: {
    color: colors.muted,
    lineHeight: 20,
  },
  successCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.successSoft,
    borderRadius: 18,
    padding: 14,
  },
  successTitle: {
    color: colors.success,
    fontWeight: "900",
    fontSize: 15,
  },
  successText: {
    color: colors.success,
    lineHeight: 18,
    fontSize: 12,
  },
});
