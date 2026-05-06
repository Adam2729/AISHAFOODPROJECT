import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import ActiveDeliveryScreen from "../components/ActiveDeliveryScreen";
import DriverHomeScreen from "../components/DriverHomeScreen";
import OrderRequestModal from "../components/OrderRequestModal";
import { useAuth } from "../lib/auth";
import {
  acceptDriverOrder,
  confirmDriverPayment,
  deliverDriverOrder,
  fetchActiveDriverOrder,
  fetchCurrentDriverOffer,
  fetchDriverEarnings,
  goDriverOffline,
  goDriverOnline,
  markDriverArrivedAtCustomer,
  markDriverArrivedAtRestaurant,
  markDriverOnTheWay,
  markDriverPickedUp,
  rejectDriverOrder,
  sendDriverLocation,
  syncDriverActions,
  timeoutDriverOffer,
  updateDriverStatus,
} from "../lib/api";
import {
  getDisplayDriverName,
  getDriverAvailabilityLabel,
  getOfflineSavedMessage,
  getWeakNetworkMessage,
} from "../lib/driverFlow";
import {
  startDriverLocationTracking,
  stopDriverLocationTracking,
} from "../lib/location";
import {
  getPendingDriverActions,
  isRetryableDriverActionError,
  queuePendingDriverAction,
  removePendingDriverActions,
  shouldDropPendingSyncResult,
  subscribePendingDriverActions,
} from "../lib/offlineSync";
import { clearOfferNotificationMarker, announceIncomingOffer } from "../lib/offerNotifications";
import { getDriverPollingInterval } from "../lib/orderEvents";
import { formatCurrency } from "../lib/orderUtils";
import { useFocusedPolling } from "../lib/polling";

function isDriverOnline(availability) {
  const value = String(availability || "offline").trim().toLowerCase();
  return value === "available" || value === "busy" || value === "paused";
}

function buildPendingActionFingerprint(orderId, action, payload = {}) {
  return `${String(orderId || "").trim()}:${String(action || "").trim()}:${JSON.stringify(
    payload || {}
  )}`;
}

function readDriverId(driverProfile) {
  return String(driverProfile?.id || driverProfile?._id || "").trim();
}

function readActiveOrderId(order) {
  return String(order?.orderId || order?.id || order?._id || "").trim();
}

function readAssignedDriverId(order) {
  return String(
    order?.assignedDriverId ||
      order?.driverId ||
      order?.driver?.id ||
      order?.dispatch?.assignedDriverId ||
      ""
  ).trim();
}

function readCurrentOfferDriverId(order) {
  return String(order?.currentOfferDriverId || order?.dispatch?.currentOfferDriverId || "").trim();
}

function readOrderStatus(order) {
  return String(order?.status || "").trim().toLowerCase();
}

function isValidCurrentOffer(offer) {
  if (!offer || typeof offer !== "object") {
    return false;
  }

  if (!readActiveOrderId(offer)) {
    return false;
  }

  if (offer?.deliveryMode && String(offer.deliveryMode).trim().toLowerCase() !== "platform_driver") {
    return false;
  }

  const hasRestaurant = Boolean(
    String(offer?.restaurantName || offer?.businessName || offer?.pickupAddress || "").trim()
  );
  const hasCustomer = Boolean(
    String(offer?.customerAddress || offer?.customerArea || "").trim()
  );

  if (!hasRestaurant || !hasCustomer) {
    return false;
  }

  const expiresAt = offer?.offerExpiresAt ? new Date(offer.offerExpiresAt).getTime() : NaN;
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    return false;
  }

  return true;
}

function getActiveOrderPresentationData(order) {
  const restaurantName = String(
    order?.restaurantName ||
      order?.restaurant?.name ||
      order?.businessName ||
      order?.business?.name ||
      ""
  ).trim();
  const pickupAddress = String(
    order?.pickupAddress ||
      order?.pickup?.address ||
      order?.business?.address ||
      ""
  ).trim();
  const customerName = String(
    order?.customerName ||
      order?.customer?.name ||
      ""
  ).trim();
  const deliveryAddress = String(
    order?.dropoffAddress ||
      order?.dropoff?.address ||
      order?.deliveryAddress ||
      order?.address ||
      order?.customer?.address ||
      ""
  ).trim();

  const missingFields = [];
  if (!restaurantName) missingFields.push("restaurant");
  if (!pickupAddress) missingFields.push("pickup address");
  if (!customerName) missingFields.push("customer");
  if (!deliveryAddress) missingFields.push("delivery address");

  return {
    restaurantName,
    pickupAddress,
    customerName,
    deliveryAddress,
    missingFields,
  };
}

