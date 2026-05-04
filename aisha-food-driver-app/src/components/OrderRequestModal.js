import React, { useEffect, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  DRIVER_BREAKPOINTS,
  DRIVER_RADIUS,
  DRIVER_SHADOW,
  DRIVER_SPACING,
  DRIVER_THEME,
  DRIVER_TYPOGRAPHY,
} from "../lib/driverTheme";
import { formatCurrency } from "../lib/orderUtils";

function firstText(values, fallback = "Non disponible") {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return fallback;
}

function formatCountdown(seconds) {
  const safeSeconds = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatDistance(distanceKm) {
  const amount = Number(distanceKm || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "Non disponible";
  }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} km`;
}

function MetricCard({ label, value, accent = DRIVER_THEME.DARK }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color: accent }]}>{value}</Text>
    </View>
  );
}

function DetailRow({ icon, label, value }) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailIcon}>
        <Ionicons name={icon} size={18} color={DRIVER_THEME.ORANGE_DARK} />
      </View>
      <View style={styles.detailBody}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

export default function OrderRequestModal({
  offer,
  countdownSeconds,
  processingState,
  message,
  error,
  weakNetworkMessage,
  onAccept,
  onReject,
}) {
  const isBusy = Boolean(processingState);
  const currency = String(offer?.currency || "CFA").trim() || "CFA";
  const { width } = useWindowDimensions();
  const isCompact = width < DRIVER_BREAKPOINTS.compact;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const cardTranslateY = useRef(new Animated.Value(80)).current;
  const acceptScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.spring(cardTranslateY, {
        toValue: 0,
        damping: 16,
        mass: 0.9,
        stiffness: 140,
        useNativeDriver: true,
      }),
    ]).start();
  }, [cardTranslateY, overlayOpacity]);

  useEffect(() => {
    if (isBusy) {
      acceptScale.stopAnimation();
      acceptScale.setValue(1);
      return undefined;
    }

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(acceptScale, {
          toValue: 1.03,
          duration: 850,
          useNativeDriver: true,
        }),
        Animated.timing(acceptScale, {
          toValue: 1,
          duration: 850,
          useNativeDriver: true,
        }),
      ])
    );

    pulse.start();
    return () => pulse.stop();
  }, [acceptScale, isBusy]);

  const paymentLabel = useMemo(
    () =>
      firstText(
        [offer?.paymentProvider, offer?.paymentMethod],
        "Cash"
      ),
    [offer?.paymentMethod, offer?.paymentProvider]
  );

  const restaurantName = firstText(
    [offer?.restaurantName, offer?.businessName],
    "Restaurant"
  );
  const pickupAddress = firstText([offer?.pickupAddress], "Pickup address unavailable");
  const customerAddress = firstText(
    [offer?.customerAddress, offer?.customerArea],
    "Customer address unavailable"
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]} />

      <View style={styles.container}>
        <Animated.View
          style={[
            styles.sheet,
            isCompact ? styles.sheetCompact : null,
            { transform: [{ translateY: cardTranslateY }] },
          ]}
        >
          <View style={styles.hero}>
            <View style={styles.heroTopRow}>
              <View style={styles.heroBadge}>
                <Ionicons name="flash-outline" size={16} color="#FFFFFF" />
                <Text style={styles.heroBadgeText}>New order</Text>
              </View>
              <View style={styles.countdownCircle}>
                <Text style={styles.countdownNumber}>{formatCountdown(countdownSeconds)}</Text>
                <Text style={styles.countdownLabel}>remaining</Text>
              </View>
            </View>
            <Text style={[styles.heroTitle, isCompact ? styles.heroTitleCompact : null]}>
              Accept this nearby delivery
            </Text>
            <Text style={styles.heroSubtitle}>
              Review the pickup, customer address, earning, and payment before the timer ends.
            </Text>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {weakNetworkMessage ? (
              <View style={styles.bannerWarning}>
                <Ionicons name="cloud-offline-outline" size={18} color={DRIVER_THEME.WARNING_TEXT} />
                <Text style={styles.bannerWarningText}>{weakNetworkMessage}</Text>
              </View>
            ) : null}

            {message ? (
              <View style={styles.bannerSuccess}>
                <Ionicons name="checkmark-circle" size={18} color={DRIVER_THEME.SUCCESS_TEXT} />
                <Text style={styles.bannerSuccessText}>{message}</Text>
              </View>
            ) : null}

            {error ? (
              <View style={styles.bannerError}>
                <Ionicons name="alert-circle" size={18} color={DRIVER_THEME.ERROR_TEXT} />
                <Text style={styles.bannerErrorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.orderCard}>
              <View style={styles.orderHeader}>
                <View style={styles.orderHeaderText}>
                  <Text style={styles.restaurantName}>{restaurantName}</Text>
                  <Text style={styles.customerAreaText}>
                    {firstText([offer?.customerArea], "OranjeEats delivery")}
                  </Text>
                </View>
                <View style={styles.earningChip}>
                  <Text style={styles.earningChipLabel}>Estimated earning</Text>
                  <Text style={styles.earningChipValue}>
                    {formatCurrency(offer?.estimatedEarning, currency)}
                  </Text>
                </View>
              </View>

              <DetailRow
                icon="storefront-outline"
                label="Pickup"
                value={pickupAddress}
              />
              <DetailRow
                icon="location-outline"
                label="Drop-off"
                value={customerAddress}
              />
              <DetailRow
                icon="wallet-outline"
                label="Payment"
                value={paymentLabel}
              />

              {offer?.deliveryNotes ? (
                <View style={styles.noteCard}>
                  <Ionicons name="document-text-outline" size={18} color={DRIVER_THEME.ORANGE_DARK} />
                  <Text style={styles.noteText}>{String(offer.deliveryNotes).trim()}</Text>
                </View>
              ) : null}
            </View>

            <View style={[styles.metricsRow, isCompact ? styles.metricsRowCompact : null]}>
              <MetricCard label="Distance" value={formatDistance(offer?.estimatedDistanceKm)} />
              <MetricCard
                label="Order total"
                value={formatCurrency(offer?.orderTotal, currency)}
                accent={DRIVER_THEME.ORANGE_DARK}
              />
            </View>

            <View style={[styles.metricsRow, isCompact ? styles.metricsRowCompact : null]}>
              <MetricCard
                label="Amount to collect"
                value={formatCurrency(offer?.amountToCollect, currency)}
                accent={DRIVER_THEME.GREEN}
              />
              <MetricCard label="Reference" value={firstText([offer?.orderNumber], "Pending")} />
            </View>
          </ScrollView>

          <View style={[styles.footer, isCompact ? styles.footerCompact : null]}>
            <Pressable
              style={[
                styles.rejectButton,
                isCompact ? styles.footerButtonCompact : null,
                isBusy ? styles.buttonDisabled : null,
              ]}
              disabled={isBusy}
              onPress={onReject}
            >
              <Text style={styles.rejectButtonText}>
                {processingState === "reject" ? "Rejecting..." : "Reject"}
              </Text>
            </Pressable>

            <Animated.View
              style={[
                styles.acceptButtonWrap,
                isCompact ? styles.footerButtonCompact : null,
                { transform: [{ scale: acceptScale }] },
              ]}
            >
              <Pressable
                style={[styles.acceptButton, isBusy ? styles.buttonDisabled : null]}
                disabled={isBusy}
                onPress={onAccept}
              >
                {processingState === "accept" ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.acceptButtonText}>Accept order</Text>
                )}
              </Pressable>
            </Animated.View>
          </View>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: DRIVER_THEME.OVERLAY,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: DRIVER_THEME.OVERLAY,
  },
  container: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 12,
  },
  sheet: {
    maxHeight: "96%",
    backgroundColor: DRIVER_THEME.BACKGROUND,
    borderRadius: 30,
    overflow: "hidden",
    ...DRIVER_SHADOW,
  },
  sheetCompact: {
    maxHeight: "98%",
  },
  hero: {
    backgroundColor: DRIVER_THEME.ORANGE,
    paddingHorizontal: DRIVER_SPACING.screen,
    paddingTop: 18,
    paddingBottom: 22,
    gap: 12,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: DRIVER_RADIUS.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  heroBadgeText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  countdownCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.45)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(17, 24, 39, 0.16)",
  },
  countdownNumber: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
  },
  countdownLabel: {
    color: "#FFF4EC",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "900",
  },
  heroTitleCompact: {
    fontSize: 26,
    lineHeight: 30,
  },
  heroSubtitle: {
    color: "#FFF4EC",
    fontSize: 15,
    lineHeight: 21,
  },
  content: {
    padding: DRIVER_SPACING.screen,
    gap: DRIVER_SPACING.section,
    paddingBottom: 28,
  },
  bannerWarning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: DRIVER_THEME.WARNING_BG,
    borderRadius: DRIVER_RADIUS.card,
    padding: 14,
    borderWidth: 1,
    borderColor: DRIVER_THEME.BORDER_WARM,
  },
  bannerWarningText: {
    flex: 1,
    color: DRIVER_THEME.WARNING_TEXT,
    fontSize: 14,
    lineHeight: 19,
  },
  bannerSuccess: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: DRIVER_THEME.SUCCESS_BG,
    borderRadius: DRIVER_RADIUS.card,
    padding: 14,
  },
  bannerSuccessText: {
    flex: 1,
    color: DRIVER_THEME.SUCCESS_TEXT,
    fontWeight: "700",
  },
  bannerError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: DRIVER_THEME.ERROR_BG,
    borderRadius: DRIVER_RADIUS.card,
    padding: 14,
  },
  bannerErrorText: {
    flex: 1,
    color: DRIVER_THEME.ERROR_TEXT,
    fontWeight: "700",
  },
  orderCard: {
    backgroundColor: DRIVER_THEME.CARD,
    borderRadius: DRIVER_RADIUS.cardLarge,
    padding: DRIVER_SPACING.card,
    gap: 14,
    borderWidth: 1,
    borderColor: DRIVER_THEME.BORDER,
    ...DRIVER_SHADOW,
  },
  orderHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  orderHeaderText: {
    flex: 1,
    gap: 4,
  },
  restaurantName: {
    color: DRIVER_THEME.DARK,
    fontSize: DRIVER_TYPOGRAPHY.title,
    fontWeight: "900",
  },
  customerAreaText: {
    color: DRIVER_THEME.MUTED,
    fontSize: DRIVER_TYPOGRAPHY.body,
    lineHeight: 20,
  },
  earningChip: {
    backgroundColor: DRIVER_THEME.ORANGE_LIGHT,
    borderRadius: DRIVER_RADIUS.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minWidth: 128,
    alignItems: "center",
  },
  earningChipLabel: {
    color: DRIVER_THEME.ORANGE_DARK,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    textAlign: "center",
  },
  earningChipValue: {
    marginTop: 4,
    color: DRIVER_THEME.ORANGE_DARK,
    fontSize: 18,
    fontWeight: "900",
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  detailIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: DRIVER_THEME.ORANGE_LIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  detailBody: {
    flex: 1,
    gap: 4,
  },
  detailLabel: {
    color: DRIVER_THEME.MUTED,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  detailValue: {
    color: DRIVER_THEME.DARK,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
  },
  noteCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: DRIVER_THEME.SURFACE_ALT,
    borderRadius: DRIVER_RADIUS.card,
    padding: 12,
  },
  noteText: {
    flex: 1,
    color: DRIVER_THEME.ORANGE_DARK,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "600",
  },
  metricsRow: {
    flexDirection: "row",
    gap: 12,
  },
  metricsRowCompact: {
    flexDirection: "column",
  },
  metricCard: {
    flex: 1,
    backgroundColor: DRIVER_THEME.CARD,
    borderRadius: DRIVER_RADIUS.card,
    padding: 16,
    borderWidth: 1,
    borderColor: DRIVER_THEME.BORDER,
    ...DRIVER_SHADOW,
  },
  metricLabel: {
    color: DRIVER_THEME.MUTED,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  metricValue: {
    marginTop: 8,
    fontSize: 20,
    fontWeight: "900",
  },
  footer: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: DRIVER_SPACING.screen,
    paddingTop: 16,
    paddingBottom: 18,
    backgroundColor: "rgba(248,250,252,0.98)",
    borderTopWidth: 1,
    borderTopColor: DRIVER_THEME.BORDER,
  },
  footerCompact: {
    flexDirection: "column-reverse",
  },
  footerButtonCompact: {
    width: "100%",
  },
  rejectButton: {
    flex: 1,
    minHeight: 58,
    borderRadius: DRIVER_RADIUS.button,
    backgroundColor: DRIVER_THEME.CARD,
    borderWidth: 1.5,
    borderColor: "#FCA5A5",
    alignItems: "center",
    justifyContent: "center",
  },
  rejectButtonText: {
    color: DRIVER_THEME.ERROR_TEXT,
    fontSize: 17,
    fontWeight: "900",
  },
  acceptButtonWrap: {
    flex: 1.2,
  },
  acceptButton: {
    minHeight: 58,
    borderRadius: DRIVER_RADIUS.button,
    backgroundColor: DRIVER_THEME.ORANGE,
    alignItems: "center",
    justifyContent: "center",
    ...DRIVER_SHADOW,
  },
  acceptButtonText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  buttonDisabled: {
    opacity: 0.65,
  },
});
