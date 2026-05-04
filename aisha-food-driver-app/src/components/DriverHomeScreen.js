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
import {
  DRIVER_BREAKPOINTS,
  DRIVER_RADIUS,
  DRIVER_SHADOW,
  DRIVER_SPACING,
  DRIVER_THEME,
  DRIVER_TYPOGRAPHY,
} from "../lib/driverTheme";

function StatCard({ icon, label, value, accent = DRIVER_THEME.ORANGE, compact = false }) {
  return (
    <View style={[styles.statCard, compact ? styles.statCardCompact : null]}>
      <View style={[styles.statIcon, { backgroundColor: `${accent}14` }]}>
        <Ionicons name={icon} size={18} color={accent} />
      </View>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function QuickLink({ icon, title, subtitle, onPress }) {
  return (
    <Pressable style={styles.quickLink} onPress={onPress}>
      <View style={styles.quickLinkIcon}>
        <Ionicons name={icon} size={20} color={DRIVER_THEME.ORANGE} />
      </View>
      <View style={styles.quickLinkText}>
        <Text style={styles.quickLinkTitle}>{title}</Text>
        <Text style={styles.quickLinkSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={DRIVER_THEME.MUTED} />
    </Pressable>
  );
}

export default function DriverHomeScreen({
  driverName,
  availabilityLabel,
  isOnline,
  isPaused,
  todayEarningsLabel,
  completedDeliveries,
  assignedCount = 0,
  pendingSyncCount,
  message,
  error,
  weakNetworkMessage,
  loading,
  savingStatus,
  staleOrderMessage,
  onGoOnline,
  onGoOffline,
  onPause,
  onOpenEarnings,
  onOpenProfile,
  onClearStaleOrder,
  onRetry,
}) {
  const pulse = useRef(new Animated.Value(0.7)).current;
  const { width } = useWindowDimensions();
  const isCompact = width < DRIVER_BREAKPOINTS.compact;
  const isNarrow = width < DRIVER_BREAKPOINTS.narrow;

  useEffect(() => {
    if (!isOnline || isPaused) {
      pulse.stopAnimation();
      pulse.setValue(0.7);
      return undefined;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.7,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [isOnline, isPaused, pulse]);

  const headerStatus = useMemo(() => {
    if (isPaused) return "Pause";
    return isOnline ? "Online" : "Offline";
  }, [isOnline, isPaused]);

  const headerStatusColor = isPaused
    ? DRIVER_THEME.DARK
    : isOnline
    ? DRIVER_THEME.GREEN
    : DRIVER_THEME.ORANGE;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.heroCard}>
        <View style={[styles.heroTopRow, isCompact ? styles.heroTopRowCompact : null]}>
          <View>
            <Text style={styles.heroEyebrow}>OranjeEats Driver</Text>
            <Text style={[styles.heroTitle, isCompact ? styles.heroTitleCompact : null]}>
              Bonjour, {driverName}
            </Text>
          </View>
          <View
            style={[
              styles.statusPill,
              isCompact ? styles.statusPillCompact : null,
              { backgroundColor: headerStatusColor },
            ]}
          >
            <Text style={styles.statusPillText}>{headerStatus}</Text>
          </View>
        </View>

        <View style={styles.heroInfoRow}>
          <View style={styles.heroInfoItem}>
            <Ionicons name="radio" size={18} color="#FFFFFF" />
            <Text style={styles.heroInfoText}>{availabilityLabel}</Text>
          </View>
          <View style={styles.heroInfoItem}>
            <Ionicons name="cellular" size={18} color="#FFFFFF" />
            <Text style={styles.heroInfoText}>Low network ready</Text>
          </View>
        </View>

        <Text style={styles.heroSubtitle}>
          {isOnline
            ? isPaused
              ? "Votre pause est active. Les commandes en cours restent accessibles."
              : "Vous etes en ligne et pret pour les commandes proches."
            : "Passez en ligne pour recevoir les commandes platform-driver autour de vous."}
        </Text>

        <View style={[styles.heroActions, isCompact ? styles.heroActionsCompact : null]}>
          <Pressable
            style={[
              styles.heroPrimaryButton,
              isCompact ? styles.heroPrimaryButtonCompact : null,
              isOnline ? styles.heroDarkButton : null,
              savingStatus && styles.buttonDisabled,
            ]}
            disabled={Boolean(savingStatus)}
            onPress={isOnline ? onGoOffline : onGoOnline}
          >
            <Text
              style={[
                styles.heroPrimaryButtonText,
                isOnline ? styles.heroDarkButtonText : null,
              ]}
            >
              {savingStatus
                ? "Mise a jour..."
                : isOnline
                ? "Go Offline"
                : "Go Online"}
            </Text>
          </Pressable>
        </View>

      </View>

      {pendingSyncCount > 0 ? (
        <View style={styles.bannerWarning}>
          <Ionicons name="sync" size={18} color={DRIVER_THEME.WARNING_TEXT} />
          <View style={styles.bannerBody}>
            <Text style={styles.bannerTitle}>Sync pending</Text>
            <Text style={styles.bannerText}>
              {pendingSyncCount} action{pendingSyncCount > 1 ? "s" : ""} en attente.
            </Text>
          </View>
        </View>
      ) : null}

      {weakNetworkMessage ? (
        <View style={styles.bannerNeutral}>
          <Ionicons name="cloud-offline-outline" size={18} color={DRIVER_THEME.MUTED_DARK} />
          <Text style={styles.bannerNeutralText}>{weakNetworkMessage}</Text>
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
          <View style={styles.bannerBody}>
            <Text style={styles.bannerTitleError}>{error}</Text>
          </View>
          {onRetry ? (
            <Pressable style={styles.retryButton} onPress={onRetry}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {staleOrderMessage ? (
        <View style={styles.bannerNeutralAction}>
          <View style={styles.bannerBody}>
            <Text style={styles.bannerNeutralActionTitle}>Active order not confirmed</Text>
            <Text style={styles.bannerNeutralActionText}>{staleOrderMessage}</Text>
          </View>
          {onClearStaleOrder ? (
            <Pressable style={styles.retryButton} onPress={onClearStaleOrder}>
              <Text style={styles.retryButtonText}>Back to waiting</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.waitingCard}>
        <View style={[styles.waitingHeader, isCompact ? styles.waitingHeaderCompact : null]}>
          <View style={styles.waitingHeaderText}>
            <Text style={[styles.waitingTitle, isCompact ? styles.waitingTitleCompact : null]}>
              {isOnline ? "You are online" : "Driver offline"}
            </Text>
            <Text style={styles.waitingSubtitle}>
              {isOnline
                ? isPaused
                  ? "Pause active. Reprenez quand vous etes pret."
                  : "Waiting for nearby orders"
                : "Go online to receive nearby platform-driver orders."}
            </Text>
          </View>
          <View style={styles.waitingIndicator}>
            {isOnline && !isPaused ? (
              <Animated.View
                style={[
                  styles.waitingPulse,
                  {
                    transform: [{ scale: pulse }],
                    opacity: pulse,
                  },
                ]}
              />
            ) : (
              <View style={[styles.waitingPulse, styles.waitingPulseStatic]} />
            )}
          </View>
        </View>

        <View style={[styles.waitingStatusRow, isNarrow ? styles.waitingStatusRowCompact : null]}>
          <View style={styles.waitingStatusItem}>
            <Ionicons
              name={loading ? "sync" : isOnline ? "checkmark-circle" : "power"}
              size={18}
              color={loading ? DRIVER_THEME.ORANGE : isOnline ? DRIVER_THEME.GREEN : DRIVER_THEME.MUTED}
            />
            <Text style={styles.waitingStatusText}>
              {loading
                ? "Actualisation en cours..."
                : isOnline
                ? isPaused
                  ? "Paused"
                  : "Low network ready"
                : "Offline"}
            </Text>
          </View>
          {loading ? <ActivityIndicator color={DRIVER_THEME.ORANGE} style={styles.waitingSpinner} /> : null}
        </View>

        {isOnline && !isPaused ? (
          <Pressable
            style={[styles.pauseButton, savingStatus === "paused" && styles.buttonDisabled]}
            disabled={Boolean(savingStatus)}
            onPress={onPause}
          >
            <Ionicons name="pause-circle-outline" size={18} color={DRIVER_THEME.DARK} />
            <Text style={styles.pauseButtonText}>
              {savingStatus === "paused" ? "Activation..." : "Pause"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.statsRow, isCompact ? styles.statsRowCompact : null]}>
        <StatCard
          icon="wallet-outline"
          label="Today earnings"
          value={todayEarningsLabel}
          compact={isCompact}
        />
        <StatCard
          icon="checkmark-done-circle-outline"
          label="Completed"
          value={completedDeliveries}
          accent={DRIVER_THEME.GREEN}
          compact={isCompact}
        />
        <StatCard
          icon="bag-handle-outline"
          label="Assigned"
          value={assignedCount}
          accent={DRIVER_THEME.DARK}
          compact={isCompact}
        />
      </View>

      <View style={styles.bottomNavCard}>
        <QuickLink
          icon="cash-outline"
          title="Gains"
          subtitle="Resume des revenus"
          onPress={onOpenEarnings}
        />
        <QuickLink
          icon="person-circle-outline"
          title="Profil"
          subtitle="Compte et deconnexion"
          onPress={onOpenProfile}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: DRIVER_SPACING.screen,
    paddingBottom: 32,
    gap: DRIVER_SPACING.section,
    backgroundColor: DRIVER_THEME.BACKGROUND,
  },
  heroCard: {
    backgroundColor: DRIVER_THEME.ORANGE,
    borderRadius: DRIVER_RADIUS.cardLarge,
    padding: DRIVER_SPACING.card,
    gap: 16,
    ...DRIVER_SHADOW,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  heroTopRowCompact: {
    flexDirection: "column",
    alignItems: "flex-start",
  },
  heroEyebrow: {
    color: "#FFE7D6",
    fontSize: DRIVER_TYPOGRAPHY.caption,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  heroTitle: {
    marginTop: 6,
    color: "#FFFFFF",
    fontSize: DRIVER_TYPOGRAPHY.hero,
    fontWeight: "900",
  },
  heroTitleCompact: {
    fontSize: 28,
    lineHeight: 32,
  },
  statusPill: {
    borderRadius: DRIVER_RADIUS.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  statusPillCompact: {
    alignSelf: "flex-start",
  },
  statusPillText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  heroInfoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  heroInfoItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  heroInfoText: {
    color: "#FFF7ED",
    fontSize: 14,
    fontWeight: "700",
  },
  heroSubtitle: {
    color: "#FFF7ED",
    fontSize: DRIVER_TYPOGRAPHY.body,
    lineHeight: 22,
  },
  heroActions: {
    flexDirection: "row",
    gap: 12,
  },
  heroActionsCompact: {
    flexDirection: "column",
  },
  heroPrimaryButton: {
    flex: 1,
    minHeight: 58,
    borderRadius: DRIVER_RADIUS.button,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
  },
  heroPrimaryButtonCompact: {
    width: "100%",
  },
  heroPrimaryButtonText: {
    color: DRIVER_THEME.ORANGE,
    fontSize: 17,
    fontWeight: "900",
  },
  heroDarkButton: {
    backgroundColor: DRIVER_THEME.DARK,
  },
  heroDarkButtonText: {
    color: "#FFFFFF",
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  bannerWarning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: DRIVER_THEME.WARNING_BG,
    borderRadius: DRIVER_RADIUS.card,
    padding: 14,
    borderWidth: 1,
    borderColor: DRIVER_THEME.BORDER_WARM,
  },
  bannerNeutral: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: DRIVER_THEME.SURFACE,
    borderRadius: DRIVER_RADIUS.card,
    padding: 14,
    borderWidth: 1,
    borderColor: DRIVER_THEME.BORDER,
  },
  bannerNeutralText: {
    flex: 1,
    color: DRIVER_THEME.MUTED_DARK,
    fontSize: 14,
    lineHeight: 19,
  },
  bannerNeutralAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: DRIVER_THEME.SURFACE,
    borderRadius: DRIVER_RADIUS.card,
    padding: 14,
    borderWidth: 1,
    borderColor: DRIVER_THEME.BORDER,
  },
  bannerNeutralActionTitle: {
    color: DRIVER_THEME.DARK,
    fontSize: 14,
    fontWeight: "900",
  },
  bannerNeutralActionText: {
    color: DRIVER_THEME.MUTED_DARK,
    fontSize: 13,
    lineHeight: 18,
  },
  bannerSuccess: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: DRIVER_THEME.SUCCESS_BG,
    borderRadius: DRIVER_RADIUS.card,
    padding: 14,
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  bannerSuccessText: {
    flex: 1,
    color: DRIVER_THEME.SUCCESS_TEXT,
    fontWeight: "700",
  },
  bannerError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: DRIVER_THEME.ERROR_BG,
    borderRadius: DRIVER_RADIUS.card,
    padding: 14,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  bannerBody: {
    flex: 1,
    gap: 2,
  },
  bannerTitle: {
    color: DRIVER_THEME.WARNING_TEXT,
    fontWeight: "900",
    fontSize: 14,
  },
  bannerText: {
    color: DRIVER_THEME.WARNING_TEXT,
    fontSize: 13,
    lineHeight: 18,
  },
  bannerTitleError: {
    color: DRIVER_THEME.ERROR_TEXT,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "700",
  },
  retryButton: {
    borderRadius: DRIVER_RADIUS.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#FFFFFF",
  },
  retryButtonText: {
    color: DRIVER_THEME.ERROR_TEXT,
    fontWeight: "900",
  },
  statsRow: {
    flexDirection: "row",
    gap: 12,
  },
  statsRowCompact: {
    flexWrap: "wrap",
  },
  statCard: {
    flex: 1,
    minHeight: 118,
    backgroundColor: DRIVER_THEME.SURFACE,
    borderRadius: DRIVER_RADIUS.card,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: DRIVER_THEME.BORDER,
    ...DRIVER_SHADOW,
  },
  statCardCompact: {
    minWidth: "47%",
  },
  waitingCard: {
    backgroundColor: DRIVER_THEME.CARD,
    borderRadius: DRIVER_RADIUS.cardLarge,
    padding: DRIVER_SPACING.card,
    gap: 16,
    borderWidth: 1,
    borderColor: DRIVER_THEME.BORDER,
    ...DRIVER_SHADOW,
  },
  waitingHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  waitingHeaderCompact: {
    flexDirection: "column",
    alignItems: "flex-start",
  },
  waitingHeaderText: {
    flex: 1,
  },
  waitingIndicator: {
    minWidth: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  waitingTitle: {
    color: DRIVER_THEME.DARK,
    fontSize: DRIVER_TYPOGRAPHY.title,
    fontWeight: "900",
  },
  waitingTitleCompact: {
    fontSize: 20,
  },
  waitingSubtitle: {
    marginTop: 6,
    color: DRIVER_THEME.MUTED,
    fontSize: DRIVER_TYPOGRAPHY.body,
    lineHeight: 21,
  },
  waitingPulse: {
    width: 18,
    height: 18,
    borderRadius: DRIVER_RADIUS.pill,
    backgroundColor: DRIVER_THEME.ORANGE,
    shadowColor: DRIVER_THEME.ORANGE,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 3,
  },
  waitingPulseStatic: {
    opacity: 0.35,
    backgroundColor: DRIVER_THEME.MUTED,
  },
  waitingStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  waitingStatusRowCompact: {
    flexDirection: "column",
    alignItems: "flex-start",
  },
  waitingStatusItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  waitingStatusText: {
    color: DRIVER_THEME.MUTED_DARK,
    fontSize: 14,
    fontWeight: "700",
  },
  waitingSpinner: {
    alignSelf: "center",
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: DRIVER_RADIUS.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  statLabel: {
    color: DRIVER_THEME.MUTED,
    fontSize: 12,
    fontWeight: "700",
  },
  statValue: {
    color: DRIVER_THEME.DARK,
    fontSize: 22,
    fontWeight: "900",
  },
  pauseButton: {
    minHeight: 48,
    borderRadius: DRIVER_RADIUS.button,
    backgroundColor: DRIVER_THEME.SURFACE_ALT,
    borderWidth: 1,
    borderColor: DRIVER_THEME.BORDER_WARM,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  pauseButtonText: {
    color: DRIVER_THEME.DARK,
    fontWeight: "900",
  },
  bottomNavCard: {
    backgroundColor: DRIVER_THEME.SURFACE,
    borderRadius: DRIVER_RADIUS.cardLarge,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: DRIVER_THEME.BORDER,
    ...DRIVER_SHADOW,
  },
  quickLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 18,
    backgroundColor: DRIVER_THEME.BACKGROUND,
  },
  quickLinkIcon: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: DRIVER_THEME.ORANGE_LIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  quickLinkText: {
    flex: 1,
    gap: 2,
  },
  quickLinkTitle: {
    color: DRIVER_THEME.DARK,
    fontSize: 16,
    fontWeight: "900",
  },
  quickLinkSubtitle: {
    color: DRIVER_THEME.MUTED,
    fontSize: 13,
    lineHeight: 18,
  },
});