function getIncompleteActiveOrderWarning(order) {
  if (!order || typeof order !== "object") {
    return "";
  }

  const missingFields = Array.isArray(order?.dataIntegrity?.missingFields)
    ? order.dataIntegrity.missingFields
    : getActiveOrderPresentationData(order).missingFields;

  if (!missingFields.length) {
    return "";
  }

  return "Order data incomplete. Refresh or contact support.";
}

function getInvalidActiveOrderReason(order, driverProfile) {
  if (!order) {
    return "";
  }

  if (typeof order !== "object") {
    return "The active order payload is invalid.";
  }

  if (!readActiveOrderId(order)) {
    return "The active order payload is missing its order id.";
  }

  if (order?.deliveryMode && String(order.deliveryMode).trim().toLowerCase() !== "platform_driver") {
    return "The active order is not a platform-driver delivery.";
  }

  const status = readOrderStatus(order);
  if (!status) {
    return "The active order payload is missing its status.";
  }
  if (["delivered", "cancelled", "canceled", "completed"].includes(status)) {
    return "The active order is already finished.";
  }

  const driverId = readDriverId(driverProfile);
  const assignedDriverId = readAssignedDriverId(order);
  const currentOfferDriverId = readCurrentOfferDriverId(order);
  if (driverId && assignedDriverId && driverId !== assignedDriverId) {
    return "The active order belongs to a different driver.";
  }
  if (driverId && currentOfferDriverId && driverId !== currentOfferDriverId) {
    return "The active order is currently offered to a different driver.";
  }
  if (!assignedDriverId && currentOfferDriverId) {
    return "The order is still waiting for offer acceptance.";
  }

  return "";
}

function isValidActiveOrder(order, driverProfile) {
  return !getInvalidActiveOrderReason(order, driverProfile);
}

