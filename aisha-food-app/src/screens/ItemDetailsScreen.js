import React from "react";
import { Alert, Image, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useAppShell } from "../context/AppShellContext";
import { addToCart } from "../lib/cart";
import { getProductCategoryLabel, getProductSizeLabel, getUnavailableCopy } from "../lib/catalogPresentation";
import {
  CUSTOMER_RADIUS,
  CUSTOMER_SHADOW,
  CUSTOMER_THEME,
} from "../lib/customerTheme";
import formatPrice from "../lib/formatPrice";
import { getMenuItemImageSource } from "../lib/restaurants";

export default function ItemDetailsScreen({ route, navigation }) {
  const { market } = useAppShell();
  const { id, item, businessId: routeBusinessId, businessName: routeBusinessName } = route?.params || {};
  const routeBusinessType = String(route?.params?.businessType || item?.businessType || "").trim();
  const isSpanish = market.defaultLanguage === "es";

  const name = String(item?.name || "").trim() || "Menu item";
  const description = String(item?.description || "").trim() || (isSpanish ? "Descripcion no disponible." : "Description non disponible.");
  const price = Number(item?.price || 0);
  const productId = String(item?.productId || item?.id || id || "").trim();
  const businessId = String(routeBusinessId || item?.businessId || "").trim();
  const businessName = String(routeBusinessName || item?.businessName || "").trim() || "Restaurant";
  const imageSource = getMenuItemImageSource(item);
  const sizeLabel = getProductSizeLabel(item);
  const categoryLabel = getProductCategoryLabel(item);
  const isUnavailable = item?.isAvailable === false;

  const text = isSpanish
    ? {
        cart: "Carrito",
        invalidItem: "Articulo invalido.",
        invalidBusiness: "No fue posible identificar el restaurante de este articulo.",
        added: "Articulo agregado.",
        continue: "Continuar",
        seeCart: "Ver carrito",
        cta: "Agregar al carrito",
        addError: "No fue posible agregar el articulo al carrito.",
        unavailable: "Este articulo esta indisponible.",
        restaurant: "Restaurante",
      }
    : {
        cart: "Panier",
        invalidItem: "Article invalide.",
        invalidBusiness: "Impossible d'identifier le restaurant de cet article.",
        added: "Article ajoute.",
        continue: "Continuer",
        seeCart: "Voir le panier",
        cta: "Ajouter au panier",
        addError: "Impossible d'ajouter l'article au panier.",
        unavailable: "Cet article est indisponible.",
        restaurant: "Restaurant",
      };

  const handleAddToCart = async () => {
    if (!productId) {
      Alert.alert(text.cart, text.invalidItem);
      return;
    }
    if (!businessId) {
      Alert.alert(text.cart, text.invalidBusiness);
      return;
    }
    if (isUnavailable) {
      Alert.alert(text.cart, getUnavailableCopy(market));
      return;
    }

    try {
      await addToCart({
        businessId,
        businessName,
        businessType: routeBusinessType,
        productId,
        name,
        price,
        imageUrl: String(item?.imageUrl || item?.image || ""),
        category: categoryLabel,
        displaySize: sizeLabel,
        quantityValue: item?.quantityValue ?? null,
        quantityUnit: item?.quantityUnit || "",
      });
      Alert.alert(text.cart, text.added, [
        { text: text.continue, style: "cancel" },
        {
          text: text.seeCart,
          onPress: () => {
            const routeNames = navigation?.getState?.()?.routeNames || [];
            if (Array.isArray(routeNames) && routeNames.includes("Cart")) {
              navigation?.navigate?.("Cart");
              return;
            }
            navigation?.navigate?.("MainTabs", { screen: "Cart" });
          },
        },
      ]);
    } catch (error) {
      Alert.alert(text.cart, error?.message || text.addError);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Image source={imageSource} style={styles.image} />

        <View style={styles.content}>
          <Text style={styles.businessLabel}>
            {text.restaurant}: {businessName}
          </Text>
          <Text style={styles.title}>{name}</Text>
          <View style={styles.metaRow}>
            {sizeLabel ? <Text style={styles.sizeLabel}>{sizeLabel}</Text> : null}
            {categoryLabel ? <Text style={styles.categoryPill}>{categoryLabel}</Text> : null}
          </View>
          <Text style={styles.price}>{formatPrice(price, market)}</Text>
          <Text style={styles.description}>{description}</Text>
          {isUnavailable ? <Text style={styles.unavailableText}>{text.unavailable}</Text> : null}

          <Pressable
            style={[styles.ctaButton, isUnavailable && styles.ctaButtonDisabled]}
            disabled={isUnavailable}
            onPress={handleAddToCart}
          >
            <Text style={styles.ctaText}>{text.cta}</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: CUSTOMER_THEME.BG,
  },
  container: {
    flex: 1,
  },
  image: {
    width: "100%",
    height: 280,
    backgroundColor: CUSTOMER_THEME.ORANGE_SOFT,
  },
  content: {
    flex: 1,
    padding: 16,
    gap: 10,
    backgroundColor: CUSTOMER_THEME.SURFACE,
    marginTop: -18,
    borderTopLeftRadius: CUSTOMER_RADIUS.large,
    borderTopRightRadius: CUSTOMER_RADIUS.large,
    ...CUSTOMER_SHADOW,
  },
  title: {
    fontSize: 24,
    fontWeight: "900",
    color: CUSTOMER_THEME.INK,
  },
  businessLabel: {
    color: CUSTOMER_THEME.MUTED,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  price: {
    fontSize: 18,
    fontWeight: "800",
    color: CUSTOMER_THEME.SUCCESS,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  sizeLabel: {
    alignSelf: "flex-start",
    color: CUSTOMER_THEME.SUCCESS,
    fontSize: 13,
    fontWeight: "900",
    backgroundColor: CUSTOMER_THEME.SUCCESS_SOFT,
    borderRadius: CUSTOMER_RADIUS.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  categoryPill: {
    alignSelf: "flex-start",
    color: CUSTOMER_THEME.INK_SOFT,
    fontSize: 13,
    fontWeight: "800",
    backgroundColor: CUSTOMER_THEME.ORANGE_SOFT,
    borderRadius: CUSTOMER_RADIUS.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    color: CUSTOMER_THEME.INK_SOFT,
  },
  unavailableText: {
    color: CUSTOMER_THEME.DANGER,
    fontWeight: "800",
  },
  ctaButton: {
    marginTop: 8,
    backgroundColor: CUSTOMER_THEME.INK,
    borderRadius: CUSTOMER_RADIUS.button,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaButtonDisabled: {
    opacity: 0.55,
  },
  ctaText: {
    color: CUSTOMER_THEME.SURFACE,
    fontWeight: "900",
    fontSize: 15,
  },
});
