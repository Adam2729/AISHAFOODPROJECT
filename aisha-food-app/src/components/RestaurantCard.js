import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { getMarketConfig } from "../lib/marketConfig";
import {
  formatRestaurantDeliveryFee,
  formatRestaurantEta,
  getRestaurantDisplayName,
  getRestaurantImageSource,
} from "../lib/restaurants";
import {
  CUSTOMER_RADIUS,
  CUSTOMER_SHADOW,
  CUSTOMER_THEME,
} from "../lib/customerTheme";

export default function RestaurantCard({ restaurant, onPress, city }) {
  const market = getMarketConfig(city);
  const isSpanish = market.defaultLanguage === "es";

  return (
    <Pressable
      onPress={() => onPress?.(restaurant)}
      style={[styles.card, restaurant?.sponsored ? styles.cardSponsored : null]}
    >
      <Image source={getRestaurantImageSource(restaurant)} style={styles.image} />

      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={styles.title} numberOfLines={1}>
            {getRestaurantDisplayName(restaurant)}
          </Text>
          {restaurant?.sponsored ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{isSpanish ? "Patrocinado" : "Sponsorise"}</Text>
            </View>
          ) : null}
        </View>

        {!!restaurant?.zoneLabel ? (
          <Text style={styles.metaText} numberOfLines={1}>
            {restaurant.zoneLabel}
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          <Text style={styles.metric}>
            {formatRestaurantEta(restaurant?.estimatedDeliveryMinutes, market)}
          </Text>
          <Text style={styles.dot}>|</Text>
          <Text style={styles.metric}>
            {formatRestaurantDeliveryFee(restaurant?.deliveryFee, market)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CUSTOMER_THEME.SURFACE,
    borderRadius: CUSTOMER_RADIUS.card,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: CUSTOMER_THEME.BORDER,
    marginBottom: 14,
    ...CUSTOMER_SHADOW,
  },
  cardSponsored: {
    borderColor: CUSTOMER_THEME.ORANGE_BORDER,
  },
  image: {
    width: "100%",
    height: 154,
    backgroundColor: CUSTOMER_THEME.ORANGE_SOFT,
  },
  body: {
    padding: 14,
    gap: 6,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: "900",
    color: CUSTOMER_THEME.INK,
  },
  badge: {
    borderRadius: CUSTOMER_RADIUS.pill,
    backgroundColor: CUSTOMER_THEME.ORANGE_SOFT,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    color: CUSTOMER_THEME.ORANGE_DARK,
    fontSize: 12,
    fontWeight: "900",
  },
  metaText: {
    color: CUSTOMER_THEME.MUTED,
    fontSize: 13,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metric: {
    color: CUSTOMER_THEME.INK_SOFT,
    fontSize: 13,
    fontWeight: "700",
  },
  dot: {
    color: CUSTOMER_THEME.MUTED_SOFT,
    fontSize: 13,
    fontWeight: "700",
  },
});