export default function HomeScreen({ navigation }) {
  const { driver, refreshProfile } = useAuth();
  const [currentOffer, setCurrentOffer] = useState(null);
  const [offerCountdown, setOfferCountdown] = useState(0);
  const [activeOrder, setActiveOrder] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);
  const [earnings, setEarnings] = useState(null);
  const [pendingActions, setPendingActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState("");
  const [processingOffer, setProcessingOffer] = useState("");
  const [processingAction, setProcessingAction] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [weakNetworkMessage, setWeakNetworkMessage] = useState("");
  const [staleOrderMessage, setStaleOrderMessage] = useState("");
  const activeOfferAttemptRef = useRef("");
  const timingOutOfferRef = useRef(false);
  const driverRef = useRef(driver);
  const activeOrderRef = useRef(activeOrder);
  const currentOfferRef = useRef(currentOffer);
  const pendingActionCountRef = useRef(0);
  const lastLocationSyncAtRef = useRef(0);

  useEffect(() => {
    driverRef.current = driver;
  }, [driver]);

  useEffect(() => {
    activeOrderRef.current = activeOrder;
  }, [activeOrder]);

  useEffect(() => {
    currentOfferRef.current = currentOffer;
  }, [currentOffer]);

  useEffect(() => {
    pendingActionCountRef.current = pendingActions.length;
  }, [pendingActions.length]);

  const hasValidActiveOrder = useMemo(
    () => isValidActiveOrder(activeOrder, driver),
    [activeOrder, driver]
  );
  const displayActiveOrder = hasValidActiveOrder ? activeOrder : null;
  const displayActiveOrderId = useMemo(
    () => (displayActiveOrder ? readActiveOrderId(displayActiveOrder) : ""),
    [displayActiveOrder]
  );
  const activeOrderWarning = useMemo(
    () => getIncompleteActiveOrderWarning(displayActiveOrder),
    [displayActiveOrder]
  );
  const isOnline = useMemo(() => isDriverOnline(driver?.availability), [driver?.availability]);
  const isPaused = useMemo(
    () => String(driver?.availability || "").trim().toLowerCase() === "paused",
    [driver?.availability]
  );
  const shouldTrackLocation = isOnline || hasValidActiveOrder;
  const pollIntervalMs = useMemo(
    () =>
      getDriverPollingInterval({
        currentOffer,
        activeOrder: displayActiveOrder,
        isOnline,
        weakNetwork: Boolean(weakNetworkMessage),
        hasPendingSync: pendingActions.length > 0,
      }),
    [currentOffer, displayActiveOrder, isOnline, pendingActions.length, weakNetworkMessage]
  );

  const applyOffer = useCallback(async (offer, { silent = false } = {}) => {
    const nextOffer = isValidCurrentOffer(offer) ? offer : null;
    const nextAttemptId = String(nextOffer?.attemptId || "").trim();
    const previousAttemptId = activeOfferAttemptRef.current;

    activeOfferAttemptRef.current = nextAttemptId;
    setCurrentOffer(nextOffer);
    setOfferCountdown(Math.max(0, Number(nextOffer?.countdownSeconds || 0)));

    if (nextOffer && nextAttemptId && nextAttemptId !== previousAttemptId) {
      await announceIncomingOffer(nextOffer).catch(() => null);
      if (!silent) {
        setMessage("Nouvelle commande recue.");
      }
    }

    if (!nextOffer && previousAttemptId) {
      clearOfferNotificationMarker(previousAttemptId);
      if (!silent) {
        setMessage("This order is no longer available.");
      }
    }
  }, []);

  const flushPendingActions = useCallback(
    async ({ silent = true } = {}) => {
      const queued = await getPendingDriverActions();
      if (!queued.length) {
        return { syncedCount: 0, failedCount: 0, results: [] };
      }

      try {
        const response = await syncDriverActions(
          queued.map((item) => ({
            syncId: item.syncId,
            orderId: item.orderId,
            action: item.action,
            payload: item.payload,
          }))
        );

        const removableSyncIds = (Array.isArray(response?.results) ? response.results : [])
          .filter(shouldDropPendingSyncResult)
          .map((item) => String(item?.syncId || "").trim())
          .filter(Boolean);

        if (removableSyncIds.length) {
          await removePendingDriverActions(removableSyncIds);
        }

        if (Number(response?.failedCount || 0) > 0) {
          setWeakNetworkMessage(getWeakNetworkMessage());
          const firstDroppedFailure = (Array.isArray(response?.results) ? response.results : []).find(
            (item) => !item?.ok && shouldDropPendingSyncResult(item)
          );
          if (!silent && firstDroppedFailure?.error?.message) {
            setMessage(firstDroppedFailure.error.message);
          }
        } else if (Number(response?.syncedCount || 0) > 0) {
          setWeakNetworkMessage("");
          if (!silent) {
            setMessage("Actions synchronisees.");
          }
        }

        return response;
      } catch (requestError) {
        if (isRetryableDriverActionError(requestError)) {
          setWeakNetworkMessage(getWeakNetworkMessage());
          return null;
        }
        throw requestError;
      }
    },
    []
  );

  const loadDashboard = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setLoading(true);
        setError("");
      }

      try {
        if (pendingActionCountRef.current) {
          await flushPendingActions({ silent: true });
        }

        const latestDriver = await refreshProfile();
        const liveAvailability = String(
          latestDriver?.availability || driverRef.current?.availability || "offline"
        )
          .trim()
          .toLowerCase();
        const shouldFetchLiveData =
          liveAvailability !== "offline" ||
          pendingActionCountRef.current > 0 ||
          Boolean(activeOrderRef.current) ||
          Boolean(currentOfferRef.current);

        const [nextActiveOrder, nextOffer, nextEarnings] = await Promise.all([
          shouldFetchLiveData ? fetchActiveDriverOrder().catch(() => null) : Promise.resolve(null),
          shouldFetchLiveData ? fetchCurrentDriverOffer().catch(() => null) : Promise.resolve(null),
          fetchDriverEarnings().catch(() => null),
        ]);
        const invalidActiveOrderReason = nextActiveOrder
          ? getInvalidActiveOrderReason(nextActiveOrder, latestDriver || driverRef.current)
          : "";
        const validActiveOrder = invalidActiveOrderReason ? null : nextActiveOrder;

        setActiveOrder(validActiveOrder);
        setEarnings(nextEarnings || null);
        setWeakNetworkMessage("");
        setStaleOrderMessage(invalidActiveOrderReason);

        if (validActiveOrder) {
          await applyOffer(null, { silent: true });
        } else {
          await applyOffer(nextOffer, { silent });
        }
      } catch (requestError) {
        if (isRetryableDriverActionError(requestError)) {
          setWeakNetworkMessage(getWeakNetworkMessage());
        }
        if (!silent) {
          setError(requestError?.message || "Impossible de charger votre tableau de bord.");
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [
      applyOffer,
      flushPendingActions,
      refreshProfile,
    ]
  );

  const queueOfflineAction = useCallback(async (actionInput) => {
    await queuePendingDriverAction({
      ...actionInput,
      fingerprint:
        actionInput?.fingerprint ||
        buildPendingActionFingerprint(actionInput?.orderId, actionInput?.action, actionInput?.payload),
    });
    setWeakNetworkMessage(getWeakNetworkMessage());
    setMessage(getOfflineSavedMessage());
  }, []);

  const clearStaleActiveOrder = useCallback(async () => {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const nextActiveOrder = await fetchActiveDriverOrder();
      const invalidActiveOrderReason = nextActiveOrder
        ? getInvalidActiveOrderReason(nextActiveOrder, driverRef.current)
        : "";

      if (nextActiveOrder && !invalidActiveOrderReason) {
        setActiveOrder(nextActiveOrder);
        setStaleOrderMessage("");
        setMessage("Backend still confirms an active order.");
        return;
      }

      if (invalidActiveOrderReason) {
        setActiveOrder(null);
        setStaleOrderMessage(invalidActiveOrderReason);
        setMessage("Active order mismatch persists. Refresh or contact support.");
        return;
      }

      setActiveOrder(null);
      setStaleOrderMessage("");
      setMessage("Retour a l'ecran d'attente.");
      await loadDashboard({ silent: true });
    } catch (requestError) {
      setError(requestError?.message || "Impossible de verifier la commande active.");
    } finally {
      setLoading(false);
    }
  }, [loadDashboard]);

  const handleStatusChange = useCallback(
    async (nextStatus, options = {}) => {
      if (savingStatus) return;

      setSavingStatus(nextStatus);
      setError("");
      setMessage("");

      try {
        if (nextStatus === "online") {
          await goDriverOnline();
        } else if (nextStatus === "offline") {
          await goDriverOffline();
        } else {
          await updateDriverStatus(nextStatus, options);
        }

        await loadDashboard({ silent: true });
        setMessage(
          nextStatus === "online"
            ? "Vous etes maintenant en ligne."
            : nextStatus === "offline"
            ? "Vous etes hors ligne."
            : "Pause active."
        );
      } catch (requestError) {
        setError(requestError?.message || "Impossible de mettre a jour votre disponibilite.");
      } finally {
        setSavingStatus("");
      }
    },
    [loadDashboard, savingStatus]
  );

  const handleAcceptOffer = useCallback(async () => {
    if (!currentOffer?.orderId || processingOffer) return;

    setProcessingOffer("accept");
    setError("");
    setMessage("");

    try {
      await acceptDriverOrder(currentOffer.orderId);
      clearOfferNotificationMarker(currentOffer?.attemptId || currentOffer?.orderId || "");
      await applyOffer(null, { silent: true });
      const nextActiveOrder = await fetchActiveDriverOrder().catch(() => null);
      if (isValidActiveOrder(nextActiveOrder, driver)) {
        setActiveOrder(nextActiveOrder);
        setStaleOrderMessage("");
      } else {
        setActiveOrder(null);
        setStaleOrderMessage(
          nextActiveOrder ? getInvalidActiveOrderReason(nextActiveOrder, driver) : ""
        );
      }
      await loadDashboard({ silent: true });
      setMessage("Commande acceptee. Dirigez-vous vers le retrait.");
    } catch (requestError) {
      if (isRetryableDriverActionError(requestError)) {
        await queueOfflineAction({
          orderId: currentOffer.orderId,
          action: "accept",
          payload: {},
          fingerprint: buildPendingActionFingerprint(currentOffer.orderId, "accept", {
            attemptId: currentOffer?.attemptId || "",
          }),
        });
        clearOfferNotificationMarker(currentOffer?.attemptId || currentOffer?.orderId || "");
        await applyOffer(null, { silent: true });
      } else {
        setError(requestError?.message || "Impossible d'accepter cette commande.");
      }
    } finally {
      setProcessingOffer("");
    }
  }, [applyOffer, currentOffer, driver, loadDashboard, processingOffer, queueOfflineAction]);

  const handleRejectOffer = useCallback(async () => {
    if (!currentOffer?.orderId || processingOffer) return;

    setProcessingOffer("reject");
    setError("");
    setMessage("");

    try {
      await rejectDriverOrder(currentOffer.orderId, { reason: "driver_rejected_offer" });
      clearOfferNotificationMarker(currentOffer?.attemptId || currentOffer?.orderId || "");
      await applyOffer(null, { silent: true });
      await loadDashboard({ silent: true });
      setMessage("Offre refusee.");
    } catch (requestError) {
      if (isRetryableDriverActionError(requestError)) {
        await queueOfflineAction({
          orderId: currentOffer.orderId,
          action: "reject",
          payload: { reason: "driver_rejected_offer" },
          fingerprint: buildPendingActionFingerprint(currentOffer.orderId, "reject", {
            attemptId: currentOffer?.attemptId || "",
          }),
        });
        clearOfferNotificationMarker(currentOffer?.attemptId || currentOffer?.orderId || "");
        await applyOffer(null, { silent: true });
      } else {
        setError(requestError?.message || "Impossible de refuser cette commande.");
      }
    } finally {
      setProcessingOffer("");
    }
  }, [applyOffer, currentOffer, loadDashboard, processingOffer, queueOfflineAction]);

  const handleOfferTimeout = useCallback(async () => {
    if (!currentOffer?.orderId || timingOutOfferRef.current) return;
    timingOutOfferRef.current = true;

    try {
      await timeoutDriverOffer(currentOffer.orderId);
    } catch (requestError) {
      if (isRetryableDriverActionError(requestError)) {
        await queueOfflineAction({
          orderId: currentOffer.orderId,
          action: "offer_timeout",
          payload: {},
          fingerprint: buildPendingActionFingerprint(currentOffer.orderId, "offer_timeout", {
            attemptId: currentOffer?.attemptId || "",
          }),
        });
      }
    } finally {
      clearOfferNotificationMarker(currentOffer?.attemptId || currentOffer?.orderId || "");
      await applyOffer(null, { silent: true });
      timingOutOfferRef.current = false;
      loadDashboard({ silent: true }).catch(() => null);
    }
  }, [applyOffer, currentOffer, loadDashboard, queueOfflineAction]);

  const handleActiveOrderAction = useCallback(
    async (action, payload = {}) => {
      if (processingAction) return;
      if (!displayActiveOrderId) {
        setActiveOrder(null);
        setStaleOrderMessage(
          activeOrder
            ? getInvalidActiveOrderReason(activeOrder, driver) || "The active order is no longer valid."
            : ""
        );
        return;
      }

      setProcessingAction(action);
      setError("");
      setMessage("");

      const orderId = displayActiveOrderId;
      const actionMap = {
        arrived_restaurant: () => markDriverArrivedAtRestaurant(orderId),
        picked_up: () => markDriverPickedUp(orderId),
        on_the_way: () => markDriverOnTheWay(orderId),
        arrived_customer: () => markDriverArrivedAtCustomer(orderId),
        payment: () => confirmDriverPayment(orderId, payload),
        delivered: () => deliverDriverOrder(orderId, payload),
      };

      try {
        const run = actionMap[action];
        if (!run) {
          throw new Error("Unsupported delivery action.");
        }
        await run();
        await loadDashboard({ silent: true });
        setMessage(
          action === "arrived_restaurant"
            ? "Arrivee au restaurant confirmee."
            : action === "picked_up"
            ? "Commande recuperee."
            : action === "on_the_way"
            ? "Trajet vers le client en cours."
            : action === "arrived_customer"
            ? "Arrivee chez le client confirmee."
            : action === "payment"
            ? "Paiement confirme."
            : action === "delivered"
            ? "Livraison terminee."
            : "Action enregistree."
        );
      } catch (requestError) {
        if (isRetryableDriverActionError(requestError)) {
          await queueOfflineAction({
            orderId,
            action,
            payload,
          });
          if (action === "delivered") {
            setMessage("Saved offline. Delivery will finish when sync returns.");
          }
        } else {
          setError(requestError?.message || "Impossible d'enregistrer cette etape.");
        }
      } finally {
        setProcessingAction("");
      }
    },
    [activeOrder, displayActiveOrderId, driver, loadDashboard, processingAction, queueOfflineAction]
  );

  const handleCallPhone = useCallback(async (phone) => {
    const cleaned = String(phone || "").trim();
    if (!cleaned) return;
    try {
      await Linking.openURL(`tel:${cleaned}`);
    } catch {
      setError("Impossible d'ouvrir l'appel.");
    }
  }, []);

  const handleOpenNavigation = useCallback(async (target) => {
    const latitude = Number(target?.latitude ?? target?.lat);
    const longitude = Number(target?.longitude ?? target?.lng);
    const address = String(target?.address || target?.label || "").trim();
    const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude);

    if (!hasCoords && !address) {
      setError("Adresse de navigation indisponible.");
      return;
    }

    try {
      const destination = hasCoords
        ? `${latitude},${longitude}`
        : encodeURIComponent(address);
      await Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${destination}`);
    } catch {
      setError("Impossible d'ouvrir la navigation.");
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    getPendingDriverActions()
      .then((rows) => {
        if (mounted) {
          setPendingActions(Array.isArray(rows) ? rows : []);
        }
      })
      .catch(() => null);

    const unsubscribe = subscribePendingDriverActions((rows) => {
      setPendingActions(Array.isArray(rows) ? rows : []);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        loadDashboard({ silent: true }).catch(() => null);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [loadDashboard]);

  useFocusEffect(
    useCallback(() => {
      loadDashboard({ silent: false }).catch(() => null);
      return undefined;
    }, [loadDashboard])
  );

  useFocusedPolling(() => loadDashboard({ silent: true }), {
    intervalMs: pollIntervalMs,
    enabled:
      isValidCurrentOffer(currentOffer) ||
      hasValidActiveOrder ||
      pendingActions.length > 0 ||
      isOnline,
  });

  useEffect(() => {
    let isMounted = true;
    let subscription = null;

    if (!shouldTrackLocation) {
      setLocationPermissionDenied(false);
      return undefined;
    }

    startDriverLocationTracking({
      timeInterval: hasValidActiveOrder ? 10000 : 15000,
      distanceInterval: hasValidActiveOrder ? 30 : 60,
      onUpdate: (coords) => {
        if (!isMounted || !coords) {
          return;
        }

        setDriverLocation(coords);
        setLocationPermissionDenied(false);

        const now = Date.now();
        if (now - lastLocationSyncAtRef.current < 10000) {
          return;
        }
        lastLocationSyncAtRef.current = now;

        sendDriverLocation(coords).catch(() => null);
      },
    })
      .then((result) => {
        if (!isMounted) {
          stopDriverLocationTracking(result?.subscription);
          return;
        }

        subscription = result?.subscription || null;
        if (result?.permissionDenied) {
          setLocationPermissionDenied(true);
        }
      })
      .catch(() => {
        if (isMounted) {
          setLocationPermissionDenied(false);
        }
      });

    return () => {
      isMounted = false;
      stopDriverLocationTracking(subscription);
    };
  }, [shouldTrackLocation]);

  useEffect(() => {
    if (!currentOffer?.offerExpiresAt) return undefined;

    const timer = setInterval(() => {
      const remainingSeconds = Math.max(
        0,
        Math.ceil((new Date(currentOffer.offerExpiresAt).getTime() - Date.now()) / 1000)
      );
      setOfferCountdown(remainingSeconds);
      if (remainingSeconds <= 0) {
        clearInterval(timer);
        handleOfferTimeout().catch(() => null);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [currentOffer, handleOfferTimeout]);

  const driverName = useMemo(() => getDisplayDriverName(driver), [driver]);
  const availabilityLabel = useMemo(() => getDriverAvailabilityLabel(driver), [driver]);

  useEffect(() => {
    if (!activeOrder || hasValidActiveOrder) {
      return;
    }

    setActiveOrder(null);
    setStaleOrderMessage(
      getInvalidActiveOrderReason(activeOrder, driver) || "The active order is no longer valid."
    );
  }, [activeOrder, driver, hasValidActiveOrder]);

  const todayEarningsLabel = useMemo(() => {
    return formatCurrency(
      Number(earnings?.totalEarnings || earnings?.pendingAmount || 0),
      String(earnings?.currency || "CFA")
    );
  }, [earnings?.currency, earnings?.pendingAmount, earnings?.totalEarnings]);
  const completedDeliveries = Number(
    earnings?.completedOrders || earnings?.deliveredCount || 0
  );
  const pendingSyncCount = pendingActions.length;
  if (currentOffer) {
    return (
      <OrderRequestModal
        offer={currentOffer}
        countdownSeconds={offerCountdown}
        processingState={processingOffer}
        message={message}
        error={error}
        weakNetworkMessage={weakNetworkMessage}
        onAccept={handleAcceptOffer}
        onReject={handleRejectOffer}
      />
    );
  }

  if (displayActiveOrder) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["bottom"]}>
        <ActiveDeliveryScreen
          order={displayActiveOrder}
          incompleteWarning={activeOrderWarning}
          pendingSyncCount={pendingSyncCount}
          processingAction={processingAction}
          message={message}
          error={error}
          weakNetworkMessage={weakNetworkMessage}
          driverLocation={driverLocation}
          locationPermissionDenied={locationPermissionDenied}
          onCallRestaurant={() =>
            handleCallPhone(
              displayActiveOrder?.business?.phone || displayActiveOrder?.contact?.businessPhone
            )
          }
          onCallCustomer={() =>
            handleCallPhone(
              displayActiveOrder?.contact?.customerPhone ||
                displayActiveOrder?.customerPhone ||
                displayActiveOrder?.customer?.phone
            )
          }
          onNavigatePickup={() =>
            handleOpenNavigation({
              latitude:
                displayActiveOrder?.pickupLat ??
                displayActiveOrder?.restaurant?.lat ??
                displayActiveOrder?.pickupLocation?.lat ??
                displayActiveOrder?.pickupLocation?.latitude,
              longitude:
                displayActiveOrder?.pickupLng ??
                displayActiveOrder?.restaurant?.lng ??
                displayActiveOrder?.pickupLocation?.lng ??
                displayActiveOrder?.pickupLocation?.longitude,
              address:
                displayActiveOrder?.pickup?.address ||
                displayActiveOrder?.business?.address ||
                displayActiveOrder?.businessName,
              label: displayActiveOrder?.businessName,
            })
          }
          onNavigateCustomer={() =>
            handleOpenNavigation({
              latitude:
                displayActiveOrder?.dropoffLat ??
                displayActiveOrder?.dropoffLocation?.lat ??
                displayActiveOrder?.dropoffLocation?.latitude,
              longitude:
                displayActiveOrder?.dropoffLng ??
                displayActiveOrder?.dropoffLocation?.lng ??
                displayActiveOrder?.dropoffLocation?.longitude,
              address:
                displayActiveOrder?.dropoff?.address ||
                displayActiveOrder?.customer?.address ||
                displayActiveOrder?.address,
              label: displayActiveOrder?.customerName,
            })
          }
          onRefresh={() => loadDashboard({ silent: false })}
          onSubmitAction={handleActiveOrderAction}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom"]}>
      <DriverHomeScreen
        driverName={driverName}
        availabilityLabel={availabilityLabel}
        isOnline={isOnline}
        isPaused={isPaused}
        todayEarningsLabel={todayEarningsLabel}
        completedDeliveries={completedDeliveries}
        assignedCount={0}
        pendingSyncCount={pendingSyncCount}
        message={message}
        error={error}
        weakNetworkMessage={weakNetworkMessage}
        loading={loading}
        savingStatus={savingStatus}
        staleOrderMessage={staleOrderMessage}
        onGoOnline={() => handleStatusChange("online")}
        onGoOffline={() => handleStatusChange("offline")}
        onPause={() => handleStatusChange("paused", { reason: "break" })}
        onOpenEarnings={() => navigation.navigate("Earnings")}
        onOpenProfile={() => navigation.navigate("Profile")}
        onClearStaleOrder={clearStaleActiveOrder}
        onRetry={() => loadDashboard({ silent: false })}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FFF7ED",
  },
});
