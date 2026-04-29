import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useAppShell } from "../context/AppShellContext";
import { apiGet } from "../lib/api";

export default function CitySelectScreen({ navigation }) {
  const { selectCity } = useAppShell();
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");

  async function loadCities() {
    setLoading(true);
    setError("");
    try {
      const res = await apiGet("/api/public/cities");
      const rows = Array.isArray(res?.cities) ? res.cities : [];
      setCities(rows);
      if (!rows.length) {
        setError("No hay ciudades activas disponibles.");
      }
    } catch (e) {
      setError(e?.message || "No se pudieron cargar las ciudades.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCities();
  }, []);

  async function chooseCity(city) {
    const cityId = String(city?._id || "").trim();
    if (!cityId) return;
    setSavingId(cityId);
    try {
      const saved = await selectCity(city);
      if (!saved) {
        throw new Error("Ciudad invalida.");
      }
      navigation.reset({
        index: 0,
        routes: [{ name: "MainTabs" }],
      });
    } catch (e) {
      Alert.alert("Ciudad", e?.message || "No se pudo guardar la ciudad.");
    } finally {
      setSavingId("");
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#f8fafc", padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: "900" }}>Selecciona tu ciudad</Text>
      <Text style={{ color: "#475569" }}>
        Esta seleccion se usa para enviar el contexto de ciudad al backend.
      </Text>

      {loading ? (
        <View style={{ marginTop: 20 }}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 20 }}>
          {cities.map((city) => {
            const cityId = String(city?._id || "");
            const saving = savingId === cityId;
            return (
              <Pressable
                key={cityId}
                onPress={() => chooseCity(city)}
                disabled={saving}
                style={{
                  backgroundColor: "#fff",
                  borderWidth: 1,
                  borderColor: "#e2e8f0",
                  borderRadius: 12,
                  padding: 12,
                  gap: 4,
                }}
              >
                <Text style={{ fontSize: 18, fontWeight: "800" }}>{String(city?.name || "")}</Text>
                <Text style={{ color: "#64748b" }}>
                  {String(city?.country || "")} - {String(city?.currency || "")}
                </Text>
                <Text style={{ color: "#0f172a", fontWeight: "700" }}>
                  {saving ? "Guardando..." : "Usar esta ciudad"}
                </Text>
              </Pressable>
            );
          })}
          {error ? (
            <View
              style={{
                backgroundColor: "#fee2e2",
                borderWidth: 1,
                borderColor: "#fecaca",
                borderRadius: 10,
                padding: 10,
              }}
            >
              <Text style={{ color: "#b91c1c" }}>{error}</Text>
              <Pressable
                onPress={loadCities}
                style={{
                  marginTop: 8,
                  backgroundColor: "#991b1b",
                  borderRadius: 8,
                  padding: 8,
                  alignSelf: "flex-start",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>Reintentar</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
