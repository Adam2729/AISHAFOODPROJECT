import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import LoyaltySummaryCard from "../components/LoyaltySummaryCard";
import { useAppShell } from "../context/AppShellContext";
import { apiGet } from "../lib/api";
import {
  buildSavedAddressSummary,
  readSavedCustomerAddress,
} from "../lib/customerUi";
import { getMarketConfig, getLanguageOptions, normalizePreferredLanguage } from "../lib/marketConfig";
import { getSupportAvailability } from "../lib/orderPresentation";
import { openSupportWhatsApp } from "../lib/supportWhatsApp";
import { getUserProfile, updateUserProfile } from "../lib/userProfile";

const SAVED_CUSTOMER_KEY = "aisha_saved_customer";

function normalizePhone(value) {
  return String(value || "").replace(/\D+/g, "").trim();
}

function readSavedCustomer(rawValue) {
  try {
    return rawValue ? JSON.parse(rawValue) : {};
  } catch {
    return {};
  }
}

function RouteTile({ icon, title, subtitle, onPress }) {
  return (
    <Pressable style={styles.routeTile} onPress={onPress}>
      <View style={styles.routeIcon}>
        <Ionicons name={icon} size={18} color="#F97316" />
      </View>
      <View style={styles.routeBody}>
        <Text style={styles.routeTitle}>{title}</Text>
        {subtitle ? <Text style={styles.routeSubtitle}>{subtitle}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
    </Pressable>
  );
}

export default function AccountHubScreen({ navigation }) {
  const {
    selectedCity,
    market: shellMarket,
    setPreferredLanguage: applyAppLanguage,
  } = useAppShell();
  const [savedCustomer, setSavedCustomer] = useState({});
  const [savedPhone, setSavedPhone] = useState("");
  const [profile, setProfile] = useState(null);
  const [loyalty, setLoyalty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loyaltyError, setLoyaltyError] = useState("");
  const [languageSaving, setLanguageSaving] = useState("");

  const marketSource = profile?.market || profile?.activeCity || selectedCity;
  const market = useMemo(() => getMarketConfig(marketSource || shellMarket), [marketSource, shellMarket]);
  const supportAvailability = useMemo(() => getSupportAvailability(market), [market]);
  const isSpanish = market.defaultLanguage === "es";
  const languageOptions = useMemo(() => getLanguageOptions(marketSource), [marketSource]);
  const currentLanguage = normalizePreferredLanguage(
    profile?.preferredLanguage || market.defaultLanguage,
    marketSource
  );
  const addressFields = useMemo(
    () => readSavedCustomerAddress(savedCustomer),
    [savedCustomer]
  );
  const addressSummary = useMemo(
    () => buildSavedAddressSummary(savedCustomer, marketSource),
    [marketSource, savedCustomer]
  );
  const displayName = String(
    profile?.displayName || savedCustomer?.customerName || ""
  ).trim();

  const text = isSpanish
    ? {
        title: "Mi cuenta",
        subtitle: "Ajustes, direccion, idioma, fidelidad y soporte en un solo lugar.",
        guest: "Cliente AishaFood",
        noPhone: "Agrega tu numero en checkout para guardar preferencias.",
        city: "Ciudad activa",
        settings: "Ajustes del perfil",
        settingsHint: "Nombre, gustos y preferencias de cuenta",
        address: "Direccion guardada",
        addressHint: "Entrega, barrio y punto de referencia",
        orders: "Mis pedidos",
        ordersHint: "Seguimiento, soporte y repetir pedido",
        cityRouter: "Cambiar ciudad",
        cityHint: "Actualizar el mercado activo",
        language: "Idioma",
        languageHint: "Preferencia de idioma de tu cuenta",
        loyalty: "Fidelidad y referido",
        support: "Soporte WhatsApp",
        supportHint: "Ayuda con pedidos, direccion o seguimiento",
        supportUnavailable: "Soporte no disponible",
        editAddress: "Editar direccion",
        openSettings: "Abrir ajustes",
        loading: "Cargando cuenta...",
        loadError: "No fue posible cargar tu cuenta.",
        addPhoneHint: "Necesitas un numero guardado para cambiar el idioma.",
      }
    : {
        title: "Mon compte",
        subtitle: "Parametres, adresse, langue, fidelite et support au meme endroit.",
        guest: "Client AishaFood",
        noPhone: "Ajoute ton numero au checkout pour enregistrer tes preferences.",
        city: "Ville active",
        settings: "Parametres du profil",
        settingsHint: "Nom, gouts et preferences du compte",
        address: "Adresse enregistree",
        addressHint: "Livraison, quartier et repere",
        orders: "Mes commandes",
        ordersHint: "Suivi, support et nouvelle commande",
        cityRouter: "Changer de ville",
        cityHint: "Mettre a jour le marche actif",
        language: "Langue",
        languageHint: "Preference de langue de ton compte",
        loyalty: "Fidelite et parrainage",
        support: "Support WhatsApp",
        supportHint: "Aide pour commandes, adresse ou suivi",
        supportUnavailable: "Support indisponible",
        editAddress: "Modifier l'adresse",
        openSettings: "Ouvrir les parametres",
        loading: "Chargement du compte...",
        loadError: "Impossible de charger ton compte.",
        addPhoneHint: "Tu as besoin d'un numero enregistre pour changer la langue.",
      };

  const openCitySelect = useCallback(() => {
    const parent = navigation?.getParent?.();
    const parentRouteNames = parent?.getState?.()?.routeNames || [];
    if (Array.isArray(parentRouteNames) && parentRouteNames.includes("CitySelect")) {
      parent.navigate("CitySelect");
      return;
    }

    const localRouteNames = navigation?.getState?.()?.routeNames || [];
    if (Array.isArray(localRouteNames) && localRouteNames.includes("CitySelect")) {
      navigation.navigate("CitySelect");
    }
  }, [navigation]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    setLoyaltyError("");
    try {
      const savedRaw = await AsyncStorage.getItem(SAVED_CUSTOMER_KEY);
      const saved = readSavedCustomer(savedRaw);
      const phone = normalizePhone(saved?.phone || "");

      setSavedCustomer(saved);
      setSavedPhone(phone);

      if (!phone) {
        setProfile(null);
        setLoyalty(null);
        return;
      }

      const [profileResponse, loyaltyResponse] = await Promise.allSettled([
        getUserProfile(phone),
        apiGet(`/api/public/loyalty?phone=${encodeURIComponent(phone)}`),
      ]);

      if (profileResponse.status === "fulfilled") {
        setProfile(profileResponse.value || null);
      } else {
        setProfile(null);
        setError(profileResponse.reason?.message || text.loadError);
      }

      if (loyaltyResponse.status === "fulfilled") {
        setLoyalty(loyaltyResponse.value || null);
      } else {
        setLoyalty(null);
        setLoyaltyError(loyaltyResponse.reason?.message || "");
      }
    } catch (requestError) {
      setError(requestError?.message || text.loadError);
    } finally {
      setLoading(false);
    }
  }, [text.loadError]);

  useEffect(() => {
    loadAll().catch(() => null);
  }, [loadAll]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      loadAll().catch(() => null);
    });
    return unsubscribe;
  }, [loadAll, navigation]);

  async function onChangeLanguage(nextLanguage) {
    if (!savedPhone || languageSaving) return;
    setLanguageSaving(nextLanguage);
    setError("");
    try {
      const updated = await updateUserProfile(savedPhone, {
        preferredLanguage: nextLanguage,
      });
      setProfile(updated || null);
      await applyAppLanguage(updated?.preferredLanguage || nextLanguage);
    } catch (requestError) {
      setError(requestError?.message || text.loadError);
    } finally {
      setLanguageSaving("");
    }
  }

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color="#F97316" />
        <Text style={styles.loadingText}>{text.loading}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.heroTitle}>{displayName || text.guest}</Text>
        <Text style={styles.heroSubtitle}>{savedPhone || text.noPhone}</Text>
        <View style={styles.heroMetaRow}>
          <View style={styles.heroMetaPill}>
            <Ionicons name="location-outline" size={14} color="#9A3412" />
            <Text style={styles.heroMetaText}>
              {text.city}: {String(selectedCity?.name || "-")}
            </Text>
          </View>
        </View>
      </View>

      {error ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{text.title}</Text>
        <Text style={styles.sectionSubtitle}>{text.subtitle}</Text>

        <RouteTile
          icon="settings-outline"
          title={text.settings}
          subtitle={text.settingsHint}
          onPress={() => navigation.navigate("ProfileSettings")}
        />
        <RouteTile
          icon="home-outline"
          title={text.address}
          subtitle={addressFields.composedAddress || text.addressHint}
          onPress={() => navigation.navigate("AddressSettings")}
        />
        <RouteTile
          icon="receipt-outline"
          title={text.orders}
          subtitle={text.ordersHint}
          onPress={() => navigation.navigate("Orders")}
        />
        <RouteTile
          icon="navigate-outline"
          title={text.cityRouter}
          subtitle={text.cityHint}
          onPress={openCitySelect}
        />
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{text.language}</Text>
        <Text style={styles.sectionSubtitle}>
          {savedPhone ? text.languageHint : text.addPhoneHint}
        </Text>
        <View style={styles.languageRow}>
          {languageOptions.map((option) => {
            const active = currentLanguage === option.value;
            const busy = languageSaving === option.value;
            return (
              <Pressable
                key={option.value}
                style={[
                  styles.languagePill,
                  active && styles.languagePillActive,
                  (!savedPhone || Boolean(languageSaving)) && styles.languagePillDisabled,
                ]}
                disabled={!savedPhone || Boolean(languageSaving)}
                onPress={() => onChangeLanguage(option.value)}
              >
                <Text
                  style={[
                    styles.languageText,
                    active && styles.languageTextActive,
                  ]}
                >
                  {busy ? "..." : option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable style={styles.linkButton} onPress={() => navigation.navigate("ProfileSettings")}>
          <Text style={styles.linkButtonText}>{text.openSettings}</Text>
        </Pressable>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{text.address}</Text>
        <Text style={styles.addressValue}>{addressSummary}</Text>
        {addressFields.deliveryInstructions ? (
          <Text style={styles.sectionSubtitle}>{addressFields.deliveryInstructions}</Text>
        ) : null}
        <Pressable style={styles.linkButton} onPress={() => navigation.navigate("AddressSettings")}>
          <Text style={styles.linkButtonText}>{text.editAddress}</Text>
        </Pressable>
      </View>

      <LoyaltySummaryCard
        title={text.loyalty}
        loyalty={loyalty}
        loading={false}
        error={loyaltyError}
        onRetry={() => loadAll()}
        city={marketSource}
      />

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>{text.support}</Text>
        <Text style={styles.sectionSubtitle}>{text.supportHint}</Text>
        <Pressable
          style={[styles.supportButton, !supportAvailability.configured && styles.supportButtonDisabled]}
          disabled={!supportAvailability.configured}
          onPress={() =>
            openSupportWhatsApp({
              city: marketSource,
            })
          }
        >
          <Ionicons name="logo-whatsapp" size={16} color="#FFFFFF" />
          <Text style={styles.supportButtonText}>
            {supportAvailability.configured ? text.support : text.supportUnavailable}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    backgroundColor: "#FFF8F2",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingText: {
    color: "#64748B",
    fontSize: 14,
    fontWeight: "700",
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    backgroundColor: "#FFF8F2",
    gap: 14,
  },
  heroCard: {
    backgroundColor: "#F97316",
    borderRadius: 24,
    padding: 18,
    gap: 8,
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 26,
    fontWeight: "900",
  },
  heroSubtitle: {
    color: "#FFF1E7",
    fontSize: 14,
    fontWeight: "600",
  },
  heroMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  heroMetaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFF7ED",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  heroMetaText: {
    color: "#9A3412",
    fontSize: 12,
    fontWeight: "800",
  },
  noticeCard: {
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: 16,
    padding: 14,
  },
  noticeText: {
    color: "#B91C1C",
    fontSize: 13,
    fontWeight: "700",
  },
  sectionCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#FED7AA",
    borderRadius: 18,
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "900",
  },
  sectionSubtitle: {
    color: "#64748B",
    fontSize: 13,
    lineHeight: 18,
  },
  routeTile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA",
    padding: 12,
  },
  routeIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  routeBody: {
    flex: 1,
    gap: 2,
  },
  routeTitle: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "800",
  },
  routeSubtitle: {
    color: "#64748B",
    fontSize: 12,
  },
  languageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  languagePill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#FDBA74",
    backgroundColor: "#FFF7ED",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  languagePillActive: {
    backgroundColor: "#F97316",
    borderColor: "#F97316",
  },
  languagePillDisabled: {
    opacity: 0.65,
  },
  languageText: {
    color: "#9A3412",
    fontSize: 13,
    fontWeight: "800",
  },
  languageTextActive: {
    color: "#FFFFFF",
  },
  linkButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "#0F172A",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  linkButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  addressValue: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "800",
  },
  supportButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#16A34A",
    borderRadius: 14,
    paddingVertical: 13,
  },
  supportButtonDisabled: {
    opacity: 0.55,
  },
  supportButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
});
