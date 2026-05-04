import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Image, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useAppShell } from "../context/AppShellContext";
import {
  addToCart,
  clearCart,
  getCart,
  getCartSubtotal,
  removeFromCart,
  saveCart,
  updateCartQty,
} from "../lib/cart";
import { apiGet, apiPost } from "../lib/api";
import { getProductSizeLabel, getReorderRemovalMessage } from "../lib/catalogPresentation";
import {
  CUSTOMER_RADIUS,
  CUSTOMER_SHADOW,
  CUSTOMER_THEME,
} from "../lib/customerTheme";
import { getCustomerUiCopy, readSavedCustomerAddress } from "../lib/customerUi";
import { paymentMethodLabel } from "../lib/formatters";
import formatPrice from "../lib/formatPrice";
import { getMenuItemImageSource, openRestaurantOrderWhatsApp } from "../lib/restaurants";
import { getOrCreateSessionId } from "../lib/sessionId";

const SAVED_CUSTOMER_KEY = "aisha_saved_customer";

function normalizeSource(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "home" ||
    normalized === "search" ||
    normalized === "favorites" ||
    normalized === "buy_again" ||
    normalized === "reorder"
  ) {
    return normalized;
  }
  return "unknown";
}

function getSuggestionReason(item, isSpanish) {
  const direct = isSpanish
    ? String(item?.reasonEs || item?.reason || "").trim()
    : String(item?.reasonFr || item?.reason || "").trim();
  return direct || (isSpanish ? "Sugerencia para completar tu pedido." : "Suggestion pour completer ta commande.");
}

