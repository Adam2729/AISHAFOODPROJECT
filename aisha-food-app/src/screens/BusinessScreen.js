import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppShell } from "../context/AppShellContext";
import { addToCart, getCart } from "../lib/cart";
import { apiGet } from "../lib/api";
import { getProductCategoryLabel, getProductSizeLabel, getUnavailableCopy } from "../lib/catalogPresentation";
import { readSavedCustomerAddress } from "../lib/customerUi";
import {
  CUSTOMER_RADIUS,
  CUSTOMER_SHADOW,
  CUSTOMER_THEME,
} from "../lib/customerTheme";
import { formatMoney, paymentMethodLabel } from "../lib/formatters";
import {
  getMenuItemImageSource,
  getRestaurantDisplayName,
  getRestaurantImageSource,
  groupMenuItemsByCategory,
  normalizeMenuItem,
  openRestaurantOrderWhatsApp,
} from "../lib/restaurants";

const SAVED_CUSTOMER_KEY = "aisha_saved_customer";
const ALL_CATEGORY_KEY = "__all__";

function MetaPill({ text }) {
  return (
    <View style={styles.metaPill}>
      <Text style={styles.metaPillText}>{text}</Text>
    </View>
  );
}

export default function BusinessScreen({ route, navigation }) {
  const { selectedCity: city, market } = useAppShell();
  const slug = String(route?.params?.slug || "").trim();
  const routeBusinessId = String(route?.params?.businessId || route?.params?.restaurantId || "").trim();
  const [restaurant, setRestaurant] = useState(null);
  const [sections, setSections] = useState([]);
  const [selectedCategoryKey, setSelectedCategoryKey] = useState(ALL_CATEGORY_KEY);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [addingItemId, setAddingItemId] = useState("");
  const [cartCount, setCartCount] = useState(0);

  const isSpanish = market.defaultLanguage === "es";
  const allCategoryLabel = isSpanish ? "Todo" : "Tout";
  const text = isSpanish
    ? {
        missingSlug: "Falta el slug del restaurante.",
        loadError: "No fue posible cargar este restaurante.",
        loading: "Cargando menu...",
        unavailable: "Restaurante no disponible",
        retry: "Reintentar",
        cart: "Carrito",
        addOk: "Articulo agregado al carrito.",
        invalidItem: "Este producto del menu es invalido.",
        addError: "No fue posible agregar este articulo.",
        addToCart: "Agregar",
        details: "Detalles",
        menuSearch: "Buscar en el menu",
        whatsapp: "Pedir por WhatsApp",
        emptyMenu: "No hay articulos disponibles en este menu.",
        etaPending: "ETA pendiente",
      }
    : {
        missingSlug: "Le slug du restaurant est manquant.",
        loadError: "Impossible de charger ce restaurant.",
        loading: "Chargement du menu...",
        unavailable: "Restaurant indisponible",
        retry: "Reessayer",
        cart: "Panier",
        addOk: "Article ajoute au panier.",
        invalidItem: "Cet article du menu est invalide.",
        addError: "Impossible d'ajouter cet article.",
        addToCart: "Ajouter",
        details: "Details",
        menuSearch: "Rechercher dans le menu",
        whatsapp: "Commander par WhatsApp",
        emptyMenu: "Aucun article disponible dans ce menu.",
        etaPending: "ETA en attente",
      };

  async function refreshCartCount() {
    const cart = await getCart();
    const itemCount = Array.isArray(cart?.items)
      ? cart.items.reduce((sum, item) => sum + Number(item.qty || 0), 0)
      : 0;
    setCartCount(itemCount);
  }

  async function loadRestaurant({ silent = false } = {}) {
    if (!slug && !routeBusinessId) {
      setError(text.missingSlug);
      setLoading(false);
      return;
    }

    if (!silent) setLoading(true);
    setError("");
    try {
      const response = slug
        ? await apiGet(`/api/public/restaurants/${encodeURIComponent(slug)}/menu`)
        : await apiGet(`/api/public/businesses/${encodeURIComponent(routeBusinessId)}/menu`);
      const business = response?.business || response || {};
      const rawMenu = Array.isArray(response?.menu)
        ? response.menu
        : Array.isArray(response?.products)
        ? response.products
        : [];
      const restaurantId = String(response?.restaurantId || business?.id || routeBusinessId || "");
      const restaurantName = getRestaurantDisplayName(
        {
          name: response?.name || business?.name,
          businessName: business?.businessName,
        },
        ""
      );
      const menu = rawMenu
        .map((item) =>
          normalizeMenuItem(item, {
            id: restaurantId,
            name: restaurantName,
            type: String(business?.type || response?.businessType || ""),
          })
        )
        .filter((item) => item.itemId && item.isAvailable !== false);
      const grouped = groupMenuItemsByCategory(menu, market);
      setRestaurant({
        restaurantId,
        name: restaurantName,
        slug: response?.slug || slug,
        type: String(business?.type || response?.businessType || ""),
        phone: response?.phone || business?.phone || null,
        whatsapp: response?.whatsapp || business?.whatsapp || null,
        logo: response?.logo || business?.logoUrl || "",
        zoneLabel: response?.zoneLabel || business?.zoneLabel || null,
        deliveryFee: Number(response?.deliveryFee || response?.delivery?.fee || 0),
        estimatedDeliveryMinutes: Number(
          response?.estimatedDeliveryMinutes ||
            response?.business?.eta?.maxMins ||
            response?.business?.eta?.minMins ||
            0
        ),
      });
      setSections(grouped);
      setSelectedCategoryKey((current) => {
        if (!current || current === ALL_CATEGORY_KEY) return ALL_CATEGORY_KEY;
        return grouped.some((section) => section.category === current) ? current : ALL_CATEGORY_KEY;
      });
    } catch (requestError) {
      setRestaurant(null);
      setSections([]);
      setError(requestError?.message || text.loadError);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadRestaurant().catch(() => null);
    refreshCartCount().catch(() => null);
  }, [slug, routeBusinessId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      refreshCartCount().catch(() => null);
    });
    return unsubscribe;
  }, [navigation]);

  const categories = useMemo(() => {
    return [{ key: ALL_CATEGORY_KEY, label: allCategoryLabel }].concat(
      sections.map((section) => ({
        key: section.category,
        label: section.category,
      }))
    );
  }, [allCategoryLabel, sections]);

  const filteredSections = useMemo(() => {
    const search = query.trim().toLowerCase();
    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          const matchesQuery =
            !search ||
            String(item?.name || "").toLowerCase().includes(search) ||
            String(item?.description || "").toLowerCase().includes(search) ||
            String(item?.displaySize || item?.sizeLabel || "").toLowerCase().includes(search);
          const matchesCategory =
            selectedCategoryKey === ALL_CATEGORY_KEY || section.category === selectedCategoryKey;
          return matchesQuery && matchesCategory;
        }),
      }))
      .filter((section) => section.items.length > 0);
  }, [query, sections, selectedCategoryKey]);

  async function handleAddToCart(item) {
    try {
      const itemId = String(item?.itemId || "").trim();
      if (!itemId) {
        throw new Error(text.invalidItem);
      }
      if (item?.isAvailable === false) {
        throw new Error(getUnavailableCopy(market));
      }
      setAddingItemId(itemId);
      await addToCart({
        businessId: String(restaurant?.restaurantId || route?.params?.restaurantId || ""),
        businessName: getRestaurantDisplayName(
          { name: restaurant?.name, businessName: route?.params?.restaurantName },
          "Restaurant"
        ),
        productId: itemId,
        name: String(item?.name || "Menu item"),
        price: Number(item?.price || 0),
        imageUrl: String(item?.imageUrl || item?.image || ""),
        businessType: String(restaurant?.type || item?.businessType || ""),
        category: getProductCategoryLabel(item),
        displaySize: getProductSizeLabel(item),
        quantityValue: item?.quantityValue ?? null,
        quantityUnit: item?.quantityUnit || "",
      });
      await refreshCartCount();
      Alert.alert(text.cart, text.addOk);
    } catch (requestError) {
      Alert.alert(text.cart, requestError?.message || text.addError);
    } finally {
      setAddingItemId("");
    }
  }

  async function handleWhatsApp() {
    const [cart, savedCustomerRaw] = await Promise.all([
      getCart(),
      AsyncStorage.getItem(SAVED_CUSTOMER_KEY),
    ]);
    let savedCustomer = null;
    try {
      savedCustomer = savedCustomerRaw ? JSON.parse(savedCustomerRaw) : null;
    } catch {
      savedCustomer = null;
    }
    const savedAddress = readSavedCustomerAddress(savedCustomer);
    const sameRestaurantCart =
      String(cart?.businessId || "").trim() &&
      String(cart?.businessId || "").trim() === String(restaurant?.restaurantId || "").trim();
    const cartItems = sameRestaurantCart ? cart?.items || [] : [];
    const totalAmount = cartItems.reduce(
      (sum, item) => sum + Number(item?.qty || 0) * Number(item?.price || 0),
      0
    );
    const preferredPaymentMethod = String(
      savedCustomer?.preferredPaymentMethod || savedCustomer?.paymentMethod || ""
    ).trim();
    await openRestaurantOrderWhatsApp({
      restaurantName: getRestaurantDisplayName(restaurant),
      whatsapp: restaurant?.whatsapp,
      phone: restaurant?.phone,
      items: cartItems,
      totalAmount,
      address: savedAddress.composedAddress || String(savedCustomer?.address || "").trim(),
      landmark: savedAddress.landmark,
      note: savedAddress.deliveryInstructions,
      paymentMethod: preferredPaymentMethod
        ? paymentMethodLabel(preferredPaymentMethod, market)
        : "",
      city,
    });
  }

  function openItemDetails(item, sizeLabel) {
    navigation.navigate("ItemDetails", {
      id: String(item?.itemId || item?.productId || item?.id || ""),
      item: {
        ...item,
        displaySize: sizeLabel,
        businessType: String(restaurant?.type || item?.businessType || ""),
        businessName: getRestaurantDisplayName(restaurant),
      },
      businessId: String(restaurant?.restaurantId || ""),
      businessName: getRestaurantDisplayName(restaurant),
      businessType: String(restaurant?.type || item?.businessType || ""),
    });
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      {loading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color="#F97316" />
          <Text style={styles.stateText}>{text.loading}</Text>
        </View>
      ) : error ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>{text.unavailable}</Text>
          <Text style={styles.stateText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={() => loadRestaurant()}>
            <Text style={styles.retryButtonText}>{text.retry}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filteredSections}
          keyExtractor={(item) => item.category}
          contentContainerStyle={styles.content}
          onRefresh={async () => {
            setRefreshing(true);
            await loadRestaurant({ silent: true });
            setRefreshing(false);
          }}
          refreshing={refreshing}
          ListHeaderComponent={
            <View style={styles.header}>
              <Image source={getRestaurantImageSource(restaurant)} style={styles.heroImage} />
              <View style={styles.heroCard}>
                <View style={styles.heroRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{getRestaurantDisplayName(restaurant)}</Text>
                    {!!restaurant?.zoneLabel ? (
                      <Text style={styles.subtitle}>{restaurant.zoneLabel}</Text>
                    ) : null}
                  </View>

                  <Pressable
                    style={styles.cartButton}
                    onPress={() => navigation.navigate("MainTabs", { screen: "Cart" })}
                  >
                    <Text style={styles.cartButtonText}>
                      {text.cart} ({cartCount})
                    </Text>
                  </Pressable>
                </View>

                <View style={styles.metaRow}>
                  <MetaPill
                    text={
                      Number(restaurant?.estimatedDeliveryMinutes || 0) > 0
                        ? `${Math.round(Number(restaurant?.estimatedDeliveryMinutes || 0))} min`
                        : text.etaPending
                    }
                  />
                  <MetaPill text={formatMoney(restaurant?.deliveryFee || 0, market)} />
                </View>

                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={text.menuSearch}
                  placeholderTextColor="#94A3B8"
                  style={styles.searchInput}
                />

                <FlatList
                  data={categories}
                  horizontal
                  keyExtractor={(item) => item.key}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.categoriesRow}
                  renderItem={({ item }) => {
                    const active = selectedCategoryKey === item.key;
                    return (
                      <Pressable
                        style={[styles.categoryChip, active && styles.categoryChipActive]}
                        onPress={() => setSelectedCategoryKey(item.key)}
                      >
                        <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  }}
                />

                <Pressable style={styles.whatsAppButton} onPress={handleWhatsApp}>
                  <Text style={styles.whatsAppButtonText}>{text.whatsapp}</Text>
                </Pressable>
              </View>
            </View>
          }
          renderItem={({ item: section }) => (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>{section.category}</Text>
              {section.items.map((item) => {
                const itemId = String(item?.itemId || "");
                const adding = addingItemId === itemId;
                const sizeLabel = getProductSizeLabel(item);
                const categoryLabel = getProductCategoryLabel(item);
                return (
                  <View key={itemId || item.name} style={styles.menuRow}>
                    <Pressable
                      style={styles.menuPreview}
                      onPress={() => openItemDetails(item, sizeLabel)}
                    >
                      <Image source={getMenuItemImageSource(item)} style={styles.menuImage} />
                      <View style={styles.menuContent}>
                        <Text style={styles.menuTitle}>{String(item?.name || "Menu item")}</Text>
                        {sizeLabel ? <Text style={styles.sizeLabel}>{sizeLabel}</Text> : null}
                        {item?.description ? (
                          <Text style={styles.menuDescription} numberOfLines={3}>
                            {String(item.description)}
                          </Text>
                        ) : null}
                        {categoryLabel && categoryLabel !== section.category ? (
                          <Text style={styles.categoryInline}>{categoryLabel}</Text>
                        ) : null}
                        <Text style={styles.menuPrice}>{formatMoney(item?.price || 0, market)}</Text>
                      </View>
                    </Pressable>
                    <View style={styles.menuActions}>
                      <Pressable
                        style={styles.detailsButton}
                        onPress={() => openItemDetails(item, sizeLabel)}
                      >
                        <Text style={styles.detailsButtonText}>{text.details}</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.addButton, adding && styles.addButtonDisabled]}
                        disabled={adding}
                        onPress={() => handleAddToCart(item)}
                      >
                        <Text style={styles.addButtonText}>{adding ? "..." : text.addToCart}</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.stateCard}>
              <Text style={styles.stateText}>{text.emptyMenu}</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: CUSTOMER_THEME.BG,
  },
  content: {
    padding: 16,
    paddingBottom: 24,
    gap: 14,
  },
  header: {
    gap: 14,
  },
  heroImage: {
    width: "100%",
    height: 220,
    borderRadius: CUSTOMER_RADIUS.large,
    backgroundColor: CUSTOMER_THEME.ORANGE_SOFT,
  },
  heroCard: {
    backgroundColor: CUSTOMER_THEME.SURFACE,
    borderWidth: 1,
    borderColor: CUSTOMER_THEME.ORANGE_BORDER,
    borderRadius: CUSTOMER_RADIUS.card,
    padding: 14,
    gap: 12,
    ...CUSTOMER_SHADOW,
  },
  heroRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  title: {
    color: CUSTOMER_THEME.INK,
    fontSize: 26,
    fontWeight: "900",
  },
  subtitle: {
    color: CUSTOMER_THEME.MUTED,
    fontSize: 14,
  },
  cartButton: {
    backgroundColor: CUSTOMER_THEME.INK,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cartButtonText: {
    color: CUSTOMER_THEME.SURFACE,
    fontWeight: "800",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaPill: {
    borderRadius: CUSTOMER_RADIUS.pill,
    backgroundColor: CUSTOMER_THEME.ORANGE_SOFT,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  metaPillText: {
    color: CUSTOMER_THEME.INK_SOFT,
    fontWeight: "700",
  },
  searchInput: {
    height: 48,
    borderWidth: 1,
    borderColor: CUSTOMER_THEME.BORDER,
    borderRadius: CUSTOMER_RADIUS.button,
    backgroundColor: CUSTOMER_THEME.SURFACE,
    paddingHorizontal: 14,
    color: CUSTOMER_THEME.INK,
  },
  categoriesRow: {
    gap: 8,
    paddingTop: 4,
  },
  categoryChip: {
    borderWidth: 1,
    borderColor: CUSTOMER_THEME.BORDER,
    borderRadius: CUSTOMER_RADIUS.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: CUSTOMER_THEME.SURFACE,
  },
  categoryChipActive: {
    borderColor: CUSTOMER_THEME.INK,
    backgroundColor: CUSTOMER_THEME.INK,
  },
  categoryChipText: {
    color: CUSTOMER_THEME.INK_SOFT,
    fontWeight: "700",
  },
  categoryChipTextActive: {
    color: CUSTOMER_THEME.SURFACE,
  },
  whatsAppButton: {
    backgroundColor: CUSTOMER_THEME.WHATSAPP,
    borderRadius: CUSTOMER_RADIUS.button,
    paddingVertical: 12,
    alignItems: "center",
  },
  whatsAppButtonText: {
    color: CUSTOMER_THEME.SURFACE,
    fontWeight: "900",
  },
  sectionCard: {
    backgroundColor: CUSTOMER_THEME.SURFACE,
    borderWidth: 1,
    borderColor: CUSTOMER_THEME.BORDER,
    borderRadius: CUSTOMER_RADIUS.card,
    padding: 14,
    gap: 10,
    marginTop: 14,
    ...CUSTOMER_SHADOW,
  },
  sectionTitle: {
    color: CUSTOMER_THEME.INK,
    fontSize: 18,
    fontWeight: "900",
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: CUSTOMER_THEME.BORDER,
  },
  menuPreview: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  menuImage: {
    width: 88,
    height: 88,
    borderRadius: 16,
    backgroundColor: CUSTOMER_THEME.ORANGE_SOFT,
  },
  menuContent: {
    flex: 1,
    gap: 4,
  },
  menuTitle: {
    color: CUSTOMER_THEME.INK,
    fontSize: 16,
    fontWeight: "800",
  },
  menuDescription: {
    color: CUSTOMER_THEME.MUTED,
    fontSize: 13,
    lineHeight: 18,
  },
  sizeLabel: {
    alignSelf: "flex-start",
    color: CUSTOMER_THEME.SUCCESS,
    fontSize: 12,
    fontWeight: "900",
    backgroundColor: CUSTOMER_THEME.SUCCESS_SOFT,
    borderRadius: CUSTOMER_RADIUS.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  categoryInline: {
    color: CUSTOMER_THEME.MUTED,
    fontSize: 12,
    fontWeight: "700",
  },
  menuPrice: {
    color: CUSTOMER_THEME.SUCCESS,
    fontWeight: "800",
  },
  menuActions: {
    width: 92,
    gap: 10,
  },
  detailsButton: {
    borderWidth: 1,
    borderColor: CUSTOMER_THEME.BORDER,
    borderRadius: CUSTOMER_RADIUS.button,
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: CUSTOMER_THEME.SURFACE_ALT,
  },
  detailsButtonText: {
    color: CUSTOMER_THEME.INK_SOFT,
    fontWeight: "800",
    textAlign: "center",
  },
  addButton: {
    backgroundColor: CUSTOMER_THEME.INK,
    borderRadius: CUSTOMER_RADIUS.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  addButtonDisabled: {
    backgroundColor: CUSTOMER_THEME.MUTED,
  },
  addButtonText: {
    color: CUSTOMER_THEME.SURFACE,
    fontWeight: "800",
  },
  stateCard: {
    flex: 1,
    backgroundColor: CUSTOMER_THEME.SURFACE,
    borderWidth: 1,
    borderColor: CUSTOMER_THEME.BORDER,
    borderRadius: CUSTOMER_RADIUS.card,
    margin: 16,
    padding: 20,
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
    ...CUSTOMER_SHADOW,
  },
  stateTitle: {
    color: CUSTOMER_THEME.INK,
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  stateText: {
    color: CUSTOMER_THEME.MUTED,
    fontSize: 14,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 4,
    backgroundColor: CUSTOMER_THEME.INK,
    borderRadius: CUSTOMER_RADIUS.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  retryButtonText: {
    color: CUSTOMER_THEME.SURFACE,
    fontWeight: "800",
  },
});
