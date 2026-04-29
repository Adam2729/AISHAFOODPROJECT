import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppShell } from "../context/AppShellContext";
import { getLanguageOptions, normalizePreferredLanguage } from "../lib/marketConfig";
import { navigationRef } from "../lib/navigation";
import { openSupportWhatsApp } from "../lib/supportWhatsApp";

const SAVED_CUSTOMER_KEY = "aisha_saved_customer";
const DRAWER_WIDTH = 312;

function readSavedCustomer(rawValue) {
  try {
    return rawValue ? JSON.parse(rawValue) : {};
  } catch {
    return {};
  }
}

function normalizePhone(value) {
  return String(value || "").replace(/\D+/g, "").trim();
}

function DrawerItem({ icon, title, subtitle, onPress, accent = "#0F172A" }) {
  return (
    <Pressable style={styles.item} onPress={onPress}>
      <View style={styles.itemIcon}>
        <Ionicons name={icon} size={18} color={accent} />
      </View>
      <View style={styles.itemBody}>
        <Text style={styles.itemTitle}>{title}</Text>
        {subtitle ? <Text style={styles.itemSubtitle}>{subtitle}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
    </Pressable>
  );
}

export default function AppDrawer() {
  const insets = useSafeAreaInsets();
  const {
    drawerOpen,
    closeDrawer,
    market,
    selectedCity,
    setPreferredLanguage,
  } = useAppShell();
  const [mounted, setMounted] = useState(drawerOpen);
  const [savedCustomer, setSavedCustomer] = useState({});
  const [languageSaving, setLanguageSaving] = useState("");
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  const isSpanish = market.defaultLanguage === "es";
  const text = isSpanish
    ? {
        account: "Mi cuenta",
        subtitle: "Navegacion, idioma y soporte en un solo menu.",
        guest: "Cliente AishaFood",
        home: "Inicio",
        homeHint: "Explorar restaurantes y ofertas",
        search: "Buscar",
        searchHint: "Buscar restaurantes y productos",
        cart: "Carrito",
        cartHint: "Revisar articulos y checkout",
        orders: "Pedidos",
        ordersHint: "Seguimiento y reordenar",
        profile: "Ajustes del perfil",
        profileHint: "Nombre, gustos y preferencias",
        address: "Direccion guardada",
        addressHint: "Entrega, barrio y referencia",
        city: "Cambiar ciudad",
        cityHint: "Actualizar el mercado activo",
        language: "Idioma",
        support: "Soporte WhatsApp",
        supportHint: "Ayuda con pedidos y direccion",
        supportUnavailable: "Soporte no disponible",
      }
    : {
        account: "Mon compte",
        subtitle: "Navigation, langue et support dans un seul menu.",
        guest: "Client AishaFood",
        home: "Accueil",
        homeHint: "Explorer restaurants et offres",
        search: "Recherche",
        searchHint: "Chercher restaurants et produits",
        cart: "Panier",
        cartHint: "Verifier articles et checkout",
        orders: "Commandes",
        ordersHint: "Suivi et nouvelle commande",
        profile: "Parametres du profil",
        profileHint: "Nom, gouts et preferences",
        address: "Adresse enregistree",
        addressHint: "Livraison, quartier et repere",
        city: "Changer de ville",
        cityHint: "Mettre a jour le marche actif",
        language: "Langue",
        support: "Support WhatsApp",
        supportHint: "Aide pour commandes et adresse",
        supportUnavailable: "Support indisponible",
      };

  const languageOptions = useMemo(() => getLanguageOptions(selectedCity || market), [market, selectedCity]);
  const currentLanguage = normalizePreferredLanguage(
    selectedCity?.defaultLanguage || market.defaultLanguage,
    selectedCity || market
  );
  const displayName = String(savedCustomer?.customerName || "").trim() || text.guest;
  const displayPhone = normalizePhone(savedCustomer?.phone || "");

  useEffect(() => {
    if (drawerOpen) {
      setMounted(true);
      AsyncStorage.getItem(SAVED_CUSTOMER_KEY)
        .then((raw) => setSavedCustomer(readSavedCustomer(raw)))
        .catch(() => null);
      Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        toValue: -DRAWER_WIDTH,
        duration: 190,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [drawerOpen, overlayOpacity, translateX]);

  async function navigateTo(routeName, params) {
    closeDrawer();
    if (navigationRef.isReady()) {
      navigationRef.navigate(routeName, params);
    }
  }

  async function onChangeLanguage(nextLanguage) {
    if (languageSaving) return;
    setLanguageSaving(nextLanguage);
    try {
      await setPreferredLanguage(nextLanguage);
      closeDrawer();
    } finally {
      setLanguageSaving("");
    }
  }

  if (!mounted) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeDrawer} />
      </Animated.View>
      <Animated.View
        style={[
          styles.drawer,
          {
            paddingTop: insets.top + 12,
            paddingBottom: Math.max(insets.bottom, 18),
            transform: [{ translateX }],
          },
        ]}
      >
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>{displayName}</Text>
              <Text style={styles.headerSubtitle}>{displayPhone || text.subtitle}</Text>
            </View>
            <Pressable style={styles.closeButton} onPress={closeDrawer}>
              <Ionicons name="close-outline" size={22} color="#FFFFFF" />
            </Pressable>
          </View>

          <View style={styles.metaCard}>
            <Text style={styles.metaLabel}>{text.account}</Text>
            <Text style={styles.metaValue}>{String(selectedCity?.name || "-")}</Text>
          </View>

          <View style={styles.section}>
            <DrawerItem
              icon="home-outline"
              title={text.home}
              subtitle={text.homeHint}
              onPress={() => navigateTo("MainTabs", { screen: "Home" })}
            />
            <DrawerItem
              icon="search-outline"
              title={text.search}
              subtitle={text.searchHint}
              onPress={() => navigateTo("MainTabs", { screen: "Search" })}
            />
            <DrawerItem
              icon="cart-outline"
              title={text.cart}
              subtitle={text.cartHint}
              onPress={() => navigateTo("MainTabs", { screen: "Cart" })}
            />
            <DrawerItem
              icon="receipt-outline"
              title={text.orders}
              subtitle={text.ordersHint}
              onPress={() => navigateTo("MainTabs", { screen: "Orders" })}
            />
          </View>

          <View style={styles.section}>
            <DrawerItem
              icon="person-outline"
              title={text.account}
              subtitle={text.profileHint}
              onPress={() => navigateTo("MainTabs", { screen: "Profile" })}
            />
            <DrawerItem
              icon="settings-outline"
              title={text.profile}
              subtitle={text.profileHint}
              onPress={() => navigateTo("ProfileSettings")}
            />
            <DrawerItem
              icon="home-outline"
              title={text.address}
              subtitle={text.addressHint}
              onPress={() => navigateTo("AddressSettings")}
            />
            <DrawerItem
              icon="navigate-outline"
              title={text.city}
              subtitle={text.cityHint}
              onPress={() => navigateTo("CitySelect")}
            />
          </View>

          <View style={styles.languageCard}>
            <Text style={styles.languageTitle}>{text.language}</Text>
            <View style={styles.languageRow}>
              {languageOptions.map((option) => {
                const active = currentLanguage === option.value;
                const busy = languageSaving === option.value;
                return (
                  <Pressable
                    key={option.value}
                    style={[styles.languagePill, active && styles.languagePillActive]}
                    disabled={Boolean(languageSaving)}
                    onPress={() => onChangeLanguage(option.value)}
                  >
                    <Text style={[styles.languageText, active && styles.languageTextActive]}>
                      {busy ? "..." : option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Pressable
            style={[styles.supportButton, !market.supportWhatsAppConfigured && styles.supportButtonDisabled]}
            disabled={!market.supportWhatsAppConfigured}
            onPress={async () => {
              closeDrawer();
              await openSupportWhatsApp({ city: selectedCity || market });
            }}
          >
            <Ionicons name="logo-whatsapp" size={18} color="#FFFFFF" />
            <View style={{ flex: 1 }}>
              <Text style={styles.supportTitle}>
                {market.supportWhatsAppConfigured ? text.support : text.supportUnavailable}
              </Text>
              <Text style={styles.supportSubtitle}>{text.supportHint}</Text>
            </View>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.28)",
  },
  drawer: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: "#FFF8F2",
    borderTopRightRadius: 28,
    borderBottomRightRadius: 28,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowOffset: { width: 8, height: 0 },
    shadowRadius: 20,
    elevation: 14,
  },
  content: {
    paddingHorizontal: 14,
    gap: 14,
  },
  header: {
    backgroundColor: "#F97316",
    borderRadius: 24,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
  },
  headerSubtitle: {
    marginTop: 4,
    color: "#FFF1E7",
    fontSize: 13,
    lineHeight: 18,
    maxWidth: 210,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  metaCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#FED7AA",
    borderRadius: 16,
    padding: 12,
    gap: 4,
  },
  metaLabel: {
    color: "#9A3412",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  metaValue: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "800",
  },
  section: {
    gap: 8,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#FED7AA",
    borderRadius: 16,
    padding: 12,
  },
  itemIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#FFF7ED",
    alignItems: "center",
    justifyContent: "center",
  },
  itemBody: {
    flex: 1,
  },
  itemTitle: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "800",
  },
  itemSubtitle: {
    color: "#64748B",
    fontSize: 12,
    marginTop: 2,
  },
  languageCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#FED7AA",
    borderRadius: 18,
    padding: 12,
    gap: 10,
  },
  languageTitle: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "900",
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
  languageText: {
    color: "#9A3412",
    fontSize: 12,
    fontWeight: "800",
  },
  languageTextActive: {
    color: "#FFFFFF",
  },
  supportButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#16A34A",
    borderRadius: 18,
    padding: 14,
  },
  supportButtonDisabled: {
    opacity: 0.55,
  },
  supportTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  supportSubtitle: {
    color: "#DCFCE7",
    fontSize: 12,
    marginTop: 2,
  },
});
