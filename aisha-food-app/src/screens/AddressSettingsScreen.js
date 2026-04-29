import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAppShell } from "../context/AppShellContext";
import {
  buildSavedAddressSummary,
  composeDeliveryAddress,
  readSavedCustomerAddress,
} from "../lib/customerUi";

const SAVED_CUSTOMER_KEY = "aisha_saved_customer";

function readSavedCustomer(rawValue) {
  try {
    return rawValue ? JSON.parse(rawValue) : {};
  } catch {
    return {};
  }
}

export default function AddressSettingsScreen() {
  const { selectedCity, market } = useAppShell();
  const [savedCustomer, setSavedCustomer] = useState({});
  const [addressLine, setAddressLine] = useState("");
  const [district, setDistrict] = useState("");
  const [landmark, setLandmark] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");

  const isSpanish = market.defaultLanguage === "es";
  const text = isSpanish
    ? {
        title: "Direccion guardada",
        subtitle: "Esta informacion se reutiliza en checkout y en el inicio.",
        addressLine: "Direccion",
        district: "Barrio / zona",
        landmark: "Punto de referencia",
        instructions: "Instrucciones de entrega",
        placeholderAddress: "Calle, numero o descripcion",
        placeholderDistrict: "Hamdallaye, ACI, Kalaban...",
        placeholderLandmark: "Frente a, cerca de, al lado de...",
        placeholderInstructions: "Llamar al llegar, porton azul, piso...",
        summary: "Resumen",
        save: "Guardar direccion",
        saving: "Guardando...",
        saved: "Direccion guardada.",
      }
    : {
        title: "Adresse enregistree",
        subtitle: "Ces informations sont reutilisees au checkout et sur l'accueil.",
        addressLine: "Adresse",
        district: "Quartier / zone",
        landmark: "Repere",
        instructions: "Instructions de livraison",
        placeholderAddress: "Rue, numero ou description",
        placeholderDistrict: "Hamdallaye, ACI, Kalaban...",
        placeholderLandmark: "En face de, pres de, a cote de...",
        placeholderInstructions: "Appeler a l'arrivee, portail bleu, etage...",
        summary: "Resume",
        save: "Enregistrer l'adresse",
        saving: "Enregistrement...",
        saved: "Adresse enregistree.",
      };

  useEffect(() => {
    (async () => {
      const savedRaw = await AsyncStorage.getItem(SAVED_CUSTOMER_KEY);
      const saved = readSavedCustomer(savedRaw);
      const fields = readSavedCustomerAddress(saved);
      setSavedCustomer(saved);
      setAddressLine(fields.addressLine);
      setDistrict(fields.district);
      setLandmark(fields.landmark);
      setDeliveryInstructions(fields.deliveryInstructions);
    })().catch(() => null);
  }, []);

  const addressSummary = buildSavedAddressSummary(
    {
      ...savedCustomer,
      addressLine,
      address: composeDeliveryAddress({ addressLine, district, landmark }),
      district,
      neighborhood: district,
      quartier: district,
      landmark,
      repere: landmark,
      deliveryInstructions,
      notes: deliveryInstructions,
    },
    selectedCity
  );

  async function onSave() {
    setSaving(true);
    setSuccess("");
    try {
      const raw = await AsyncStorage.getItem(SAVED_CUSTOMER_KEY);
      const existing = readSavedCustomer(raw);
      const nextRecord = {
        ...existing,
        addressLine: String(addressLine || "").trim(),
        address: composeDeliveryAddress({ addressLine, district, landmark }),
        district: String(district || "").trim(),
        neighborhood: String(district || "").trim(),
        quartier: String(district || "").trim(),
        landmark: String(landmark || "").trim(),
        repere: String(landmark || "").trim(),
        deliveryInstructions: String(deliveryInstructions || "").trim(),
        notes: String(deliveryInstructions || "").trim(),
        updatedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(SAVED_CUSTOMER_KEY, JSON.stringify(nextRecord));
      setSavedCustomer(nextRecord);
      setSuccess(text.saved);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.title}>{text.title}</Text>
        <Text style={styles.subtitle}>{text.subtitle}</Text>

        <Text style={styles.label}>{text.addressLine}</Text>
        <TextInput
          value={addressLine}
          onChangeText={setAddressLine}
          style={styles.input}
          placeholder={text.placeholderAddress}
          placeholderTextColor="#94A3B8"
        />

        <Text style={styles.label}>{text.district}</Text>
        <TextInput
          value={district}
          onChangeText={setDistrict}
          style={styles.input}
          placeholder={text.placeholderDistrict}
          placeholderTextColor="#94A3B8"
        />

        <Text style={styles.label}>{text.landmark}</Text>
        <TextInput
          value={landmark}
          onChangeText={setLandmark}
          style={styles.input}
          placeholder={text.placeholderLandmark}
          placeholderTextColor="#94A3B8"
        />

        <Text style={styles.label}>{text.instructions}</Text>
        <TextInput
          value={deliveryInstructions}
          onChangeText={setDeliveryInstructions}
          style={[styles.input, styles.textArea]}
          placeholder={text.placeholderInstructions}
          placeholderTextColor="#94A3B8"
          multiline
        />
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>{text.summary}</Text>
        <Text style={styles.summaryValue}>{addressSummary}</Text>
        {deliveryInstructions ? (
          <Text style={styles.summaryHint}>{deliveryInstructions}</Text>
        ) : null}
        {success ? <Text style={styles.successText}>{success}</Text> : null}
        <Pressable style={styles.saveButton} disabled={saving} onPress={onSave}>
          <Text style={styles.saveButtonText}>{saving ? text.saving : text.save}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingBottom: 32,
    backgroundColor: "#FFF8F2",
    gap: 14,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#FED7AA",
    borderRadius: 18,
    padding: 14,
  },
  title: {
    color: "#0F172A",
    fontSize: 22,
    fontWeight: "900",
  },
  subtitle: {
    color: "#64748B",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 8,
  },
  label: {
    color: "#475569",
    fontSize: 13,
    marginTop: 8,
    marginBottom: 6,
    fontWeight: "700",
  },
  input: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    backgroundColor: "#FFF7ED",
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: "#0F172A",
    fontSize: 15,
  },
  textArea: {
    minHeight: 82,
    textAlignVertical: "top",
  },
  summaryCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#FED7AA",
    borderRadius: 18,
    padding: 14,
    gap: 8,
  },
  summaryTitle: {
    color: "#9A3412",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  summaryValue: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "800",
  },
  summaryHint: {
    color: "#64748B",
    fontSize: 13,
  },
  successText: {
    color: "#059669",
    fontSize: 13,
    fontWeight: "700",
  },
  saveButton: {
    marginTop: 6,
    backgroundColor: "#F97316",
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
});
