import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import RestaurantCard from "../components/RestaurantCard";
import { useAppShell } from "../context/AppShellContext";
import { apiGet } from "../lib/api";
import { getProductCategoryLabel, getProductSizeLabel } from "../lib/catalogPresentation";
import {
  CUSTOMER_RADIUS,
  CUSTOMER_SHADOW,
  CUSTOMER_THEME,
} from "../lib/customerTheme";
import formatPrice from "../lib/formatPrice";
import {
  getMenuItemImageSource,
  getRestaurantDisplayName,
  trackSponsoredRestaurantClick,
} from "../lib/restaurants";

export default function SearchScreen({ navigation }) {
  const { selectedCity: city, market } = useAppShell();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const isSpanish = market.defaultLanguage === "es";

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const queryText = String(debouncedQuery || "").trim();
        if (queryText.length >= 2) {
          const response = await apiGet(
            `/api/public/search?q=${encodeURIComponent(queryText)}&limitBusinesses=15&limitProducts=20&source=searchbar`
          );
          const businesses = Array.isArray(response?.results?.businesses)
            ? response.results.businesses.map((row) => ({
                ...row,
                kind: "business",
                restaurantId: row.businessId,
                businessName: row.name,
                logo: row.logoUrl,
                estimatedDeliveryMinutes: row?.eta?.maxMins || row?.eta?.minMins || 0,
                deliveryFee: 0,
              }))
            : [];
          const products = Array.isArray(response?.results?.products)
            ? response.results.products.map((row) => ({
                ...row,
                kind: "product",
              }))
            : [];
          if (!mounted) return;
          setResults([...businesses, ...products]);
          return;
        }

        const response = await apiGet("/api/public/restaurants?limit=30");
        if (!mounted) return;
        setResults(
          Array.isArray(response?.rows)
            ? response.rows.map((row) => ({ ...row, kind: "business" }))
            : []
        );
      } catch (requestError) {
        if (!mounted) return;
        setError(requestError?.message || "Impossible de rechercher les restaurants.");
        setResults([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load().catch(() => null);
    return () => {
      mounted = false;
    };
  }, [debouncedQuery, retryNonce]);

  const text = isSpanish
    ? {
        title: "Buscar",
        placeholder: "Restaurante, producto, categoria...",
        helper: debouncedQuery
          ? `Resultados para "${debouncedQuery}"`
          : city?.name
          ? `Restaurantes y productos disponibles en ${city.name}`
          : "Busca por restaurante, producto o categoria",
        loading: "Buscando...",
        unavailable: "Busqueda no disponible",
        retry: "Reintentar",
        empty: "No se encontraron resultados",
        emptyBody: "Prueba otro nombre o termino de busqueda.",
        details: "Detalles",
      }
    : {
        title: "Rechercher",
        placeholder: "Restaurant, produit, categorie...",
        helper: debouncedQuery
          ? `Resultats pour "${debouncedQuery}"`
          : city?.name
          ? `Restaurants et produits disponibles a ${city.name}`
          : "Recherche par restaurant, produit ou categorie",
        loading: "Recherche en cours...",
        unavailable: "Recherche indisponible",
        retry: "Reessayer",
        empty: "Aucun resultat trouve",
        emptyBody: "Essaie un autre nom ou terme de recherche.",
        details: "Details",
      };

  const openRestaurant = async (restaurant) => {
    trackSponsoredRestaurantClick(restaurant).catch(() => null);
    navigation.navigate("Business", {
      restaurantId: restaurant?.restaurantId || restaurant?.businessId,
      businessId: restaurant?.businessId || restaurant?.restaurantId,
      restaurantName: getRestaurantDisplayName(restaurant, ""),
      slug: restaurant?.slug,
      sponsored: Boolean(restaurant?.sponsored),
      campaignId: restaurant?.campaignId || null,
      source: "search",
    });
  };

  const openProductDetails = (product) => {
    navigation.navigate("ItemDetails", {
      id: String(product?.productId || product?.id || ""),
      item: {
        ...product,
        businessName: product?.businessName,
        businessType: product?.businessType,
      },
      businessId: product?.businessId,
      businessName: product?.businessName,
      businessType: product?.businessType,
      source: "search",
    });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <FlatList
        data={results}
        keyExtractor={(item, index) =>
          String(item?.productId || item?.restaurantId || item?.businessId || item?.slug || `search-${index}`)
        }
        renderItem={({ item }) =>
          item?.kind === "product" ? (
            <Pressable style={styles.productCard} onPress={() => openProductDetails(item)}>
              <Image source={getMenuItemImageSource(item)} style={styles.productImage} />
              <View style={styles.productBody}>
                <Text style={styles.productName}>{String(item?.name || "Produit")}</Text>
                {getProductSizeLabel(item) ? (
                  <Text style={styles.productSize}>{getProductSizeLabel(item)}</Text>
                ) : null}
                <Text style={styles.productMeta}>
                  {getProductCategoryLabel(item) || String(item?.businessName || "")}
                </Text>
                <Text style={styles.productBusiness}>{String(item?.businessName || "")}</Text>
              </View>
              <View style={styles.productSide}>
                <Text style={styles.productPrice}>{formatPrice(Number(item?.price || 0), market)}</Text>
                <Text style={styles.productDetailsLink}>{text.details}</Text>
              </View>
            </Pressable>
          ) : (
            <RestaurantCard
              restaurant={item}
              city={city}
              onPress={openRestaurant}
            />
          )
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>{text.title}</Text>
            <Text style={styles.subtitle}>{text.helper}</Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={text.placeholder}
              placeholderTextColor="#94A3B8"
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.stateCard}>
              <ActivityIndicator color="#F97316" />
              <Text style={styles.stateText}>{text.loading}</Text>
            </View>
          ) : error ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>{text.unavailable}</Text>
              <Text style={styles.stateText}>{error}</Text>
              <Pressable style={styles.retryButton} onPress={() => setRetryNonce((value) => value + 1)}>
                <Text style={styles.retryText}>{text.retry}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>{text.empty}</Text>
              <Text style={styles.stateText}>{text.emptyBody}</Text>
            </View>
          )
        }
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      />
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
    flexGrow: 1,
  },
  header: {
    marginBottom: 16,
    gap: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    color: CUSTOMER_THEME.INK,
  },
  subtitle: {
    color: CUSTOMER_THEME.MUTED,
    fontSize: 14,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: CUSTOMER_THEME.BORDER,
    borderRadius: CUSTOMER_RADIUS.button,
    backgroundColor: CUSTOMER_THEME.SURFACE,
    paddingHorizontal: 14,
    color: CUSTOMER_THEME.INK,
    fontSize: 15,
  },
  productCard: {
    backgroundColor: CUSTOMER_THEME.SURFACE,
    borderWidth: 1,
    borderColor: CUSTOMER_THEME.BORDER,
    borderRadius: CUSTOMER_RADIUS.card,
    padding: 14,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    ...CUSTOMER_SHADOW,
  },
  productImage: {
    width: 74,
    height: 74,
    borderRadius: 14,
    backgroundColor: CUSTOMER_THEME.ORANGE_SOFT,
  },
  productBody: {
    flex: 1,
    gap: 4,
  },
  productName: {
    color: CUSTOMER_THEME.INK,
    fontSize: 16,
    fontWeight: "900",
  },
  productSize: {
    alignSelf: "flex-start",
    color: CUSTOMER_THEME.SUCCESS,
    fontSize: 12,
    fontWeight: "900",
    backgroundColor: CUSTOMER_THEME.SUCCESS_SOFT,
    borderRadius: CUSTOMER_RADIUS.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  productMeta: {
    color: CUSTOMER_THEME.MUTED,
    fontSize: 12,
    fontWeight: "800",
  },
  productBusiness: {
    color: CUSTOMER_THEME.INK_SOFT,
    fontSize: 13,
  },
  productSide: {
    alignItems: "flex-end",
    gap: 8,
  },
  productPrice: {
    color: CUSTOMER_THEME.SUCCESS,
    fontWeight: "900",
  },
  productDetailsLink: {
    color: CUSTOMER_THEME.ORANGE,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  stateCard: {
    flex: 1,
    backgroundColor: CUSTOMER_THEME.SURFACE,
    borderWidth: 1,
    borderColor: CUSTOMER_THEME.BORDER,
    borderRadius: CUSTOMER_RADIUS.card,
    padding: 20,
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
    ...CUSTOMER_SHADOW,
  },
  stateTitle: {
    color: CUSTOMER_THEME.INK,
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  stateText: {
    color: CUSTOMER_THEME.MUTED,
    fontSize: 14,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: CUSTOMER_THEME.INK,
    borderRadius: CUSTOMER_RADIUS.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  retryText: {
    color: CUSTOMER_THEME.SURFACE,
    fontWeight: "800",
  },
});
