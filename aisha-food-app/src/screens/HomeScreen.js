import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAppShell } from "../context/AppShellContext";
import { apiGet } from "../lib/api";
import { getCart } from "../lib/cart";
import {
  buildSavedAddressSummary,
  getCustomerUiCopy,
  getHomeSurfaceTabs,
  isShopBusinessType,
} from "../lib/customerUi";
import { getCurrentCoords } from "../lib/location";
import { openSupportWhatsApp } from "../lib/supportWhatsApp";
import {
  formatRestaurantDeliveryFee,
  formatRestaurantEta,
  getRestaurantDisplayName,
  getRestaurantImageSource,
  trackSponsoredRestaurantClick,
} from "../lib/restaurants";

const SAVED_CUSTOMER_KEY = "aisha_saved_customer";
const HOME_CACHE_KEY = "aisha_home_restaurants_cache_v2";
const BRAND_LOGO = require("../../assets/brand/brand.png");

function getRestaurantId(restaurant) {
  return String(
    restaurant?.restaurantId ||
      restaurant?.businessId ||
      restaurant?.id ||
      restaurant?._id ||
      restaurant?.slug ||
      ""
  ).trim();
}

function readSavedCustomer(rawValue) {
  try {
    return rawValue ? JSON.parse(rawValue) : {};
  } catch {
    return {};
  }
}

function getCustomerName(savedCustomer) {
  return String(savedCustomer?.customerName || "").trim();
}

function getCustomerInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.length ? parts.map((part) => part[0]?.toUpperCase() || "").join("") : "";
}

function normalizeRestaurantText(restaurant) {
  return `${String(restaurant?.name || "")} ${String(restaurant?.zoneLabel || "")}`.trim();
}

function matchesRestaurant(restaurant, regex) {
  return regex.test(normalizeRestaurantText(restaurant));
}

function takeUniqueRestaurants(rows, limit = 6) {
  const seen = new Set();
  const uniqueRows = [];

  rows.forEach((row, index) => {
    const id =
      getRestaurantId(row) ||
      `${String(row?.name || "restaurant").trim().toLowerCase()}-${index}`;
    if (seen.has(id)) return;
    seen.add(id);
    uniqueRows.push(row);
  });

  return uniqueRows.slice(0, limit);
}

function buildSections({ restaurants, shops, copy }) {
  const sponsored = restaurants.filter((row) => row?.sponsored);
  const nearby = restaurants.filter((row) => Number(row?.distanceKm || 999) <= 4);
  const quick = restaurants.filter((row) => Number(row?.estimatedDeliveryMinutes || 999) <= 35);
  const topRated = restaurants.filter((row) => Number(row?.averageRating || 0) >= 4.3);
  const streetFood = restaurants.filter((row) =>
    matchesRestaurant(row, /shawarma|burger|brochette|grill|sandwich|taco|kebab/i)
  );
  const desserts = restaurants.filter((row) =>
    matchesRestaurant(row, /dessert|glace|cake|cafe|coffee|jus|juice|drink|smoothie|tea/i)
  );

  return [
    { key: "for-you", title: copy.sections.forYou, items: takeUniqueRestaurants(restaurants) },
    { key: "nearby", title: copy.sections.nearby, items: takeUniqueRestaurants(nearby) },
    { key: "quick", title: copy.sections.quick, items: takeUniqueRestaurants(quick) },
    { key: "top-rated", title: copy.sections.topRated, items: takeUniqueRestaurants(topRated) },
    { key: "popular", title: copy.sections.popular, items: takeUniqueRestaurants(sponsored.concat(restaurants)) },
    {
      key: "malian",
      title: copy.sections.malian,
      items: takeUniqueRestaurants(
        restaurants.filter((row) => matchesRestaurant(row, /riz|mafe|yassa|afric|grill/i))
      ),
    },
    {
      key: "grill",
      title: copy.sections.grill,
      items: takeUniqueRestaurants(restaurants.filter((row) => matchesRestaurant(row, /grill|bbq|brochette/i))),
    },
    {
      key: "rice",
      title: copy.sections.rice,
      items: takeUniqueRestaurants(restaurants.filter((row) => matchesRestaurant(row, /riz|rice|sauce/i))),
    },
    {
      key: "fast-food",
      title: copy.sections.fastFood,
      items: takeUniqueRestaurants(
        restaurants.filter((row) => matchesRestaurant(row, /pizza|burger|taco|shawarma|sandwich|fast/i))
      ),
    },
    { key: "street-food", title: copy.sections.streetFood, items: takeUniqueRestaurants(streetFood) },
    { key: "desserts", title: copy.sections.desserts, items: takeUniqueRestaurants(desserts) },
    { key: "shops", title: copy.sections.shops, items: takeUniqueRestaurants(shops) },
    { key: "offers", title: copy.sections.offers, items: takeUniqueRestaurants(sponsored) },
  ].filter((section) => section.items.length);
}

