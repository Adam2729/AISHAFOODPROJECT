import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DriverMap from "./DriverMap";
import {
  getBusinessAddress,
  getBusinessName,
  getCurrentDeliveryStep,
  getCustomerAddress,
  getCustomerPhoneForCall,
  getDeliveryNotes,
  getDropoffLocation,
  getNextDriverAction,
  getOrderAmountToCollect,
  getOrderPaymentLabel,
  getPickupLocation,
  requiresPaymentConfirmation,
} from "../lib/driverFlow";
import {
  DRIVER_BREAKPOINTS,
  DRIVER_RADIUS,
  DRIVER_SHADOW,
  DRIVER_SPACING,
  DRIVER_THEME,
  DRIVER_TYPOGRAPHY,
} from "../lib/driverTheme";
import {
  formatCurrency,
  formatDateTime,
  getOrderCurrency,
  getOrderReference,
} from "../lib/orderUtils";

const PAYMENT_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "orange_money", label: "Orange Money" },
  { value: "wave", label: "Wave" },
  { value: "moov_money", label: "Moov Money" },
];

function StepPill({ label, state, first, last, compact = false }) {
  const isDone = state === "done";
  const isCurrent = state === "current";
  return (
    <View style={[styles.stepItem, compact ? styles.stepItemCompact : null]}>
      {!first && !compact ? (
        <View style={[styles.stepLine, isDone || isCurrent ? styles.stepLineActive : null]} />
      ) : null}
      <View
        style={[
          styles.stepDot,
          isDone ? styles.stepDotDone : null,
          isCurrent ? styles.stepDotCurrent : null,
        ]}
      >
        {isDone ? (
          <Ionicons name="checkmark" size={14} color="#FFFFFF" />
        ) : (
          <View style={styles.stepInnerDot} />
        )}
      </View>
      {!last && !compact ? (
        <View style={[styles.stepLine, isDone ? styles.stepLineActive : null]} />
      ) : null}
      <Text
        style={[
          styles.stepText,
          compact ? styles.stepTextCompact : null,
          isDone || isCurrent ? styles.stepTextActive : null,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function SurfaceCard({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function MetricPill({ label, value, accent = DRIVER_THEME.DARK }) {
  return (
    <View style={styles.metricPill}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color: accent }]}>{value}</Text>
    </View>
  );
}

function ActionRow({ icon, label, onPress, tone = "warm" }) {
  return (
    <Pressable
      style={[
        styles.secondaryAction,
        tone === "dark" ? styles.secondaryActionDark : null,
      ]}
      onPress={onPress}
    >
      <Ionicons
        name={icon}
        size={18}
        color={tone === "dark" ? "#FFFFFF" : DRIVER_THEME.ORANGE_DARK}
      />
      <Text
        style={[
          styles.secondaryActionText,
          tone === "dark" ? styles.secondaryActionTextDark : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function ActiveDeliveryScreen({
  order,
  driverLocation,
  locationPermissionDenied = false,
  incompleteWarning,
  pendingSyncCount,
  processingAction,
  message,
  error,
  weakNetworkMessage,
  onCallRestaurant,
  onCallCustomer,
  onNavigatePickup,
  onNavigateCustomer,
  onRefresh,
  onSubmitAction,
}) {
  const { width } = useWindowDimensions();
  const isCompact = width < DRIVER_BREAKPOINTS.compact;
  const isNarrow = width < DRIVER_BREAKPOINTS.narrow;
  const [deliveryOtp, setDeliveryOtp] = useState("");
  const [proofNote, setProofNote] = useState(String(order?.deliveryProof?.note || "").trim());
  const [photoUrl, setPhotoUrl] = useState(String(order?.deliveryProof?.photoUrl || "").trim());
  const [paymentMethod, setPaymentMethod] = useState(
    String(order?.dispatch?.paymentCollectionMethod || "cash").trim() || "cash"
  );
  const [paymentReference, setPaymentReference] = useState(
    String(order?.dispatch?.paymentCollectionReference || "").trim()
  );
  const [paymentNote, setPaymentNote] = useState(
    String(order?.dispatch?.paymentCollectionNote || "").trim()
  );

  useEffect(() => {
    setProofNote(String(order?.deliveryProof?.note || "").trim());
    setPhotoUrl(String(order?.deliveryProof?.photoUrl || "").trim());
    setPaymentMethod(
      String(order?.dispatch?.paymentCollectionMethod || order?.paymentSummary?.method || "cash")
        .trim() || "cash"
    );
    setPaymentReference(String(order?.dispatch?.paymentCollectionReference || "").trim());
    setPaymentNote(String(order?.dispatch?.paymentCollectionNote || "").trim());
  }, [
    order?.deliveryProof?.note,
    order?.deliveryProof?.photoUrl,
    order?.dispatch?.paymentCollectionMethod,
    order?.dispatch?.paymentCollectionReference,
    order?.dispatch?.paymentCollectionNote,
    order?.paymentSummary?.method,
  ]);

  const currentStep = useMemo(() => getCurrentDeliveryStep(order), [order]);
  const nextAction = useMemo(() => getNextDriverAction(order), [order]);
  const currency = getOrderCurrency(order);
  const amountToCollect = getOrderAmountToCollect(order);
  const orderTotal = order?.orderTotal ?? order?.total ?? null;
  const needsPayment = requiresPaymentConfirmation(order);
  const isPaidOnline =
    String(order?.paymentStatus || order?.paymentSummary?.status || "")
      .trim()
      .toLowerCase() === "paid" &&
    typeof amountToCollect === "number" &&
    amountToCollect <= 0;
  const customerPhone = getCustomerPhoneForCall(order);
  const restaurantPhone = String(order?.business?.phone || order?.contact?.businessPhone || "").trim();
  const pickupLocation = getPickupLocation(order);
  const dropoffLocation = getDropoffLocation(order);
  const liveDriverLocation = driverLocation || order?.driverLocation || null;
  const mapNavigationHandler =
    order?.dispatch?.pickupConfirmedAt || String(order?.status || "").trim().toLowerCase() === "out_for_delivery"
      ? onNavigateCustomer
      : onNavigatePickup;

  const stepStates = useMemo(() => {
    const delivered = String(order?.status || "").trim().toLowerCase() === "delivered";
    const restaurantDone = Boolean(order?.dispatch?.driverArrivedAt);
    const pickupDone = Boolean(order?.dispatch?.pickupConfirmedAt);
    const customerDone = Boolean(order?.dispatch?.arrivedAtCustomerAt);

    return [
      { label: "Restaurant", state: delivered || restaurantDone ? "done" : "current" },
      {
        label: "Pickup",
        state: delivered || pickupDone ? "done" : restaurantDone ? "current" : "pending",
      },
      {
        label: "Customer",
        state: delivered || customerDone ? "done" : pickupDone ? "current" : "pending",
      },
      {
        label: "Delivered",
        state: delivered ? "done" : customerDone ? "current" : "pending",
      },
    ];
  }, [order?.dispatch?.arrivedAtCustomerAt, order?.dispatch?.driverArrivedAt, order?.dispatch?.pickupConfirmedAt, order?.status]);

  async function handleNextAction() {
    if (!nextAction?.type || processingAction) return;

    if (nextAction.type === "payment") {
      await onSubmitAction("payment", {
        method: paymentMethod,
        provider:
          paymentMethod === "cash"
            ? "Cash"
            : PAYMENT_OPTIONS.find((item) => item.value === paymentMethod)?.label || paymentMethod,
        reference: paymentReference,
        note: paymentNote,
      });
      return;
    }

    if (nextAction.type === "delivered") {
      await onSubmitAction("delivered", {
        deliveryOtp,
        proofNote,
        photoUrl,
        proof: {
          note: proofNote,
          photoUrl,
        },
      });
      return;
    }

    await onSubmitAction(nextAction.type, {});
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.header, isCompact ? styles.headerCompact : null]}>
          <View style={styles.headerTopRow}>
            <Text style={styles.orderRef}>{getOrderReference(order)}</Text>
            <Pressable style={styles.headerRefresh} onPress={onRefresh}>
              <Ionicons name="refresh" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
          <Text style={[styles.headerTitle, isCompact ? styles.headerTitleCompact : null]}>
            {currentStep.label}
          </Text>
          <Text style={styles.headerSubtitle}>
            {currentStep.hint || "Follow each delivery checkpoint in order."}
          </Text>
        </View>

        <DriverMap
          driverLocation={liveDriverLocation}
          pickupLocation={pickupLocation}
          dropoffLocation={dropoffLocation}
          pickupLat={order?.pickupLat ?? order?.restaurant?.lat ?? null}
          pickupLng={order?.pickupLng ?? order?.restaurant?.lng ?? null}
          dropoffLat={order?.dropoffLat ?? null}
          dropoffLng={order?.dropoffLng ?? null}
          permissionDenied={locationPermissionDenied}
          onOpenExternalNavigation={mapNavigationHandler}
        />

        <SurfaceCard style={styles.progressCard}>
          <Text style={styles.sectionTitle}>Delivery progress</Text>
          <View style={[styles.progressRow, isCompact ? styles.progressRowCompact : null]}>
            {stepStates.map((step, index) => (
              <StepPill
                key={step.label}
                label={step.label}
                state={step.state}
                first={index === 0}
                last={index === stepStates.length - 1}
                compact={isCompact}
              />
            ))}
          </View>
        </SurfaceCard>

        {pendingSyncCount > 0 ? (
          <View style={styles.bannerWarning}>
            <Ionicons name="sync" size={18} color={DRIVER_THEME.WARNING_TEXT} />
            <Text style={styles.bannerWarningText}>
              {pendingSyncCount} action{pendingSyncCount > 1 ? "s" : ""} pending sync.
            </Text>
          </View>
        ) : null}

        {incompleteWarning ? (
          <View style={styles.bannerWarning}>
            <Ionicons name="alert-circle-outline" size={18} color={DRIVER_THEME.WARNING_TEXT} />
            <Text style={styles.bannerWarningText}>{incompleteWarning}</Text>
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
            <Ionicons name="alert-circle" size={18} color={DRIVER_THEME.ERROR_TEXT} />
            <Text style={styles.bannerErrorText}>{error}</Text>
          </View>
        ) : null}

        <SurfaceCard>
          <View style={styles.cardHeader}>
            <View style={styles.iconTile}>
              <Ionicons name="storefront-outline" size={20} color={DRIVER_THEME.ORANGE} />
            </View>
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardTitle}>{getBusinessName(order)}</Text>
              <Text style={styles.cardSubtitle}>Restaurant pickup</Text>
            </View>
          </View>

          <Text style={styles.addressText}>{getBusinessAddress(order)}</Text>

          <View style={[styles.actionGrid, isCompact ? styles.actionGridCompact : null]}>
            <ActionRow
              icon="navigate-outline"
              label="Open pickup"
              onPress={onNavigatePickup}
            />
            {restaurantPhone ? (
              <ActionRow
                icon="call-outline"
                label="Call restaurant"
                onPress={onCallRestaurant}
              />
            ) : null}
          </View>
        </SurfaceCard>

        <SurfaceCard>
          <View style={styles.cardHeader}>
            <View style={styles.iconTile}>
              <Ionicons name="person-outline" size={20} color={DRIVER_THEME.ORANGE} />
            </View>
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardTitle}>
                {String(order?.customer?.name || order?.customerName || "Customer")}
              </Text>
              <Text style={styles.cardSubtitle}>Drop-off</Text>
            </View>
          </View>

          <Text style={styles.addressText}>{getCustomerAddress(order)}</Text>

          <View style={styles.landmarkCard}>
            <Text style={styles.landmarkLabel}>Landmark / note</Text>
            <Text style={styles.landmarkText}>
              {getDeliveryNotes(order) || "No additional landmark provided."}
            </Text>
          </View>

          <View style={[styles.actionGrid, isCompact ? styles.actionGridCompact : null]}>
            <ActionRow
              icon="navigate-outline"
              label="Open delivery"
              onPress={onNavigateCustomer}
              tone="dark"
            />
            {customerPhone ? (
              <ActionRow
                icon="call-outline"
                label="Call customer"
                onPress={onCallCustomer}
              />
            ) : null}
          </View>
        </SurfaceCard>

        <SurfaceCard>
          <Text style={styles.sectionTitle}>Payment</Text>
          <View style={[styles.paymentMetricsRow, isCompact ? styles.paymentMetricsRowCompact : null]}>
            <MetricPill label="Amount to collect" value={formatCurrency(amountToCollect, currency)} accent={DRIVER_THEME.GREEN} />
            <MetricPill label="Method" value={getOrderPaymentLabel(order)} accent={DRIVER_THEME.ORANGE_DARK} />
          </View>
          <MetricPill label="Order total" value={formatCurrency(orderTotal, currency)} />
          {isPaidOnline ? (
            <Text style={styles.paymentHelperText}>
              Customer already paid online. No cash collection is required.
            </Text>
          ) : null}
        </SurfaceCard>

        {needsPayment ? (
          <SurfaceCard>
            <Text style={styles.sectionTitle}>Confirm payment</Text>
            <View style={styles.optionGrid}>
              {PAYMENT_OPTIONS.map((option) => (
                <Pressable
                  key={option.value}
                  style={[
                    styles.optionButton,
                    paymentMethod === option.value ? styles.optionButtonSelected : null,
                  ]}
                  onPress={() => setPaymentMethod(option.value)}
                >
                  <Text
                    style={[
                      styles.optionButtonText,
                      paymentMethod === option.value ? styles.optionButtonTextSelected : null,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={paymentReference}
              onChangeText={setPaymentReference}
              placeholder="Reference (optional)"
              placeholderTextColor="#9CA3AF"
              style={styles.input}
            />
            <TextInput
              value={paymentNote}
              onChangeText={setPaymentNote}
              placeholder="Payment note (optional)"
              placeholderTextColor="#9CA3AF"
              style={styles.input}
            />
          </SurfaceCard>
        ) : null}

        {nextAction?.type === "delivered" ? (
          <SurfaceCard>
            <Text style={styles.sectionTitle}>Complete delivery</Text>
            {order?.deliveryProof?.required !== false ? (
              <TextInput
                value={deliveryOtp}
                onChangeText={setDeliveryOtp}
                placeholder={
                  order?.deliveryProof?.otpLast4
                    ? `OTP ending in ${order.deliveryProof.otpLast4}`
                    : "Customer OTP"
                }
                placeholderTextColor="#9CA3AF"
                style={styles.input}
                keyboardType="number-pad"
              />
            ) : null}
            <TextInput
              value={proofNote}
              onChangeText={setProofNote}
              placeholder="Delivery note"
              placeholderTextColor="#9CA3AF"
              style={[styles.input, styles.multilineInput]}
              multiline
            />
            <TextInput
              value={photoUrl}
              onChangeText={setPhotoUrl}
              placeholder="Photo URL (optional)"
              placeholderTextColor="#9CA3AF"
              style={styles.input}
              autoCapitalize="none"
            />
          </SurfaceCard>
        ) : null}

        <SurfaceCard>
          <Text style={styles.sectionTitle}>Checkpoints</Text>
          <View style={[styles.checkpointRow, isNarrow ? styles.checkpointRowCompact : null]}>
            <Text style={styles.checkpointLabel}>Restaurant</Text>
            <Text style={[styles.checkpointValue, isNarrow ? styles.checkpointValueCompact : null]}>
              {formatDateTime(order?.dispatch?.driverArrivedAt)}
            </Text>
          </View>
          <View style={[styles.checkpointRow, isNarrow ? styles.checkpointRowCompact : null]}>
            <Text style={styles.checkpointLabel}>Pickup</Text>
            <Text style={[styles.checkpointValue, isNarrow ? styles.checkpointValueCompact : null]}>
              {formatDateTime(order?.dispatch?.pickupConfirmedAt)}
            </Text>
          </View>
          <View style={[styles.checkpointRow, isNarrow ? styles.checkpointRowCompact : null]}>
            <Text style={styles.checkpointLabel}>Customer</Text>
            <Text style={[styles.checkpointValue, isNarrow ? styles.checkpointValueCompact : null]}>
              {formatDateTime(order?.dispatch?.arrivedAtCustomerAt)}
            </Text>
          </View>
          <View style={[styles.checkpointRow, isNarrow ? styles.checkpointRowCompact : null]}>
            <Text style={styles.checkpointLabel}>Payment</Text>
            <Text style={[styles.checkpointValue, isNarrow ? styles.checkpointValueCompact : null]}>
              {formatDateTime(order?.dispatch?.paymentCollectedAt)}
            </Text>
          </View>
        </SurfaceCard>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.refreshButton} onPress={onRefresh}>
          <Ionicons name="refresh-outline" size={18} color={DRIVER_THEME.ORANGE_DARK} />
          <Text style={styles.refreshButtonText}>Refresh active order</Text>
        </Pressable>
        {nextAction ? (
          <Pressable
            style={[styles.primaryCta, processingAction ? styles.buttonDisabled : null]}
            disabled={Boolean(processingAction)}
            onPress={handleNextAction}
          >
            {processingAction ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryCtaText}>{String(nextAction.label || "").toUpperCase()}</Text>
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: DRIVER_THEME.BACKGROUND,
  },
  content: {
    padding: DRIVER_SPACING.screen,
    paddingBottom: 210,
    gap: DRIVER_SPACING.section,
  },
  header: {
    backgroundColor: DRIVER_THEME.ORANGE,
    borderRadius: DRIVER_RADIUS.cardLarge,
    padding: DRIVER_SPACING.card,
    gap: 10,
    ...DRIVER_SHADOW,
  },
  headerCompact: {
    paddingBottom: 16,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  orderRef: {
    color: "#FFF4EC",
    fontSize: DRIVER_TYPOGRAPHY.caption,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  headerRefresh: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: DRIVER_TYPOGRAPHY.hero,
    fontWeight: "900",
  },
  headerTitleCompact: {
    fontSize: 26,
    lineHeight: 30,
  },
  headerSubtitle: {
    color: "#FFF4EC",
    fontSize: DRIVER_TYPOGRAPHY.body,
    lineHeight: 21,
  },
  progressCard: {
    gap: 14,
  },
  card: {
    backgroundColor: DRIVER_THEME.CARD,
    borderRadius: DRIVER_RADIUS.cardLarge,
    padding: DRIVER_SPACING.card,
    borderWidth: 1,
    borderColor: DRIVER_THEME.BORDER,
    gap: 12,
    ...DRIVER_SHADOW,
  },
  sectionTitle: {
    color: DRIVER_THEME.DARK,
    fontSize: DRIVER_TYPOGRAPHY.section,
    fontWeight: "900",
  },
  progressRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 4,
  },
  progressRowCompact: {
    flexWrap: "wrap",
    justifyContent: "flex-start",
    gap: 10,
  },
  stepItem: {
    flex: 1,
    alignItems: "center",
    gap: 8,
  },
  stepItemCompact: {
    flexBasis: "47%",
    flexGrow: 0,
    flexShrink: 0,
  },
  stepLine: {
    position: "absolute",
    top: 13,
    left: "-50%",
    right: "50%",
    height: 2,
    backgroundColor: DRIVER_THEME.BORDER,
  },
  stepLineActive: {
    backgroundColor: DRIVER_THEME.ORANGE,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: DRIVER_RADIUS.pill,
    borderWidth: 2,
    borderColor: DRIVER_THEME.BORDER,
    backgroundColor: DRIVER_THEME.CARD,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotDone: {
    backgroundColor: DRIVER_THEME.ORANGE,
    borderColor: DRIVER_THEME.ORANGE,
  },
  stepDotCurrent: {
    borderColor: DRIVER_THEME.ORANGE,
  },
  stepInnerDot: {
    width: 10,
    height: 10,
    borderRadius: DRIVER_RADIUS.pill,
    backgroundColor: DRIVER_THEME.ORANGE,
  },
  stepText: {
    color: DRIVER_THEME.MUTED,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  stepTextCompact: {
    fontSize: 12,
  },
  stepTextActive: {
    color: DRIVER_THEME.DARK,
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
  bannerNeutral: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: DRIVER_THEME.CARD,
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
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: DRIVER_THEME.ORANGE_LIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  cardHeaderText: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    color: DRIVER_THEME.DARK,
    fontSize: DRIVER_TYPOGRAPHY.title,
    fontWeight: "900",
  },
  cardSubtitle: {
    color: DRIVER_THEME.MUTED,
    fontSize: 13,
    fontWeight: "700",
  },
  addressText: {
    color: DRIVER_THEME.MUTED_DARK,
    fontSize: DRIVER_TYPOGRAPHY.body,
    lineHeight: 21,
  },
  landmarkCard: {
    backgroundColor: DRIVER_THEME.SURFACE_ALT,
    borderRadius: DRIVER_RADIUS.card,
    padding: 12,
    gap: 6,
  },
  landmarkLabel: {
    color: DRIVER_THEME.ORANGE_DARK,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  landmarkText: {
    color: DRIVER_THEME.MUTED_DARK,
    fontSize: 14,
    lineHeight: 20,
  },
  actionGrid: {
    flexDirection: "row",
    gap: 10,
  },
  actionGridCompact: {
    flexDirection: "column",
  },
  secondaryAction: {
    flex: 1,
    minHeight: 50,
    borderRadius: DRIVER_RADIUS.button,
    backgroundColor: DRIVER_THEME.SURFACE_ALT,
    borderWidth: 1,
    borderColor: DRIVER_THEME.BORDER_WARM,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
  },
  secondaryActionDark: {
    backgroundColor: DRIVER_THEME.DARK,
    borderColor: DRIVER_THEME.DARK,
  },
  secondaryActionText: {
    color: DRIVER_THEME.ORANGE_DARK,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  secondaryActionTextDark: {
    color: "#FFFFFF",
  },
  paymentMetricsRow: {
    flexDirection: "row",
    gap: 12,
  },
  paymentMetricsRowCompact: {
    flexDirection: "column",
  },
  metricPill: {
    flex: 1,
    backgroundColor: DRIVER_THEME.BACKGROUND,
    borderRadius: DRIVER_RADIUS.card,
    padding: 14,
    gap: 6,
  },
  metricLabel: {
    color: DRIVER_THEME.MUTED,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  metricValue: {
    fontSize: 20,
    fontWeight: "900",
  },
  paymentHelperText: {
    color: DRIVER_THEME.SUCCESS_TEXT,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  optionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionButton: {
    borderWidth: 1,
    borderColor: DRIVER_THEME.BORDER,
    borderRadius: DRIVER_RADIUS.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: DRIVER_THEME.CARD,
  },
  optionButtonSelected: {
    backgroundColor: DRIVER_THEME.ORANGE,
    borderColor: DRIVER_THEME.ORANGE,
  },
  optionButtonText: {
    color: DRIVER_THEME.MUTED_DARK,
    fontWeight: "800",
  },
  optionButtonTextSelected: {
    color: "#FFFFFF",
  },
  input: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: DRIVER_THEME.BORDER,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: DRIVER_THEME.DARK,
    fontSize: 15,
    backgroundColor: DRIVER_THEME.CARD,
  },
  multilineInput: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  checkpointRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 4,
  },
  checkpointRowCompact: {
    alignItems: "flex-start",
    flexDirection: "column",
    gap: 4,
  },
  checkpointLabel: {
    color: DRIVER_THEME.MUTED,
    fontSize: 14,
    fontWeight: "700",
  },
  checkpointValue: {
    flex: 1,
    textAlign: "right",
    color: DRIVER_THEME.MUTED_DARK,
    fontSize: 14,
    fontWeight: "700",
  },
  checkpointValueCompact: {
    flex: 0,
    textAlign: "left",
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: DRIVER_SPACING.screen,
    paddingTop: 14,
    paddingBottom: 18,
    gap: 10,
    backgroundColor: "rgba(248,250,252,0.98)",
    borderTopWidth: 1,
    borderTopColor: DRIVER_THEME.BORDER,
  },
  refreshButton: {
    minHeight: 48,
    borderRadius: DRIVER_RADIUS.button,
    backgroundColor: DRIVER_THEME.CARD,
    borderWidth: 1,
    borderColor: DRIVER_THEME.BORDER_WARM,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  refreshButtonText: {
    color: DRIVER_THEME.ORANGE_DARK,
    fontWeight: "900",
  },
  primaryCta: {
    minHeight: 62,
    borderRadius: DRIVER_RADIUS.button,
    backgroundColor: DRIVER_THEME.ORANGE,
    alignItems: "center",
    justifyContent: "center",
    ...DRIVER_SHADOW,
  },
  primaryCtaText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
});
