import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import LoyaltySummaryCard from "../components/LoyaltySummaryCard";
import { apiGet } from "../lib/api";
import { API_BASE_URL, API_TARGET_PROFILE, describeApiTarget } from "../lib/config";
import {
  getLanguageOptions,
  getMarketConfig,
  normalizePreferredLanguage,
} from "../lib/marketConfig";
import { useAppShell } from "../context/AppShellContext";
import { getSupportAvailability } from "../lib/orderPresentation";
import { runLaunchValidation } from "../lib/pilotValidation";
import { openSupportWhatsApp } from "../lib/supportWhatsApp";
import { getUserProfile, updateUserProfile } from "../lib/userProfile";

const SAVED_CUSTOMER_KEY = "aisha_saved_customer";

function normalizePhone(value) {
  return String(value || "").replace(/\D+/g, "").trim();
}

function parseCuisines(value) {
  if (!value) return [];
  const values = String(value)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const unique = [];
  const seen = new Set();
  for (const item of values) {
    if (seen.has(item)) continue;
    seen.add(item);
    unique.push(item);
    if (unique.length >= 10) break;
  }
  return unique;
}

export default function ProfileScreen({ navigation }) {
  const {
    selectedCity: shellSelectedCity,
    setPreferredLanguage: applyAppLanguage,
  } = useAppShell();
  const [selectedAppCity, setSelectedAppCity] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [savedPhone, setSavedPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loyalty, setLoyalty] = useState(null);
  const [loyaltyLoading, setLoyaltyLoading] = useState(false);
  const [loyaltyError, setLoyaltyError] = useState("");
  const [diagnosticsUnlocked, setDiagnosticsUnlocked] = useState(
    typeof __DEV__ !== "undefined" && __DEV__
  );
  const [diagnosticTapCount, setDiagnosticTapCount] = useState(0);
  const [validationLoading, setValidationLoading] = useState(false);
  const [validationReport, setValidationReport] = useState(null);

  const [displayName, setDisplayName] = useState("");
  const [city, setCity] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState("es");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [cuisinesText, setCuisinesText] = useState("");

  const marketSource = profileData?.market || profileData?.activeCity || selectedAppCity;
  const market = useMemo(() => getMarketConfig(marketSource), [marketSource]);
  const supportAvailability = useMemo(() => getSupportAvailability(market), [market]);
  const isSpanish = market.defaultLanguage === "es";
  const languageOptions = useMemo(() => getLanguageOptions(marketSource), [marketSource]);
  const cuisinesPreview = useMemo(() => parseCuisines(cuisinesText), [cuisinesText]);
  const activeCityName = String(profileData?.activeCity?.name || selectedAppCity?.name || "").trim();
  const showDiagnostics = diagnosticsUnlocked;
  const text = isSpanish
    ? {
        title: "Mi perfil",
        subtitle: "Actualiza tus datos para pedir mas rapido.",
        linkedPhone: "Telefono vinculado",
        noPhone: "No disponible",
        activeCity: "Ciudad activa",
        noActiveCity: "Sin ciudad activa",
        changeCity: "Cambiar ciudad",
        supportCta: "Abrir soporte por WhatsApp",
        cityHelpTitle: "Telefono requerido",
        cityHelpBody: "Agrega tu numero desde checkout o Mis pedidos.",
        howToAddPhone: "Como agregar mi numero",
        loyaltyTitle: "Fidelidad y referido",
        loading: "Cargando perfil...",
        profileTitle: "Datos",
        name: "Nombre",
        namePlaceholder: "Tu nombre",
        cityField: "Ciudad / sector",
        language: "Idioma",
        cuisines: "Cocinas favoritas (separadas por comas)",
        cuisinesPlaceholder: "pizza, arroz, jugos",
        cuisinesHelp: "Se guardan hasta 10 categorias.",
        marketing: "Quiero recibir novedades de OranjeEats",
        save: "Guardar perfil",
        saving: "Guardando...",
        orders: "Ir a Mis pedidos",
        loadProfileError: "No fue posible cargar el perfil.",
        loadLoyaltyError: "No fue posible cargar la fidelidad.",
        missingPhone: "Agrega tu numero primero.",
        saved: "Perfil guardado.",
        saveError: "No fue posible guardar el perfil.",
        openCityError: "No fue posible abrir el selector de ciudad. Reinicia la app.",
        diagnostics: "Diagnostico de mercado",
        marketCode: "Mercado",
        preferred: "Idioma actual",
        currency: "Moneda",
        support: "WhatsApp soporte",
        supportUnavailable: "Soporte no configurado",
        supportWarning: "Reemplazo obligatorio antes del lanzamiento",
        paymentMethods: "Metodos de pago",
        apiBase: "API base",
        apiTarget: "Entorno API",
        diagnosticsUnlock: "Diagnostico desbloqueado.",
        validateNow: "Validar lanzamiento",
        validating: "Validando...",
        validationResult: "Resultado de validacion",
        validationPass: "Listo para la verificacion de lanzamiento",
        validationFail: "Hay puntos que bloquean el lanzamiento",
      }
    : {
        title: "Mon profil",
        subtitle: "Modifie tes informations pour commander plus vite.",
        linkedPhone: "Telephone lie",
        noPhone: "Non disponible",
        activeCity: "Ville active",
        noActiveCity: "Aucune ville active",
        changeCity: "Changer de ville",
        supportCta: "Ouvrir le support WhatsApp",
        cityHelpTitle: "Telephone requis",
        cityHelpBody: "Ajoute ton numero depuis le checkout ou Mes commandes.",
        howToAddPhone: "Comment ajouter mon numero",
        loyaltyTitle: "Fidelite et parrainage",
        loading: "Chargement du profil...",
        profileTitle: "Donnees",
        name: "Nom",
        namePlaceholder: "Ton nom",
        cityField: "Ville / quartier",
        language: "Langue",
        cuisines: "Cuisines preferees (separees par des virgules)",
        cuisinesPlaceholder: "grillades, riz, jus",
        cuisinesHelp: "Jusqu'a 10 categories sont conservees.",
        marketing: "Je veux recevoir les actualites d'OranjeEats",
        save: "Enregistrer le profil",
        saving: "Enregistrement...",
        orders: "Aller a Mes commandes",
        loadProfileError: "Impossible de charger le profil.",
        loadLoyaltyError: "Impossible de charger la fidelite.",
        missingPhone: "Ajoute d'abord ton numero.",
        saved: "Profil enregistre.",
        saveError: "Impossible d'enregistrer le profil.",
        openCityError: "Impossible d'ouvrir le selecteur de ville. Relance l'application.",
        diagnostics: "Diagnostic de marche",
        marketCode: "Marche",
        preferred: "Langue actuelle",
        currency: "Devise",
        support: "WhatsApp support",
        supportUnavailable: "Support non configure",
        supportWarning: "Remplacement obligatoire avant lancement",
        paymentMethods: "Modes de paiement",
        apiBase: "API base",
        apiTarget: "Environnement API",
        diagnosticsUnlock: "Diagnostic debloque.",
        validateNow: "Valider le lancement",
        validating: "Validation...",
        validationResult: "Resultat de validation",
        validationPass: "Pret pour la verification de lancement",
        validationFail: "Des points bloquent le lancement",
      };

  useEffect(() => {
    const normalized = normalizePreferredLanguage(preferredLanguage, marketSource);
    if (normalized !== preferredLanguage) {
      setPreferredLanguage(normalized);
    }
  }, [marketSource, preferredLanguage]);

  function openCitySelect() {
    const parent = navigation?.getParent?.();
    const parentRouteNames = parent?.getState?.()?.routeNames || [];
    if (Array.isArray(parentRouteNames) && parentRouteNames.includes("CitySelect")) {
      parent.navigate("CitySelect");
      return;
    }

    const localRouteNames = navigation?.getState?.()?.routeNames || [];
    if (Array.isArray(localRouteNames) && localRouteNames.includes("CitySelect")) {
      navigation.navigate("CitySelect");
      return;
    }

    Alert.alert(text.activeCity, text.openCityError);
  }

  function handleTitlePress() {
    if (showDiagnostics) return;
    const nextCount = diagnosticTapCount + 1;
    if (nextCount >= 5) {
      setDiagnosticsUnlocked(true);
      setDiagnosticTapCount(0);
      setSuccess(text.diagnosticsUnlock);
      return;
    }
    setDiagnosticTapCount(nextCount);
  }

  async function loadSavedPhone() {
    try {
      const raw = await AsyncStorage.getItem(SAVED_CUSTOMER_KEY);
      if (!raw) return "";
      const parsed = JSON.parse(raw);
      return normalizePhone(parsed?.phone || "");
    } catch {
      return "";
    }
  }

  async function loadActiveCity() {
    const storedCity = shellSelectedCity;
    if (!storedCity?._id) {
      setSelectedAppCity(null);
      return;
    }

    try {
      const response = await apiGet("/api/public/cities");
      const rows = Array.isArray(response?.cities) ? response.cities : [];
      const matched = rows.find(
        (row) => String(row?._id || "").trim() === String(storedCity._id || "").trim()
      );
      setSelectedAppCity(matched || storedCity);
    } catch {
      setSelectedAppCity(storedCity);
    }
  }

  async function loadProfile(phoneValue) {
    const normalizedPhone = normalizePhone(phoneValue);
    if (!normalizedPhone) {
      setError(text.missingPhone);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const profile = await getUserProfile(normalizedPhone);
      setProfileData(profile || null);
      setDisplayName(String(profile?.displayName || ""));
      setCity(String(profile?.city || profile?.homeCity?.name || ""));
      setPreferredLanguage(normalizePreferredLanguage(profile?.preferredLanguage || "", profile?.market || profile?.activeCity || selectedAppCity));
      setMarketingOptIn(Boolean(profile?.marketingOptIn));
      setCuisinesText(Array.isArray(profile?.favoriteCuisines) ? profile.favoriteCuisines.join(", ") : "");
    } catch (requestError) {
      setError(requestError?.message || text.loadProfileError);
    } finally {
      setLoading(false);
    }
  }

  async function loadLoyalty(phoneValue) {
    const normalizedPhone = normalizePhone(phoneValue);
    if (!normalizedPhone) {
      setLoyalty(null);
      setLoyaltyError("");
      return;
    }
    setLoyaltyLoading(true);
    setLoyaltyError("");
    try {
      const response = await apiGet(`/api/public/loyalty?phone=${encodeURIComponent(normalizedPhone)}`);
      setLoyalty(response || null);
    } catch (requestError) {
      setLoyalty(null);
      setLoyaltyError(requestError?.message || text.loadLoyaltyError);
    } finally {
      setLoyaltyLoading(false);
    }
  }

  async function syncSavedCustomer(payload) {
    try {
      const raw = await AsyncStorage.getItem(SAVED_CUSTOMER_KEY);
      const existing = raw ? JSON.parse(raw) : {};
      const merged = {
        ...existing,
        customerName: payload.displayName || existing.customerName || "",
        city: payload.city || existing.city || "",
        updatedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(SAVED_CUSTOMER_KEY, JSON.stringify(merged));
    } catch {
      // Ignore local sync errors.
    }
  }

  async function onSave() {
    if (!savedPhone) {
      setError(text.missingPhone);
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        displayName: String(displayName || "").trim().slice(0, 80),
        city: String(city || "").trim().slice(0, 80),
        preferredLanguage: normalizePreferredLanguage(preferredLanguage, marketSource),
        marketingOptIn: Boolean(marketingOptIn),
        favoriteCuisines: cuisinesPreview,
      };
      const updated = await updateUserProfile(savedPhone, payload);
      setProfileData(updated || null);
      setDisplayName(String(updated?.displayName || payload.displayName || ""));
      setCity(String(updated?.city || payload.city || ""));
      setPreferredLanguage(
        normalizePreferredLanguage(updated?.preferredLanguage || payload.preferredLanguage, updated?.market || updated?.activeCity || marketSource)
      );
      const cuisines = Array.isArray(updated?.favoriteCuisines)
        ? updated.favoriteCuisines
        : payload.favoriteCuisines;
      setCuisinesText(Array.isArray(cuisines) ? cuisines.join(", ") : "");
      setMarketingOptIn(Boolean(updated?.marketingOptIn ?? payload.marketingOptIn));
      await syncSavedCustomer({
        displayName: String(updated?.displayName || payload.displayName || ""),
        city: String(updated?.city || payload.city || ""),
      });
      await applyAppLanguage(updated?.preferredLanguage || payload.preferredLanguage);
      setSuccess(text.saved);
    } catch (requestError) {
      setError(requestError?.message || text.saveError);
    } finally {
      setSaving(false);
    }
  }

  async function onRunValidation() {
    setValidationLoading(true);
    setValidationReport(null);
    setError("");
    try {
      const report = await runLaunchValidation();
      setValidationReport(report);
    } catch (requestError) {
      setValidationReport({
        ok: false,
        checks: [
          {
            id: "validation-run",
            label: text.validationResult,
            ok: false,
            detail: requestError?.message || "Validation failed.",
          },
        ],
        market,
      });
    } finally {
      setValidationLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      const phoneValue = await loadSavedPhone();
      setSavedPhone(phoneValue);
      await loadActiveCity();
      await Promise.all([loadProfile(phoneValue), loadLoyalty(phoneValue)]);
    })();
  }, [shellSelectedCity]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      loadActiveCity().catch(() => null);
      if (savedPhone) {
        loadProfile(savedPhone).catch(() => null);
        loadLoyalty(savedPhone).catch(() => null);
      }
    });
    return unsubscribe;
  }, [navigation, savedPhone, shellSelectedCity]);

  return (
    <KeyboardAvoidingView
      style={styles.safeArea}
      behavior={Platform.select({ ios: "padding", android: undefined })}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={handleTitlePress}>
            <Text style={styles.title}>{text.title}</Text>
          </Pressable>
          <Text style={styles.subtitle}>{text.subtitle}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>{text.linkedPhone}</Text>
          <Text style={styles.value}>{savedPhone || text.noPhone}</Text>
          <Text style={[styles.label, { marginTop: 10 }]}>{text.activeCity}</Text>
          <Text style={styles.value}>{activeCityName || text.noActiveCity}</Text>
          <Pressable
            style={[styles.secondaryButton, { marginTop: 10 }]}
            onPress={openCitySelect}
          >
            <Text style={styles.secondaryButtonText}>{text.changeCity}</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            disabled={!supportAvailability.configured}
            onPress={() =>
              openSupportWhatsApp({
                city: marketSource,
              })
            }
            >
            <Text style={styles.secondaryButtonText}>
              {supportAvailability.configured ? text.supportCta : text.supportUnavailable}
            </Text>
          </Pressable>
          {!savedPhone ? (
            <Pressable
              style={styles.secondaryButton}
              onPress={() => Alert.alert(text.cityHelpTitle, text.cityHelpBody)}
            >
              <Text style={styles.secondaryButtonText}>{text.howToAddPhone}</Text>
            </Pressable>
          ) : null}
        </View>

        <LoyaltySummaryCard
          title={text.loyaltyTitle}
          loyalty={loyalty}
          loading={loyaltyLoading}
          error={loyaltyError}
          onRetry={() => loadLoyalty(savedPhone)}
          city={marketSource}
        />

        {showDiagnostics ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{text.diagnostics}</Text>
            <Text style={styles.helperText}>{text.activeCity}: {activeCityName || text.noActiveCity}</Text>
            <Text style={styles.helperText}>{text.marketCode}: {market.marketCode}</Text>
            <Text style={styles.helperText}>{text.preferred}: {preferredLanguage || market.defaultLanguage}</Text>
            <Text style={styles.helperText}>{text.currency}: {market.currencyDisplay}</Text>
            <Text style={styles.helperText}>
              {text.support}: {market.supportWhatsAppIsPlaceholder ? text.supportWarning : market.supportWhatsApp}
            </Text>
            <Text style={styles.helperText}>{text.apiBase}: {API_BASE_URL || "not set"}</Text>
            <Text style={styles.helperText}>
              {text.apiTarget}: {describeApiTarget(API_TARGET_PROFILE)}
            </Text>
            <Text style={styles.helperText}>
              {text.paymentMethods}: {(market.paymentMethods || []).join(", ") || "cash"}
            </Text>
            <Pressable
              style={[styles.secondaryButton, { marginTop: 12 }]}
              onPress={onRunValidation}
              disabled={validationLoading}
            >
              <Text style={styles.secondaryButtonText}>
                {validationLoading ? text.validating : text.validateNow}
              </Text>
            </Pressable>

            {validationReport ? (
              <View style={styles.validationBlock}>
                <Text
                  style={[
                    styles.validationHeadline,
                    validationReport.ok ? styles.validationPass : styles.validationFail,
                  ]}
                >
                  {validationReport.ok ? text.validationPass : text.validationFail}
                </Text>
                {Array.isArray(validationReport.checks)
                  ? validationReport.checks.map((check) => (
                      <View key={check.id} style={styles.validationRow}>
                        <Text
                          style={[
                            styles.validationStatus,
                            check.ok ? styles.validationPass : styles.validationFail,
                          ]}
                        >
                          {check.ok ? "PASS" : "FAIL"}
                        </Text>
                        <View style={styles.validationTextWrap}>
                          <Text style={styles.validationLabel}>{check.label}</Text>
                          {check.detail ? (
                            <Text style={styles.validationDetail}>{check.detail}</Text>
                          ) : null}
                        </View>
                      </View>
                    ))
                  : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#0F172A" />
            <Text style={styles.loadingText}>{text.loading}</Text>
          </View>
        ) : (
          <View style={styles.formCard}>
            <Text style={styles.sectionTitle}>{text.profileTitle}</Text>

            <Text style={styles.inputLabel}>{text.name}</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder={text.namePlaceholder}
              placeholderTextColor="#94A3B8"
              maxLength={80}
            />

            <Text style={styles.inputLabel}>{text.cityField}</Text>
            <TextInput
              style={styles.input}
              value={city}
              onChangeText={setCity}
              placeholder={activeCityName}
              placeholderTextColor="#94A3B8"
              maxLength={80}
            />

            <Text style={styles.inputLabel}>{text.language}</Text>
            <View style={styles.langRow}>
              {languageOptions.map((option) => {
                const active = preferredLanguage === option.value;
                return (
                  <Pressable
                    key={option.value}
                    style={[styles.langPill, active && styles.langPillActive]}
                    onPress={() => setPreferredLanguage(option.value)}
                  >
                    <Text style={[styles.langText, active && styles.langTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.inputLabel}>{text.cuisines}</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={cuisinesText}
              onChangeText={setCuisinesText}
              placeholder={text.cuisinesPlaceholder}
              placeholderTextColor="#94A3B8"
              multiline
            />
            <Text style={styles.helperText}>{text.cuisinesHelp}</Text>

            <Pressable
              style={[styles.toggleRow, marketingOptIn && styles.toggleRowActive]}
              onPress={() => setMarketingOptIn((prev) => !prev)}
            >
              <View style={[styles.checkCircle, marketingOptIn && styles.checkCircleActive]} />
              <Text style={styles.toggleText}>{text.marketing}</Text>
            </Pressable>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {success ? <Text style={styles.successText}>{success}</Text> : null}

            <Pressable
              style={[styles.primaryButton, (saving || !savedPhone) && styles.primaryButtonDisabled]}
              disabled={saving || !savedPhone}
              onPress={onSave}
            >
              <Text style={styles.primaryButtonText}>{saving ? text.saving : text.save}</Text>
            </Pressable>

            <Pressable
              style={styles.secondaryButton}
              onPress={() => navigation.navigate("MainTabs", { screen: "Orders" })}
            >
              <Text style={styles.secondaryButtonText}>{text.orders}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAF9",
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 14,
  },
  header: {
    gap: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    color: "#0F172A",
  },
  subtitle: {
    fontSize: 14,
    color: "#64748B",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  label: {
    fontSize: 12,
    color: "#64748B",
  },
  value: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
  },
  loadingBox: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 22,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: "#64748B",
  },
  formCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 8,
  },
  inputLabel: {
    fontSize: 13,
    color: "#475569",
    marginTop: 8,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#0F172A",
  },
  textArea: {
    minHeight: 74,
    textAlignVertical: "top",
  },
  helperText: {
    marginTop: 6,
    fontSize: 12,
    color: "#64748B",
  },
  validationBlock: {
    marginTop: 12,
    gap: 8,
  },
  validationHeadline: {
    fontSize: 13,
    fontWeight: "800",
  },
  validationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  validationStatus: {
    width: 40,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
  },
  validationTextWrap: {
    flex: 1,
  },
  validationLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
  },
  validationDetail: {
    marginTop: 2,
    fontSize: 12,
    color: "#64748B",
  },
  validationPass: {
    color: "#047857",
  },
  validationFail: {
    color: "#B91C1C",
  },
  langRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  langPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: "#FFFFFF",
  },
  langPillActive: {
    borderColor: "#0F172A",
    backgroundColor: "#0F172A",
  },
  langText: {
    fontSize: 13,
    color: "#334155",
    fontWeight: "600",
  },
  langTextActive: {
    color: "#FFFFFF",
  },
  toggleRow: {
    marginTop: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#F8FAFC",
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  toggleRowActive: {
    borderColor: "#0F766E",
    backgroundColor: "#ECFDF5",
  },
  checkCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#94A3B8",
    backgroundColor: "#FFFFFF",
  },
  checkCircleActive: {
    borderColor: "#0F766E",
    backgroundColor: "#0F766E",
  },
  toggleText: {
    flex: 1,
    color: "#0F172A",
    fontSize: 13,
  },
  errorText: {
    marginTop: 12,
    color: "#DC2626",
    fontSize: 13,
  },
  successText: {
    marginTop: 12,
    color: "#059669",
    fontSize: 13,
  },
  primaryButton: {
    marginTop: 14,
    borderRadius: 12,
    backgroundColor: "#0F172A",
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 15,
  },
  secondaryButton: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    paddingVertical: 10,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#334155",
    fontWeight: "700",
  },
});