export default function CartScreen({ navigation, route }) {
  const { selectedCity: city, market } = useAppShell();
  const [cart, setCart] = useState({ businessId: "", businessName: "", items: [] });
  const [businessContact, setBusinessContact] = useState({ whatsapp: "", phone: "" });
  const [removedItems, setRemovedItems] = useState([]);
  const [reorderBusinessType, setReorderBusinessType] = useState("");
  const [alternatives, setAlternatives] = useState([]);
  const [alternativesFor, setAlternativesFor] = useState("");
  const [alternativesLoadingId, setAlternativesLoadingId] = useState("");
  const [upsellLoading, setUpsellLoading] = useState(false);
  const [upsellSuggestions, setUpsellSuggestions] = useState([]);
  const [upsellAddingId, setUpsellAddingId] = useState("");
  const uiCopy = useMemo(() => getCustomerUiCopy(market), [market]);
  const isSpanish = market.defaultLanguage === "es";
  const text = isSpanish
    ? {
        title: "Tu carrito",
        restaurant: "Restaurante",
        empty: "Todavia no has agregado productos.",
        suggestions: "Sugerencias",
        loadingSuggestions: "cargando...",
        noSuggestions: "No hay sugerencias para este carrito ahora.",
        subtotal: "Subtotal",
        deliveryNote: "La tarifa de entrega se confirma en checkout despues de validar la direccion.",
        offlineNote: uiCopy.savedOffline,
        continue: "Continuar pedido",
        clear: "Vaciar carrito",
        whatsapp: "Pedir por WhatsApp",
        remove: "Quitar",
        removedTitle: "Articulos no disponibles para repetir",
        alternatives: "Ver alternativas",
        alternativesFor: "Alternativas para",
        close: "Cerrar",
        add: "Agregar",
        invalidAlternative: "Producto",
      }
    : {
        title: "Ton panier",
        restaurant: "Restaurant",
        empty: "Tu n'as pas encore ajoute d'articles.",
        suggestions: "Suggestions",
        loadingSuggestions: "chargement...",
        noSuggestions: "Aucune suggestion pour ce panier pour le moment.",
        subtotal: "Sous-total",
        deliveryNote: "Les frais de livraison sont confirmes au checkout apres validation de l'adresse.",
        offlineNote: uiCopy.savedOffline,
        continue: "Continuer",
        clear: "Vider le panier",
        whatsapp: "Commander par WhatsApp",
        remove: "Retirer",
        removedTitle: "Articles indisponibles pour recommander",
        alternatives: "Voir les alternatives",
        alternativesFor: "Alternatives pour",
        close: "Fermer",
        add: "Ajouter",
        invalidAlternative: "Article",
      };

  const funnelSource = normalizeSource(route?.params?.source);
  const hasItems = (cart.items || []).length > 0;

  async function load() {
    const data = await getCart();
    await syncCartAvailability(data);
  }

  async function syncCartAvailability(data) {
    const currentCart = data || (await getCart());
    const items = Array.isArray(currentCart?.items) ? currentCart.items : [];
    const businessId = String(currentCart?.businessId || "").trim();
    if (!businessId || !items.length) {
      setBusinessContact({ whatsapp: "", phone: "" });
      setCart(currentCart);
      return currentCart;
    }

    try {
      const response = await apiGet(`/api/public/businesses/${encodeURIComponent(businessId)}/menu`);
      const products = Array.isArray(response?.products) ? response.products : [];
      const liveById = new Map(
        products.map((product) => [String(product.id || product._id || product.productId || ""), product])
      );
      const keptItems = [];
      const removed = [];
      for (const item of items) {
        const productId = String(item?.productId || "");
        const live = liveById.get(productId);
        if (!live) {
          removed.push({
            ...item,
            reasonCode: "unavailable",
          });
          continue;
        }
        keptItems.push({
          ...item,
          name: String(live.name || item.name || ""),
          price: Number(live.price || item.price || 0),
          imageUrl: String(live.imageUrl || item.imageUrl || item.image || ""),
          image: String(live.imageUrl || item.image || item.imageUrl || ""),
          category: String(live.category || item.category || ""),
          displaySize: String(live.displaySize || item.displaySize || ""),
          quantityValue: live.quantityValue ?? item.quantityValue ?? null,
          quantityUnit: String(live.quantityUnit || item.quantityUnit || ""),
        });
      }
      const nextCart = {
        ...currentCart,
        businessType: String(response?.business?.type || currentCart.businessType || ""),
        items: keptItems,
      };
      setBusinessContact({
        whatsapp: String(response?.whatsapp || response?.business?.whatsapp || "").trim(),
        phone: String(response?.phone || response?.business?.phone || "").trim(),
      });
      if (!keptItems.length) {
        nextCart.businessId = "";
        nextCart.businessName = "";
        nextCart.businessType = "";
      }
      if (removed.length) {
        await saveCart(nextCart);
        setRemovedItems(
          removed.map((item) => ({
            ...item,
            reason: getReorderRemovalMessage(item.reasonCode, market),
          }))
        );
      }
      setCart(nextCart);
      return nextCart;
    } catch {
      setBusinessContact({ whatsapp: "", phone: "" });
      setCart(currentCart);
      return currentCart;
    }
  }

  async function emitFunnelEvent(event, meta = {}) {
    try {
      const sessionId = await getOrCreateSessionId();
      apiPost("/api/public/funnel/event", {
        event,
        businessId: String(cart.businessId || ""),
        source: funnelSource,
        sessionId,
        meta,
      }).catch(() => null);
    } catch {
      // Telemetry must never block cart UX.
    }
  }

  function cartMetrics(nextCart) {
    const cartItemsCount = (nextCart.items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0);
    const cartSubtotal = (nextCart.items || []).reduce(
      (sum, item) => sum + Number(item.qty || 0) * Number(item.price || 0),
      0
    );
    return { cartItemsCount, cartSubtotal };
  }

  useEffect(() => {
    const unsub = navigation.addListener("focus", load);
    return unsub;
  }, [navigation]);

  useEffect(() => {
    const draft = route?.params?.reorderDraft;
    if (!draft) return;

    (async () => {
      const normalizedDraft = {
        businessId: String(draft.businessId || ""),
        businessName: String(draft.businessName || ""),
        items: Array.isArray(draft.items)
          ? draft.items.map((item) => ({
              productId: String(item.productId || ""),
              name: String(item.name || ""),
              price: Number(item.unitPrice || 0),
              qty: Math.max(1, Math.min(50, Number(item.qty || 1))),
              category: String(item.category || ""),
              displaySize: String(item.displaySize || ""),
              quantityValue: item.quantityValue ?? null,
              quantityUnit: String(item.quantityUnit || ""),
            }))
          : [],
      };
      await saveCart(normalizedDraft);
      setCart(normalizedDraft);
      setRemovedItems(Array.isArray(draft.removedItems) ? draft.removedItems : []);
      setReorderBusinessType(String(draft.businessType || ""));
      setAlternatives([]);
      setAlternativesFor("");
      navigation.setParams({ reorderDraft: undefined });
    })();
  }, [route?.params?.reorderDraft, navigation]);

  const cartSignature = useMemo(
    () =>
      JSON.stringify(
        (cart.items || []).map((item) => ({
          productId: String(item.productId || ""),
          qty: Number(item.qty || 0),
        }))
      ),
    [cart.items]
  );

  useEffect(() => {
    if (!cart.businessId || !hasItems) {
      setUpsellSuggestions([]);
      return undefined;
    }

    const timer = setTimeout(async () => {
      setUpsellLoading(true);
      try {
        const sessionId = await getOrCreateSessionId();
        const response = await apiPost("/api/public/cart/upsell", {
          businessId: cart.businessId,
          sessionId,
          items: (cart.items || []).map((item) => ({
        productId: item.productId,
        qty: item.qty,
          })),
        });
        setUpsellSuggestions(Array.isArray(response?.suggestions) ? response.suggestions : []);
      } catch {
        setUpsellSuggestions([]);
      } finally {
        setUpsellLoading(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [cart.businessId, cartSignature, hasItems]);

  async function loadAlternatives(removedItem) {
    if (String(reorderBusinessType || "").toLowerCase() !== "colmado") return;
    const productId = String(removedItem?.productId || "");
    if (!productId || !cart.businessId) return;
    setAlternativesLoadingId(productId);
    try {
      const response = await apiGet(
        `/api/public/substitutions?businessId=${encodeURIComponent(
          String(cart.businessId || "")
        )}&productId=${encodeURIComponent(productId)}`
      );
      const nextAlternatives = Array.isArray(response?.alternatives) ? response.alternatives : [];
      setAlternatives(nextAlternatives);
      setAlternativesFor(String(removedItem?.name || text.invalidAlternative));
    } catch {
      setAlternatives([]);
      setAlternativesFor("");
    } finally {
      setAlternativesLoadingId("");
    }
  }

  async function addUpsellSuggestion(item) {
    if (upsellAddingId) return;
    setUpsellAddingId(String(item.productId || ""));
    try {
      const nextCart = await addToCart({
        businessId: String(cart.businessId || ""),
        businessName: String(cart.businessName || ""),
        businessType: String(cart.businessType || ""),
        productId: String(item.productId || ""),
        name: String(item.name || text.invalidAlternative),
        price: Number(item.price || 0),
        imageUrl: String(item.imageUrl || item.image || ""),
        category: String(item.category || ""),
        displaySize: String(item.displaySize || ""),
        quantityValue: item.quantityValue ?? null,
        quantityUnit: String(item.quantityUnit || ""),
      });
      setCart(nextCart);
      emitFunnelEvent("add_to_cart", cartMetrics(nextCart));
    } finally {
      setUpsellAddingId("");
    }
  }

  async function handleWhatsAppOrder() {
    if (!hasItems) {
      Alert.alert("WhatsApp", "Cart is empty.");
      return;
    }

    const savedRaw = await AsyncStorage.getItem(SAVED_CUSTOMER_KEY).catch(() => null);
    let savedCustomer = null;
    try {
      savedCustomer = savedRaw ? JSON.parse(savedRaw) : null;
    } catch {
      savedCustomer = null;
    }
    const savedAddress = readSavedCustomerAddress(savedCustomer);
    const preferredPaymentMethod = String(
      savedCustomer?.preferredPaymentMethod || savedCustomer?.paymentMethod || ""
    ).trim();

    await openRestaurantOrderWhatsApp({
      restaurantName: String(cart.businessName || "").trim() || "OranjeEats restaurant",
      whatsapp: businessContact.whatsapp,
      phone: businessContact.phone,
      items: cart.items || [],
      totalAmount: subtotal,
      address: savedAddress.composedAddress || String(savedCustomer?.address || "").trim(),
      landmark: savedAddress.landmark,
      note: savedAddress.deliveryInstructions,
      paymentMethod: preferredPaymentMethod
        ? paymentMethodLabel(preferredPaymentMethod, market)
        : "",
      city,
    });
  }

  const subtotal = useMemo(() => getCartSubtotal(cart), [cart]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>{text.title}</Text>
          {!!cart.businessName ? (
            <Text style={styles.subtitle}>
              {text.restaurant}: {cart.businessName}
            </Text>
          ) : null}
        </View>

        <FlatList
          data={cart.items}
          keyExtractor={(item) => item.productId}
          style={styles.cartList}
          contentContainerStyle={styles.cartListContent}
          ListEmptyComponent={<Text style={styles.emptyText}>{text.empty}</Text>}
          renderItem={({ item }) => (
            <View style={styles.itemCard}>
              <Image source={getMenuItemImageSource(item)} style={styles.itemImage} />
              <View style={styles.itemContent}>
                <Text style={styles.itemName}>{item.name}</Text>
                {getProductSizeLabel(item) ? (
                  <Text style={styles.itemSize}>{getProductSizeLabel(item)}</Text>
                ) : null}
                <Text style={styles.itemPrice}>{formatPrice(item.price, market)}</Text>
                <View style={styles.itemActions}>
                  <View style={styles.qtyControls}>
                    <Pressable
                      onPress={async () => {
                        const next = await updateCartQty(item.productId, item.qty - 1);
                        setCart(next);
                      }}
                      style={styles.qtyButton}
                    >
                      <Text style={styles.qtyButtonText}>-</Text>
                    </Pressable>
                    <Text style={styles.qtyValue}>{item.qty}</Text>
                    <Pressable
                      onPress={async () => {
                        const next = await updateCartQty(item.productId, item.qty + 1);
                        setCart(next);
                        emitFunnelEvent("add_to_cart", cartMetrics(next));
                      }}
                      style={styles.qtyButton}
                    >
                      <Text style={styles.qtyButtonText}>+</Text>
                    </Pressable>
                  </View>
                  <Pressable
                    onPress={async () => {
                      const next = await removeFromCart(item.productId);
                      setCart(next);
                    }}
                    style={styles.removeButton}
                  >
                    <Text style={styles.removeButtonText}>{text.remove}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}
        />

        {hasItems ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>
              {text.suggestions} {upsellLoading ? `(${text.loadingSuggestions})` : ""}
            </Text>
            {upsellSuggestions.length ? (
              <View style={styles.stack}>
                {upsellSuggestions.map((item) => (
                  <View key={`upsell-${item.productId}`} style={styles.suggestionCard}>
                    <Image source={getMenuItemImageSource(item)} style={styles.suggestionImage} />
                    <View style={styles.suggestionContent}>
                      <Text style={styles.suggestionName}>{item.name}</Text>
                      {getProductSizeLabel(item) ? (
                        <Text style={styles.suggestionMeta}>{getProductSizeLabel(item)}</Text>
                      ) : null}
                      <Text style={styles.suggestionMeta}>{formatPrice(item.price || 0, market)}</Text>
                      <Text style={styles.suggestionReason}>{getSuggestionReason(item, isSpanish)}</Text>
                    </View>
                    <Pressable
                      disabled={Boolean(upsellAddingId)}
                      onPress={() => addUpsellSuggestion(item)}
                      style={[
                        styles.smallActionButton,
                        upsellAddingId === String(item.productId) && styles.disabledActionButton,
                      ]}
                    >
                      <Text style={styles.smallActionButtonText}>
                        {upsellAddingId === String(item.productId) ? "..." : text.add}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.panelBody}>{text.noSuggestions}</Text>
            )}
          </View>
        ) : null}

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTotal}>
            {text.subtotal}: {formatPrice(subtotal, market)}
          </Text>
          <Text style={styles.summaryNote}>{text.deliveryNote}</Text>
          <Text style={styles.summaryHint}>{text.offlineNote}</Text>
          <View style={styles.summaryActions}>
            <Pressable
              disabled={!hasItems}
              onPress={() => navigation.navigate("Checkout")}
              style={[styles.primaryButton, !hasItems && styles.disabledActionButton]}
            >
              <Text style={styles.primaryButtonText}>{text.continue}</Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                await clearCart();
                setCart({ businessId: "", businessName: "", items: [] });
              }}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>{text.clear}</Text>
            </Pressable>
          </View>
          <Pressable
            disabled={!hasItems}
            onPress={handleWhatsAppOrder}
            style={[styles.whatsAppButton, !hasItems && styles.disabledActionButton]}
          >
            <Text style={styles.whatsAppButtonText}>{text.whatsapp}</Text>
          </Pressable>
        </View>

        {removedItems.length ? (
          <View style={styles.warningCard}>
            <Text style={styles.warningTitle}>{text.removedTitle}</Text>
            {removedItems.map((item) => (
              <View key={`removed-${item.productId || item.name}`} style={styles.warningRow}>
                <View style={styles.warningBody}>
                  <Text style={styles.warningName}>{item.name}</Text>
                  {getProductSizeLabel(item) ? (
                    <Text style={styles.warningMeta}>{getProductSizeLabel(item)}</Text>
                  ) : null}
                  <Text style={styles.warningReason}>
                    {getReorderRemovalMessage(item.reasonCode, market)}
                  </Text>
                </View>
                {String(reorderBusinessType || "").toLowerCase() === "colmado" ? (
                  <Pressable
                    onPress={() => loadAlternatives(item)}
                    style={styles.altButton}
                  >
                    <Text style={styles.altButtonText}>
                      {alternativesLoadingId === item.productId ? "..." : text.alternatives}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {alternatives.length ? (
          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>
                {text.alternativesFor} {alternativesFor}
              </Text>
              <Pressable onPress={() => setAlternatives([])}>
                <Text style={styles.panelLink}>{text.close}</Text>
              </Pressable>
            </View>
            <View style={styles.stack}>
              {alternatives.map((item) => (
                <Pressable
                  key={`alt-${item.productId}`}
                  onPress={async () => {
                    const nextCart = await saveAndAddAlternative({
                      cart,
                      setCart,
                      businessId: String(cart.businessId || ""),
                      businessName: String(cart.businessName || ""),
                      item,
                      fallbackName: text.invalidAlternative,
                    });
                    setAlternatives([]);
                    emitFunnelEvent("add_to_cart", cartMetrics(nextCart));
                  }}
                  style={styles.altCard}
                >
                  <Image source={getMenuItemImageSource(item)} style={styles.altImage} />
                  <View style={styles.altContent}>
                    <Text style={styles.altName}>{item.name}</Text>
                    {getProductSizeLabel(item) ? (
                      <Text style={styles.altMeta}>{getProductSizeLabel(item)}</Text>
                    ) : null}
                    <Text style={styles.altMeta}>{formatPrice(item.price || 0, market)}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

async function saveAndAddAlternative({ cart, setCart, businessId, businessName, item, fallbackName }) {
  const nextCart = {
    ...cart,
    businessId,
    businessName,
    items: Array.isArray(cart.items) ? [...cart.items] : [],
  };
  const existingIndex = nextCart.items.findIndex((row) => row.productId === item.productId);
  if (existingIndex >= 0) {
    nextCart.items[existingIndex] = {
      ...nextCart.items[existingIndex],
      qty: Math.max(1, Math.min(50, Number(nextCart.items[existingIndex].qty || 1) + 1)),
      price: Number(item.price || nextCart.items[existingIndex].price || 0),
      name: String(item.name || nextCart.items[existingIndex].name || fallbackName),
      category: String(item.category || nextCart.items[existingIndex].category || ""),
      displaySize: String(item.displaySize || nextCart.items[existingIndex].displaySize || ""),
      quantityValue: item.quantityValue ?? nextCart.items[existingIndex].quantityValue ?? null,
      quantityUnit: String(item.quantityUnit || nextCart.items[existingIndex].quantityUnit || ""),
      imageUrl: String(item.imageUrl || item.image || nextCart.items[existingIndex].imageUrl || ""),
      image: String(item.image || item.imageUrl || nextCart.items[existingIndex].image || ""),
    };
  } else {
    nextCart.items.push({
      productId: String(item.productId || ""),
      name: String(item.name || fallbackName),
      price: Number(item.price || 0),
      imageUrl: String(item.imageUrl || item.image || ""),
      image: String(item.image || item.imageUrl || ""),
      qty: 1,
      category: String(item.category || ""),
      displaySize: String(item.displaySize || ""),
      quantityValue: item.quantityValue ?? null,
      quantityUnit: String(item.quantityUnit || ""),
    });
  }
  await saveCart(nextCart);
  setCart(nextCart);
  return nextCart;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: CUSTOMER_THEME.BG,
  },
  screen: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  header: {
    gap: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: "900",
    color: CUSTOMER_THEME.INK,
  },
  subtitle: {
    color: CUSTOMER_THEME.MUTED,
    fontSize: 14,
  },
  cartList: {
    flexGrow: 0,
  },
  cartListContent: {
    gap: 10,
  },
  emptyText: {
    color: CUSTOMER_THEME.MUTED,
    paddingVertical: 16,
  },
  itemCard: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: CUSTOMER_THEME.SURFACE,
    borderWidth: 1,
    borderColor: CUSTOMER_THEME.BORDER,
    borderRadius: CUSTOMER_RADIUS.card,
    padding: 12,
    ...CUSTOMER_SHADOW,
  },
  itemImage: {
    width: 84,
    height: 84,
    borderRadius: 16,
    backgroundColor: CUSTOMER_THEME.ORANGE_SOFT,
  },
  itemContent: {
    flex: 1,
    gap: 6,
  },
  itemName: {
    fontWeight: "900",
    color: CUSTOMER_THEME.INK,
    fontSize: 16,
  },
  itemSize: {
    alignSelf: "flex-start",
    color: CUSTOMER_THEME.SUCCESS,
    fontWeight: "900",
    fontSize: 12,
    backgroundColor: CUSTOMER_THEME.SUCCESS_SOFT,
    borderRadius: CUSTOMER_RADIUS.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  itemPrice: {
    color: CUSTOMER_THEME.INK_SOFT,
    fontWeight: "700",
  },
  itemActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 4,
  },
  qtyControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  qtyButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: CUSTOMER_THEME.ORANGE_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyButtonText: {
    color: CUSTOMER_THEME.ORANGE_DARK,
    fontWeight: "900",
    fontSize: 16,
  },
  qtyValue: {
    minWidth: 20,
    textAlign: "center",
    color: CUSTOMER_THEME.INK,
    fontWeight: "900",
  },
  removeButton: {
    backgroundColor: CUSTOMER_THEME.DANGER_SOFT,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  removeButtonText: {
    color: CUSTOMER_THEME.DANGER,
    fontWeight: "800",
  },
  panel: {
    backgroundColor: CUSTOMER_THEME.SURFACE,
    borderWidth: 1,
    borderColor: CUSTOMER_THEME.BORDER,
    borderRadius: CUSTOMER_RADIUS.card,
    padding: 12,
    gap: 10,
    ...CUSTOMER_SHADOW,
  },
  panelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  panelTitle: {
    fontWeight: "900",
    color: CUSTOMER_THEME.INK,
  },
  panelBody: {
    color: CUSTOMER_THEME.MUTED,
  },
  panelLink: {
    color: CUSTOMER_THEME.ORANGE_DARK,
    fontWeight: "800",
  },
  stack: {
    gap: 8,
  },
  suggestionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: CUSTOMER_THEME.SURFACE_ALT,
    borderRadius: CUSTOMER_RADIUS.button,
    padding: 10,
  },
  suggestionImage: {
    width: 58,
    height: 58,
    borderRadius: 12,
    backgroundColor: CUSTOMER_THEME.ORANGE_SOFT,
  },
  suggestionContent: {
    flex: 1,
    gap: 2,
  },
  suggestionName: {
    fontWeight: "800",
    color: CUSTOMER_THEME.INK,
  },
  suggestionMeta: {
    color: CUSTOMER_THEME.MUTED,
    fontSize: 12,
  },
  suggestionReason: {
    color: CUSTOMER_THEME.INK_SOFT,
    fontSize: 12,
  },
  smallActionButton: {
    backgroundColor: CUSTOMER_THEME.INK,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  smallActionButtonText: {
    color: CUSTOMER_THEME.SURFACE,
    fontWeight: "800",
  },
  disabledActionButton: {
    opacity: 0.55,
  },
  summaryCard: {
    backgroundColor: CUSTOMER_THEME.SURFACE,
    borderWidth: 1,
    borderColor: CUSTOMER_THEME.ORANGE_BORDER,
    borderRadius: CUSTOMER_RADIUS.card,
    padding: 14,
    gap: 10,
    ...CUSTOMER_SHADOW,
  },
  summaryTotal: {
    fontWeight: "900",
    fontSize: 18,
    color: CUSTOMER_THEME.INK,
  },
  summaryNote: {
    color: CUSTOMER_THEME.INK_SOFT,
    fontWeight: "700",
  },
  summaryHint: {
    color: CUSTOMER_THEME.MUTED,
    fontSize: 12,
  },
  summaryActions: {
    flexDirection: "row",
    gap: 8,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: CUSTOMER_THEME.INK,
    borderRadius: CUSTOMER_RADIUS.button,
    padding: 12,
    alignItems: "center",
  },
  primaryButtonText: {
    color: CUSTOMER_THEME.SURFACE,
    textAlign: "center",
    fontWeight: "900",
  },
  secondaryButton: {
    backgroundColor: CUSTOMER_THEME.ORANGE_SOFT,
    borderRadius: CUSTOMER_RADIUS.button,
    padding: 12,
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: CUSTOMER_THEME.ORANGE_DARK,
    fontWeight: "800",
  },
  whatsAppButton: {
    backgroundColor: CUSTOMER_THEME.WHATSAPP,
    borderRadius: CUSTOMER_RADIUS.button,
    padding: 12,
    alignItems: "center",
  },
  whatsAppButtonText: {
    color: CUSTOMER_THEME.SURFACE,
    fontWeight: "900",
  },
  warningCard: {
    backgroundColor: CUSTOMER_THEME.SURFACE_ALT,
    borderWidth: 1,
    borderColor: CUSTOMER_THEME.ORANGE_BORDER,
    borderRadius: CUSTOMER_RADIUS.card,
    padding: 12,
    gap: 8,
  },
  warningTitle: {
    fontWeight: "900",
    color: CUSTOMER_THEME.ORANGE_DARK,
  },
  warningRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  warningBody: {
    flex: 1,
  },
  warningName: {
    color: CUSTOMER_THEME.ORANGE_DARK,
    fontWeight: "700",
  },
  warningMeta: {
    color: CUSTOMER_THEME.ORANGE_DARK,
    fontSize: 12,
    fontWeight: "800",
  },
  warningReason: {
    color: CUSTOMER_THEME.ORANGE_DARK,
    fontSize: 12,
  },
  altButton: {
    backgroundColor: CUSTOMER_THEME.ORANGE,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  altButtonText: {
    color: CUSTOMER_THEME.SURFACE,
    fontWeight: "800",
  },
  altCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: CUSTOMER_THEME.SURFACE_ALT,
    borderRadius: CUSTOMER_RADIUS.button,
    padding: 10,
  },
  altImage: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: CUSTOMER_THEME.ORANGE_SOFT,
  },
  altContent: {
    flex: 1,
    gap: 2,
  },
  altName: {
    fontWeight: "800",
    color: CUSTOMER_THEME.INK,
  },
  altMeta: {
    color: CUSTOMER_THEME.MUTED,
    fontSize: 12,
  },
});