function SectionHeader({ title, actionLabel, onPress }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {actionLabel && onPress ? (
        <Pressable onPress={onPress}>
          <Text style={styles.sectionAction}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function HomeScreen({ navigation }) {
  const { toggleDrawer, selectedCity: city, market } = useAppShell();
  const [restaurants, setRestaurants] = useState([]);
  const [savedCustomer, setSavedCustomer] = useState({});
  const [cartCount, setCartCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [networkNotice, setNetworkNotice] = useState("");
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationStatus, setLocationStatus] = useState("");
  const [surfaceTab, setSurfaceTab] = useState("food");

  const uiCopy = useMemo(() => getCustomerUiCopy(market), [market]);
  const homeTabs = useMemo(() => getHomeSurfaceTabs(market), [market]);
  const text = useMemo(
    () =>
      uiCopy.isSpanish
        ? {
            greeting: "Hola",
            heroPrompt: "Pide rapido en Bamako.",
            searchPlaceholder: "Que quieres comer hoy?",
            locationTitle: "Direccion de entrega",
            locationButton: "Usar mi ubicacion",
            addressButton: "Escribir direccion",
            cityButton: city?.name || "Cambiar ciudad",
            support: "Soporte WhatsApp",
            supportPrompt: "Necesito ayuda con mi pedido o mi direccion.",
            supportUnavailable: "Soporte no disponible",
            retry: "Reintentar",
            seeAll: "Ver todo",
            orders: "Pedidos",
            cart: "Carrito",
            homeError: "No fue posible cargar el inicio.",
            empty: "No hay negocios disponibles por ahora.",
            courierTitle: "Courier Bamako",
            courierBody: uiCopy.courierComingSoon,
            courierHelp: uiCopy.courierHelp,
            sections: {
              forYou: "Para ti",
              nearby: "Cerca de ti",
              quick: "Entrega rapida",
              topRated: "Mejor valorados",
              popular: "Popular en Bamako",
              malian: "Platos malienses",
              grill: "Parrilladas",
              rice: "Arroz y salsa",
              fastFood: "Fast Food",
              streetFood: "Street food",
              desserts: "Postres y bebidas",
              shops: "Tiendas cerca de ti",
              offers: "Ofertas del dia",
            },
          }
        : {
            greeting: "Bonjour",
            heroPrompt: "Commandez vite a Bamako.",
            searchPlaceholder: "Qu'est-ce que vous voulez manger ?",
            locationTitle: "Adresse de livraison",
            locationButton: "Utiliser ma localisation",
            addressButton: "Entrer l'adresse",
            cityButton: city?.name || "Changer de ville",
            support: "Support WhatsApp",
            supportPrompt: "J'ai besoin d'aide pour ma commande ou mon adresse.",
            supportUnavailable: "Support indisponible",
            retry: "Reessayer",
            seeAll: "Voir tout",
            orders: "Commandes",
            cart: "Panier",
            homeError: "Impossible de charger l'accueil.",
            empty: "Aucun commerce disponible pour le moment.",
            courierTitle: "Courier Bamako",
            courierBody: uiCopy.courierComingSoon,
            courierHelp: uiCopy.courierHelp,
            sections: {
              forYou: "Pour vous",
              nearby: "Pres de vous",
              quick: "Livraison rapide",
              topRated: "Mieux notes",
              popular: "Populaire a Bamako",
              malian: "Plats maliens",
              grill: "Grillades",
              rice: "Riz & Sauce",
              fastFood: "Fast Food",
              streetFood: "Street food",
              desserts: "Desserts & boissons",
              shops: "Boutiques pres de vous",
              offers: "Offres du jour",
            },
          },
    [city?.name, uiCopy]
  );

  const greetingText = useMemo(() => {
    const name = getCustomerName(savedCustomer);
    return name ? `${text.greeting}, ${name}` : `${text.greeting}!`;
  }, [savedCustomer, text.greeting]);

  const addressSummary = useMemo(
    () => buildSavedAddressSummary(savedCustomer, market),
    [savedCustomer, market]
  );

  const loadMeta = useCallback(async () => {
    const [cart, savedCustomerRaw] = await Promise.all([
      getCart(),
      AsyncStorage.getItem(SAVED_CUSTOMER_KEY),
    ]);
    setSavedCustomer(readSavedCustomer(savedCustomerRaw));
    setCartCount(
      Array.isArray(cart?.items) ? cart.items.reduce((sum, item) => sum + Number(item.qty || 0), 0) : 0
    );
  }, []);

  const loadRestaurants = useCallback(
    async ({ silent = false } = {}) => {
      let cachedRows = [];
      try {
        const cachedRaw = await AsyncStorage.getItem(HOME_CACHE_KEY);
        const cached = cachedRaw ? JSON.parse(cachedRaw) : null;
        cachedRows = Array.isArray(cached?.rows) ? cached.rows : [];
      } catch {
        cachedRows = [];
      }

      if (!silent) {
        if (cachedRows.length) {
          setRestaurants(cachedRows);
          setLoading(false);
        } else {
          setLoading(true);
        }
      }

      setError("");
      try {
        const response = await apiGet("/api/public/restaurants?limit=50");
        const rows = Array.isArray(response?.rows) ? response.rows : [];
        setRestaurants(rows);
        setNetworkNotice("");
        await AsyncStorage.setItem(
          HOME_CACHE_KEY,
          JSON.stringify({ rows, updatedAt: new Date().toISOString() })
        );
      } catch (requestError) {
        if (cachedRows.length) {
          setRestaurants(cachedRows);
          setNetworkNotice(uiCopy.weakConnection);
        } else {
          setRestaurants([]);
          setError(requestError?.message || text.homeError);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [text.homeError, uiCopy.weakConnection]
  );

  useEffect(() => {
    loadMeta().catch(() => null);
    loadRestaurants().catch(() => null);
  }, [loadMeta, loadRestaurants]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      loadMeta().catch(() => null);
      loadRestaurants({ silent: true }).catch(() => null);
    });
    return unsubscribe;
  }, [loadMeta, loadRestaurants, navigation]);

  const foodRestaurants = useMemo(
    () => restaurants.filter((row) => !isShopBusinessType(row?.type || row?.businessType)),
    [restaurants]
  );
  const shopRestaurants = useMemo(
    () => restaurants.filter((row) => isShopBusinessType(row?.type || row?.businessType)),
    [restaurants]
  );
  const activeRestaurants = useMemo(() => {
    if (surfaceTab === "shops") return shopRestaurants.length ? shopRestaurants : restaurants;
    if (surfaceTab === "courier") return [];
    return foodRestaurants.length ? foodRestaurants : restaurants;
  }, [foodRestaurants, restaurants, shopRestaurants, surfaceTab]);
  const featuredRestaurant = useMemo(
    () => activeRestaurants.find((row) => row?.sponsored) || activeRestaurants[0] || null,
    [activeRestaurants]
  );
  const sections = useMemo(
    () => {
      if (surfaceTab === "shops") {
        return [
          {
            key: "shops",
            title: text.sections.shops,
            items: (shopRestaurants.length ? shopRestaurants : restaurants).slice(0, 8),
          },
        ];
      }
      return buildSections({
        restaurants: foodRestaurants.length ? foodRestaurants : restaurants,
        shops: shopRestaurants,
        copy: text,
      });
    },
    [foodRestaurants, restaurants, shopRestaurants, surfaceTab, text]
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([loadMeta(), loadRestaurants({ silent: true })]);
    setRefreshing(false);
  }, [loadMeta, loadRestaurants]);

  const openRestaurant = useCallback(
    (restaurant) => {
      trackSponsoredRestaurantClick(restaurant).catch(() => null);
      navigation.navigate("Business", {
        restaurantId:
          restaurant?.restaurantId || restaurant?.businessId || restaurant?.id || restaurant?._id,
        businessId:
          restaurant?.businessId ||
          restaurant?.restaurantId ||
          restaurant?.id ||
          restaurant?._id,
        restaurantName: getRestaurantDisplayName(restaurant),
        slug: restaurant?.slug,
        source: "home",
      });
    },
    [navigation]
  );

  async function useGpsLocation() {
    setLocationLoading(true);
    setLocationStatus("");
    const result = await getCurrentCoords();
    setLocationLoading(false);

    if (!result.ok) {
      setLocationStatus(uiCopy.locationUnavailable);
      return;
    }

    const nextSavedCustomer = {
      ...savedCustomer,
      lat: result.coords.lat,
      lng: result.coords.lng,
      updatedAt: new Date().toISOString(),
    };
    setSavedCustomer(nextSavedCustomer);
    setLocationStatus(uiCopy.locationCaptured);
    await AsyncStorage.setItem(SAVED_CUSTOMER_KEY, JSON.stringify(nextSavedCustomer)).catch(() => null);
  }

  function renderRestaurantCard(restaurant, reactKey) {
    return (
      <Pressable
        key={reactKey}
        style={styles.card}
        onPress={() => openRestaurant(restaurant)}
      >
        <Image source={getRestaurantImageSource(restaurant)} style={styles.cardImage} />
        <Text style={styles.cardTitle} numberOfLines={1}>
          {getRestaurantDisplayName(restaurant)}
        </Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {String(restaurant?.zoneLabel || city?.name || "Bamako")}
        </Text>
        <View style={styles.cardFooter}>
          <Text style={styles.cardMetric}>{formatRestaurantEta(restaurant?.estimatedDeliveryMinutes, market)}</Text>
          <Text style={styles.cardMetric}>{formatRestaurantDeliveryFee(restaurant?.deliveryFee, market)}</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F97316" />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroHeader}>
            <View style={styles.brand}>
              <Image source={BRAND_LOGO} style={styles.logo} resizeMode="contain" />
              <Text style={styles.brandText}>OranjeEats</Text>
            </View>
            <Pressable style={styles.heroIcon} onPress={toggleDrawer}>
              <Ionicons name="menu-outline" size={22} color="#FFFFFF" />
            </Pressable>
          </View>
          <View style={styles.heroBody}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>{greetingText}</Text>
              <Text style={styles.heroSubtitle}>{text.heroPrompt}</Text>
            </View>
            <View style={styles.avatar}>
              {getCustomerInitials(getCustomerName(savedCustomer)) ? (
                <Text style={styles.avatarText}>{getCustomerInitials(getCustomerName(savedCustomer))}</Text>
              ) : (
                <Ionicons name="person-outline" size={22} color="#FFFFFF" />
              )}
            </View>
          </View>
          <View style={styles.tabs}>
            {homeTabs.map((tab) => {
              const active = tab.key === surfaceTab;
              return (
                <Pressable
                  key={tab.key}
                  style={[styles.tab, active && styles.tabActive]}
                  onPress={() => setSurfaceTab(tab.key)}
                >
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable style={styles.searchBar} onPress={() => navigation.navigate("Search")}>
          <Ionicons name="search-outline" size={20} color="#94A3B8" />
          <Text style={styles.searchText}>{text.searchPlaceholder}</Text>
        </Pressable>

        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>{text.locationTitle}</Text>
          <Text style={styles.infoTitle}>{addressSummary}</Text>
          <Text style={styles.infoBody}>{city?.name || text.cityButton}</Text>
          <View style={styles.buttonRow}>
            <Pressable
              style={[styles.primaryButton, locationLoading && styles.buttonDisabled]}
              onPress={useGpsLocation}
              disabled={locationLoading}
            >
              <Text style={styles.primaryButtonText}>{locationLoading ? "..." : text.locationButton}</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate("Checkout")}>
              <Text style={styles.secondaryButtonText}>{text.addressButton}</Text>
            </Pressable>
          </View>
          {locationStatus ? <Text style={styles.infoHint}>{locationStatus}</Text> : null}
        </View>

        <View style={styles.quickRow}>
          <Pressable style={styles.quickButton} onPress={() => navigation.navigate("Orders")}>
            <View style={styles.quickIconCircle}>
              <Ionicons name="receipt-outline" size={18} color="#F97316" />
            </View>
            <Text style={styles.quickText}>{text.orders}</Text>
          </Pressable>
          <Pressable style={styles.quickButton} onPress={() => navigation.navigate("Cart")}>
            <View style={styles.quickIconCircle}>
              <Ionicons name="cart-outline" size={18} color="#F97316" />
            </View>
            <Text style={styles.quickText}>
              {text.cart} ({cartCount})
            </Text>
          </Pressable>
          <Pressable
            style={styles.quickButton}
            disabled={!market.supportWhatsAppConfigured}
            onPress={() =>
              openSupportWhatsApp({
                city,
                defaultText: text.supportPrompt,
              })
            }
          >
            <View style={[styles.quickIconCircle, styles.quickWhatsAppCircle]}>
              <Ionicons name="logo-whatsapp" size={18} color="#16A34A" />
            </View>
            <Text style={styles.quickText}>
              {market.supportWhatsAppConfigured ? text.support : text.supportUnavailable}
            </Text>
          </Pressable>
        </View>

        {networkNotice ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{networkNotice}</Text>
          </View>
        ) : null}

        {featuredRestaurant && surfaceTab !== "courier" ? (
          <Pressable style={styles.banner} onPress={() => openRestaurant(featuredRestaurant)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>{text.sections.offers}</Text>
              <Text style={styles.bannerBody}>{text.searchPlaceholder}</Text>
            </View>
            <Image source={getRestaurantImageSource(featuredRestaurant)} style={styles.bannerImage} />
          </Pressable>
        ) : null}

        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color="#F97316" />
            <Text style={styles.stateText}>...</Text>
          </View>
        ) : error ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateText}>{error || text.homeError}</Text>
            <Pressable style={styles.primaryButton} onPress={() => loadRestaurants()}>
              <Text style={styles.primaryButtonText}>{text.retry}</Text>
            </Pressable>
          </View>
        ) : surfaceTab === "courier" ? (
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>{text.courierTitle}</Text>
            <Text style={styles.infoBody}>{text.courierBody}</Text>
            <Text style={styles.infoHint}>{text.courierHelp}</Text>
            <Pressable
              style={styles.primaryButton}
              disabled={!market.supportWhatsAppConfigured}
              onPress={() =>
                openSupportWhatsApp({
                  city,
                  defaultText: text.supportPrompt,
                })
              }
            >
              <Text style={styles.primaryButtonText}>
                {market.supportWhatsAppConfigured ? text.support : text.supportUnavailable}
              </Text>
            </Pressable>
          </View>
        ) : activeRestaurants.length === 0 ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateText}>{text.empty}</Text>
          </View>
        ) : (
          sections.map((section) => (
            <View key={section.key} style={{ gap: 10 }}>
              <SectionHeader
                title={section.title}
                actionLabel={text.seeAll}
                onPress={() => navigation.navigate("Search")}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sectionRow}>
                {section.items.map((restaurant, index) =>
                  renderRestaurantCard(
                    restaurant,
                    `${section.key}-${getRestaurantId(restaurant) || "restaurant"}-${index}`
                  )
                )}
              </ScrollView>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#FFF8F2" },
  content: { padding: 16, paddingBottom: 28, gap: 14 },
  hero: { backgroundColor: "#F97316", borderRadius: 24, padding: 18, gap: 12 },
  heroHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 34, height: 34 },
  brandText: { color: "#FFFFFF", fontSize: 18, fontWeight: "900" },
  heroIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  heroBody: { flexDirection: "row", alignItems: "center", gap: 12 },
  heroTitle: { color: "#FFFFFF", fontSize: 28, fontWeight: "900" },
  heroSubtitle: { color: "#FFF1E7", fontSize: 14, fontWeight: "600" },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#FFFFFF", fontWeight: "900", fontSize: 16 },
  tabs: { flexDirection: "row", gap: 10 },
  tab: { flex: 1, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.14)", paddingVertical: 11, alignItems: "center" },
  tabActive: { backgroundColor: "#FFFFFF" },
  tabText: { color: "#FFF7ED", fontWeight: "800" },
  tabTextActive: { color: "#9A3412" },
  searchBar: { backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: "#FED7AA", paddingHorizontal: 14, paddingVertical: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  searchText: { color: "#94A3B8", fontSize: 15, fontWeight: "600" },
  infoCard: { backgroundColor: "#FFFFFF", borderRadius: 18, borderWidth: 1, borderColor: "#FED7AA", padding: 14, gap: 8 },
  infoLabel: { color: "#C2410C", fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  infoTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900" },
  infoBody: { color: "#475569", fontSize: 14 },
  infoHint: { color: "#64748B", fontSize: 12, lineHeight: 18 },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  primaryButton: { backgroundColor: "#F97316", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, alignItems: "center" },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "800" },
  secondaryButton: { backgroundColor: "#FFF7ED", borderRadius: 12, borderWidth: 1, borderColor: "#FDBA74", paddingHorizontal: 14, paddingVertical: 11, alignItems: "center" },
  secondaryButtonText: { color: "#9A3412", fontWeight: "800" },
  buttonDisabled: { opacity: 0.65 },
  quickRow: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  quickButton: { width: 100, alignItems: "center", gap: 8 },
  quickIconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#FED7AA",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#F97316",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 3,
  },
  quickWhatsAppCircle: {
    borderColor: "#BBF7D0",
    backgroundColor: "#F0FDF4",
  },
  quickText: { color: "#475569", fontSize: 12, fontWeight: "800", textAlign: "center", lineHeight: 16 },
  notice: { backgroundColor: "#FFF7ED", borderWidth: 1, borderColor: "#FDBA74", borderRadius: 16, padding: 14 },
  noticeText: { color: "#9A3412", fontWeight: "700" },
  banner: { backgroundColor: "#FF8A1A", borderRadius: 20, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  bannerTitle: { color: "#FFFFFF", fontSize: 22, fontWeight: "900" },
  bannerBody: { color: "#FFF2E6", fontSize: 13, lineHeight: 18, fontWeight: "600" },
  bannerImage: { width: 108, height: 88, borderRadius: 16, backgroundColor: "#FDBA74" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900" },
  sectionAction: { color: "#9A3412", fontSize: 13, fontWeight: "800" },
  sectionRow: { gap: 12, paddingRight: 8 },
  card: { width: 220, backgroundColor: "#FFFFFF", borderRadius: 18, borderWidth: 1, borderColor: "#FED7AA", overflow: "hidden" },
  cardImage: { width: "100%", height: 116, backgroundColor: "#FED7AA" },
  cardTitle: { color: "#0F172A", fontSize: 15, fontWeight: "900", paddingHorizontal: 12, paddingTop: 12 },
  cardMeta: { color: "#64748B", fontSize: 12, paddingHorizontal: 12, paddingTop: 4 },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", gap: 8, padding: 12 },
  cardMetric: { color: "#334155", fontSize: 12, fontWeight: "800" },
  stateCard: { backgroundColor: "#FFFFFF", borderRadius: 18, borderWidth: 1, borderColor: "#FED7AA", padding: 18, gap: 10, alignItems: "center" },
  stateText: { color: "#64748B", fontSize: 14, textAlign: "center", lineHeight: 20 },
});
