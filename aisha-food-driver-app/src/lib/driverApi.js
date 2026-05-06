import axios from "axios";
import { API_BASE_URL, API_CONFIG_ERROR } from "./config";
import { clearAuthSession, getAccessToken } from "./tokenStorage";

const REQUEST_TIMEOUT_MS = 15000;

const DRIVER_API_PATHS = {
  login: "/api/driver/auth/login",
  signup: "/api/public/driver-applications",
  orders: "/api/driver/orders",
  activeOrder: "/api/driver/orders/active",
  currentOffer: "/api/driver/orders/current-offer",
  orderDetails: (orderId) => `/api/driver/orders/${encodeURIComponent(orderId)}`,
  orderAccept: (orderId) => `/api/driver/orders/${encodeURIComponent(orderId)}/accept`,
  orderReject: (orderId) => `/api/driver/orders/${encodeURIComponent(orderId)}/reject`,
  orderOfferTimeout: (orderId) =>
    `/api/driver/orders/${encodeURIComponent(orderId)}/offer-timeout`,
  orderArrivedRestaurant: (orderId) =>
    `/api/driver/orders/${encodeURIComponent(orderId)}/arrived-restaurant`,
  orderPickedUp: (orderId) => `/api/driver/orders/${encodeURIComponent(orderId)}/picked-up`,
  orderOnTheWay: (orderId) => `/api/driver/orders/${encodeURIComponent(orderId)}/on-the-way`,
  orderArrivedCustomer: (orderId) =>
    `/api/driver/orders/${encodeURIComponent(orderId)}/arrived-customer`,
  orderPayment: (orderId) => `/api/driver/orders/${encodeURIComponent(orderId)}/payment`,
  orderDelivered: (orderId) => `/api/driver/orders/${encodeURIComponent(orderId)}/delivered`,
  orderSync: (orderId) => `/api/driver/orders/${encodeURIComponent(orderId)}/sync`,
  sync: "/api/driver/sync",
  orderStatus: (orderId) => `/api/driver/orders/${encodeURIComponent(orderId)}/status`,
  orderProof: (orderId) => `/api/driver/orders/${encodeURIComponent(orderId)}/proof`,
  orderException: (orderId) => `/api/driver/orders/${encodeURIComponent(orderId)}/exception`,
  location: "/api/driver/location",
  earnings: "/api/driver/earnings",
  payouts: "/api/driver/payouts",
  requestPayout: "/api/driver/payouts/request",
  profile: "/api/driver/profile",
  status: "/api/driver/status",
  online: "/api/driver/online",
  offline: "/api/driver/offline",
  pushToken: "/api/driver/push-token",
};

function createAppError(message, code = "REQUEST_ERROR", status) {
  const error = new Error(String(message || "Request failed"));
  error.code = code;
  if (typeof status === "number") error.status = status;
  return error;
}

function ensureConfiguredBaseUrl() {
  if (!API_BASE_URL) {
    throw createAppError(API_CONFIG_ERROR, "CONFIG_ERROR");
  }
}

function readPayload(response) {
  const data = response?.data;
  if (data && typeof data === "object" && "data" in data && data.data != null) {
    return data.data;
  }
  return data;
}

function normalizeRequestError(error, fallbackMessage) {
  if (error?.code === "CONFIG_ERROR") {
    return error;
  }

  const status = error?.response?.status;
  const payload = error?.response?.data;
  if (status === 401) {
    clearAuthSession().catch(() => null);
  }
  const message =
    payload?.error?.message ||
    payload?.error ||
    payload?.message ||
    error?.message ||
    (status === 401 ? "Your driver session expired. Please sign in again." : fallbackMessage);

  if (error?.code === "ECONNABORTED") {
    return createAppError("The request timed out. Please try again.", "TIMEOUT_ERROR", status);
  }

  return createAppError(message, status ? "API_ERROR" : "NETWORK_ERROR", status);
}

function extractDriver(payload) {
  if (!payload || typeof payload !== "object") return null;
  return payload.driver || payload.user || payload.profile || payload.account || null;
}

function extractAccessToken(payload) {
  if (!payload || typeof payload !== "object") return "";
  return String(
    payload.accessToken ||
      payload.token ||
      payload.authToken ||
      payload.session?.accessToken ||
      ""
  ).trim();
}

function extractRefreshToken(payload) {
  if (!payload || typeof payload !== "object") return null;
  const refreshToken = String(payload.refreshToken || payload.session?.refreshToken || "").trim();
  return refreshToken || null;
}

function extractOrders(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.orders)) return payload.orders;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function extractSingleOrder(payload) {
  if (!payload || typeof payload !== "object") return payload || null;
  return payload.order || payload.item || payload;
}

function extractEarnings(payload) {
  if (!payload || typeof payload !== "object") return payload || {};
  return payload.summary || payload.earnings || payload;
}

function extractDriverStatus(payload) {
  if (!payload || typeof payload !== "object") return payload || {};
  if (payload.driverStatus && typeof payload.driverStatus === "object") return payload.driverStatus;
  return payload;
}

function firstText(candidates, fallback = "") {
  for (const value of candidates) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return fallback;
}

function firstNumber(candidates, fallback = 0) {
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return fallback;
}

function firstNumberOrNull(candidates) {
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function normalizeLocation(location) {
  if (!location || typeof location !== "object") return null;
  const latitude = Number(location.latitude ?? location.lat);
  const longitude = Number(location.longitude ?? location.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    ...location,
    latitude,
    longitude,
    lat: latitude,
    lng: longitude,
    accuracy: location.accuracy ?? null,
    heading: location.heading ?? null,
    speed: location.speed ?? null,
    updatedAt: location.updatedAt || null,
  };
}

function normalizeGeoPoint(location) {
  if (!location || typeof location !== "object") return null;

  if (Array.isArray(location.coordinates) && location.coordinates.length >= 2) {
    const longitude = Number(location.coordinates[0]);
    const latitude = Number(location.coordinates[1]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return {
        latitude,
        longitude,
        lat: latitude,
        lng: longitude,
      };
    }
  }

  return normalizeLocation(location);
}

function uniqueTextList(values) {
  const seen = new Set();
  const result = [];

  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
  }

  return result;
}

function normalizeDriverOrder(order) {
  if (!order || typeof order !== "object") return null;

  const id = firstText([order.id, order._id, order.orderId]);
  const deliveryMode = firstText([order.deliveryMode, order.deliverySnapshot?.mode], "platform_driver");
  const assignedDriverId = firstText([
    order.assignedDriverId,
    order.dispatch?.assignedDriverId,
  ]);
  const currentOfferDriverId = firstText([
    order.currentOfferDriverId,
    order.dispatch?.currentOfferDriverId,
  ]);
  const assignmentType = firstText(
    [order.assignmentType],
    assignedDriverId ? "assigned" : currentOfferDriverId ? "offered" : "available"
  );
  const publicOrderCode = firstText([
    order.publicOrderCode,
    order.orderNumber,
    order.reference,
    order.code,
  ]);
  const restaurantName = firstText([
    order.restaurantName,
    order.businessName,
    order.business?.name,
    order.merchant?.name,
  ]);
  const restaurantPhone = firstText([
    order.restaurantPhone,
    order.business?.phone,
    order.contact?.businessPhone,
  ]);
  const pickupAddress = firstText([
    order.pickupAddress,
    order.pickup?.address,
    order.business?.address,
    order.merchant?.address,
  ]);
  const customerName = firstText([order.customerName, order.customer?.name]);
  const customerPhone = firstText([order.customerPhone, order.customer?.phone, order.phone]);
  const deliveryAddress = firstText([
    order.deliveryAddress,
    order.dropoffAddress,
    order.dropoff?.address,
    order.address,
    order.customer?.address,
  ]);
  const dropoffAddress = firstText([order.dropoffAddress, order.dropoff?.address, deliveryAddress]);
  const deliveryNote = firstText([
    order.deliveryNote,
    order.notes,
    order.dispatch?.handoffNote,
    order.dispatch?.paymentCollectionNote,
  ]);
  const landmark = firstText([order.landmark, order.notes]);
  const paymentMethod = firstText([
    order.paymentMethod,
    order.paymentSummary?.method,
    order.payment?.method,
  ], "cash");
  const paymentStatus = firstText([
    order.paymentStatus,
    order.paymentSummary?.status,
    order.payment?.status,
  ], "pending");
  const orderTotal = firstNumberOrNull([
    order.orderTotal,
    order.total,
    order.totals?.total,
    order.payment?.amount,
  ]);
  const amountToCollect = firstNumberOrNull([order.amountToCollect]);
  const currency = firstText([order.currency, order.totals?.currency], "CFA");
  const dispatch = order.dispatch && typeof order.dispatch === "object" ? order.dispatch : {};
  const deliveryProof = order.deliveryProof && typeof order.deliveryProof === "object"
    ? order.deliveryProof
    : {};
  const deliveryException =
    order.deliveryException && typeof order.deliveryException === "object"
      ? order.deliveryException
      : null;
  const routeBatch =
    order.routeBatch && typeof order.routeBatch === "object" ? order.routeBatch : {};
  const contact = order.contact && typeof order.contact === "object" ? order.contact : {};
  const business = order.business && typeof order.business === "object" ? order.business : {};
  const support = order.support && typeof order.support === "object" ? order.support : {};
  const driverLocation = normalizeLocation(order.driverLocation || order.driver?.lastLocation);
  const explicitPickupLocation = normalizeGeoPoint({
    lat: order.pickupLat ?? order.restaurant?.lat,
    lng: order.pickupLng ?? order.restaurant?.lng,
  });
  const pickupLocation = normalizeGeoPoint(
    explicitPickupLocation ||
      order.pickup?.location ||
      order.pickupLocation ||
      order.restaurant?.location ||
      order.business?.location
  );
  const explicitDropoffLocation = normalizeGeoPoint({
    lat: order.dropoffLat,
    lng: order.dropoffLng,
  });
  const dropoffLocation = normalizeGeoPoint(
    explicitDropoffLocation ||
      order.dropoff?.location ||
      order.customer?.location ||
      order.deliveryAddressLocation ||
      order.dropoffLocation
  );
  const missingFields = uniqueTextList([
    ...(Array.isArray(order?.dataIntegrity?.missingFields) ? order.dataIntegrity.missingFields : []),
    !restaurantName ? "restaurant" : "",
    !pickupAddress ? "pickup_address" : "",
    !customerName ? "customer" : "",
    !deliveryAddress ? "delivery_address" : "",
  ]);
  const isIncomplete =
    Boolean(order?.dataIntegrity?.isIncomplete) || missingFields.length > 0;

  return {
    ...order,
    id,
    orderId: id,
    publicOrderCode: publicOrderCode || null,
    orderNumber: publicOrderCode || id,
    deliveryMode,
    assignmentType,
    assignedDriverId: assignedDriverId || null,
    currentOfferDriverId: currentOfferDriverId || null,
    assignedAt: order.assignedAt || order.dispatch?.assignedAt || null,
    canAccept: Boolean(order.canAccept ?? (assignmentType === "offered")),
    offerExpiresAt: order.offerExpiresAt || order.dispatch?.offerExpiresAt || null,
    estimatedDistanceKm: firstNumber(
      [order.estimatedDistanceKm, order.dispatch?.currentOfferDistanceKm],
      0
    ),
    estimatedEarning: firstNumber(
      [
        order.estimatedEarning,
        order.riderPayoutExpectedAtOrderTime,
        order.deliveryFeeToCustomer,
      ],
      0
    ),
    restaurantName: restaurantName || null,
    restaurantPhone: restaurantPhone || null,
    pickupAddress: pickupAddress || null,
    customerName: customerName || null,
    customerPhone: customerPhone || null,
    deliveryAddress: deliveryAddress || null,
    dropoffAddress: dropoffAddress || null,
    deliveryNote: deliveryNote || null,
    landmark: landmark || null,
    businessName: restaurantName || null,
    business: {
      ...business,
      name: restaurantName || null,
      phone: restaurantPhone || null,
      whatsapp: firstText([business.whatsapp, contact.businessWhatsApp]) || null,
      address: pickupAddress || null,
    },
    address: deliveryAddress || null,
    pickup: {
      ...(order.pickup || {}),
      address: pickupAddress || null,
      location: pickupLocation,
    },
    dropoff: {
      ...(order.dropoff || {}),
      address: dropoffAddress || null,
      location: dropoffLocation,
    },
    customer: {
      ...(order.customer || {}),
      name: customerName || null,
      phone: customerPhone || null,
      address: deliveryAddress || null,
      location: dropoffLocation,
    },
    total: orderTotal,
    orderTotal,
    currency,
    totals: {
      ...(order.totals || {}),
      total: orderTotal,
      currency,
    },
    paymentSummary: order.paymentSummary || {
      method: paymentMethod,
      status: paymentStatus,
      provider: firstText([order.payment?.provider, dispatch?.paymentCollectionProvider]) || null,
      reference:
        firstText([order.payment?.reference, dispatch?.paymentCollectionReference]) || null,
    },
    paymentMethod,
    paymentStatus,
    amountToCollect,
    contact: {
      ...contact,
      customerName: customerName || null,
      customerPhone: customerPhone || null,
      businessName: restaurantName || null,
      businessPhone: restaurantPhone || null,
      businessWhatsApp: firstText([contact.businessWhatsApp, business.whatsapp]),
      supportWhatsApp: firstText([contact.supportWhatsApp, support.whatsapp]),
      supportText: firstText([contact.supportText, support.defaultText]),
    },
    support: {
      ...support,
      whatsapp: firstText([support.whatsapp, contact.supportWhatsApp]),
      defaultText: firstText([support.defaultText, contact.supportText]),
    },
    driverLocation,
    pickupLocation,
    dropoffLocation,
    pickupLat: pickupLocation?.lat ?? null,
    pickupLng: pickupLocation?.lng ?? null,
    dropoffLat: dropoffLocation?.lat ?? null,
    dropoffLng: dropoffLocation?.lng ?? null,
    restaurant: {
      name: restaurantName || null,
      phone: restaurantPhone || null,
      address: pickupAddress || null,
      location: pickupLocation,
      lat: pickupLocation?.lat ?? null,
      lng: pickupLocation?.lng ?? null,
    },
    dispatch: {
      ...dispatch,
      driverDispatchStatus: firstText([dispatch?.driverDispatchStatus]) || null,
      assignedDriverId: firstText([dispatch?.assignedDriverId]) || null,
      assignedDriverName: firstText([dispatch?.assignedDriverName]) || null,
      assignedAt: dispatch?.assignedAt || null,
      currentOfferDriverId: firstText([dispatch?.currentOfferDriverId]) || null,
      currentOfferAttemptId: firstText([dispatch?.currentOfferAttemptId]) || null,
      currentOfferSentAt: dispatch?.currentOfferSentAt || null,
      offerExpiresAt: dispatch?.offerExpiresAt || null,
      currentOfferDistanceKm: firstNumberOrNull([dispatch?.currentOfferDistanceKm]),
      driverArrivedAt: order?.driverArrivedAt || dispatch?.driverArrivedAt || null,
      pickupConfirmedAt: order?.pickupConfirmedAt || dispatch?.pickupConfirmedAt || null,
      arrivedAtCustomerAt: order?.arrivedAtCustomerAt || dispatch?.arrivedAtCustomerAt || null,
      paymentCollectedAt: order?.paymentCollectedAt || dispatch?.paymentCollectedAt || null,
      paymentCollectionMethod: firstText([dispatch?.paymentCollectionMethod]) || null,
      paymentCollectionProvider: firstText([dispatch?.paymentCollectionProvider]) || null,
      paymentCollectionReference: firstText([dispatch?.paymentCollectionReference]) || null,
      paymentCollectionNote: firstText([dispatch?.paymentCollectionNote]) || null,
      deliveredConfirmedAt: dispatch?.deliveredConfirmedAt || null,
      cashCollectedByDriver: Boolean(dispatch?.cashCollectedByDriver),
      handoffNote: firstText([dispatch?.handoffNote]) || null,
      routeBatchId: firstText([dispatch?.routeBatchId]) || null,
      routeSequence:
        dispatch?.routeSequence == null ? null : Number(dispatch.routeSequence),
      currentStopIndex:
        dispatch?.currentStopIndex == null ? null : Number(dispatch.currentStopIndex),
    },
    deliveryProof: {
      ...deliveryProof,
      required: deliveryProof.required !== false,
      otpLast4: firstText([deliveryProof.otpLast4]) || null,
      verifiedAt: deliveryProof.verifiedAt || null,
      note: firstText([deliveryProof.note]) || null,
      photoUrl: firstText([deliveryProof.photoUrl]) || null,
      capturedAt: deliveryProof.capturedAt || null,
      capturedByDriverId: firstText([deliveryProof.capturedByDriverId]) || null,
    },
    deliveryException: deliveryException
      ? {
          ...deliveryException,
          reason: firstText([deliveryException.reason]) || null,
          note: firstText([deliveryException.note]) || null,
          reportedAt: deliveryException.reportedAt || null,
          reportedByDriverId: firstText([deliveryException.reportedByDriverId]) || null,
          status: firstText([deliveryException.status], "open"),
        }
      : null,
    routeBatch: {
      batchId: firstText([routeBatch.batchId, order.dispatch?.routeBatchId]) || null,
      sequence:
        routeBatch.sequence ?? order.dispatch?.routeSequence ?? null,
      currentStopIndex:
        routeBatch.currentStopIndex ?? order.dispatch?.currentStopIndex ?? null,
    },
    itemsSummary: Array.isArray(order.itemsSummary) ? order.itemsSummary : [],
    dataIntegrity: {
      missingFields,
      isIncomplete,
    },
    isIncomplete,
  };
}

function normalizeDriverOrders(orders) {
  return (Array.isArray(orders) ? orders : [])
    .map(normalizeDriverOrder)
    .filter((order) => order && order.deliveryMode === "platform_driver");
}

function normalizeDriverOffer(offer) {
  if (!offer || typeof offer !== "object") return null;

  return {
    ...offer,
    orderId: firstText([offer.orderId, offer.id, offer._id]),
    orderNumber: firstText([offer.orderNumber, offer.code]),
    restaurantName: firstText([offer.restaurantName, offer.businessName], "Restaurant"),
    businessName: firstText([offer.businessName, offer.restaurantName], "Restaurant"),
    pickupAddress: firstText([offer.pickupAddress, offer.restaurantAddress]),
    customerAddress: firstText([offer.customerAddress, offer.address]),
    customerArea: firstText([offer.customerArea]) || null,
    deliveryNotes: firstText([offer.deliveryNotes, offer.notes]) || null,
    estimatedDistanceKm: firstNumber([offer.estimatedDistanceKm], 0),
    estimatedEarning: firstNumber([offer.estimatedEarning], 0),
    orderTotal: firstNumber([offer.orderTotal], 0),
    paymentMethod: firstText([offer.paymentMethod], "cash"),
    paymentStatus: firstText([offer.paymentStatus], "pending"),
    paymentProvider: firstText([offer.paymentProvider]) || null,
    amountToCollect: firstNumber([offer.amountToCollect], 0),
    currency: firstText([offer.currency], "CFA"),
    offerExpiresAt: offer.offerExpiresAt || null,
    countdownSeconds: firstNumber([offer.countdownSeconds], 0),
    attemptId: firstText([offer.attemptId]) || null,
    canAccept: Boolean(offer.canAccept ?? true),
  };
}

function normalizeDriverProfile(payload) {
  const driver = extractDriver(payload);
  if (!driver || typeof driver !== "object") return null;
  const city = payload?.city || driver.city || null;

  return {
    ...driver,
    id: firstText([driver.id, driver._id]),
    name: firstText([driver.name, driver.fullName, driver.displayName], "Driver"),
    phone: firstText([driver.phone, driver.phoneE164]),
    email: firstText([driver.email]),
    vehicleType: firstText([driver.vehicleType, driver.vehicle?.type]),
    status: firstText([driver.status], "active"),
    accountStatus: firstText([driver.accountStatus, driver.status], "active"),
    availability: firstText([driver.availability], "offline"),
    eligibleForAvailableOrders: Boolean(driver.eligibleForAvailableOrders),
    breakStartedAt: driver.breakStartedAt || null,
    breakReason: firstText([driver.breakReason]) || null,
    breakNote: firstText([driver.breakNote]) || null,
    lastLocation: normalizeLocation(driver.lastLocation),
    city,
  };
}

function normalizeDriverStatus(payload) {
  const raw = extractDriverStatus(payload);
  return {
    ...(raw || {}),
    status: firstText([raw?.status], "offline"),
    availability: firstText([raw?.availability], "offline"),
    accountStatus: firstText([raw?.accountStatus], "active"),
    eligibleForAvailableOrders: Boolean(raw?.eligibleForAvailableOrders),
    activeOrdersCount: firstNumber([raw?.activeOrdersCount]),
    breakStartedAt: raw?.breakStartedAt || null,
    breakReason: firstText([raw?.breakReason]) || null,
    breakNote: firstText([raw?.breakNote]) || null,
    lastLocation: normalizeLocation(raw?.lastLocation),
  };
}

function normalizeEarningsSummary(payload) {
  const raw = extractEarnings(payload);
  const city = payload?.city || raw?.city || null;
  const currency = firstText([raw?.currency, city?.currency], "CFA");
  const pendingAmount = firstNumber([raw?.pendingAmount, raw?.availableBalance]);
  const completedOrders = firstNumber([
    raw?.completedOrders,
    raw?.completedOrdersCount,
    raw?.deliveredCount,
  ]);
  const totalEarnings = firstNumber([
    raw?.totalEarnings,
    raw?.completedOrdersEarnings,
    raw?.lifetimePaidAmount,
  ]);

  return {
    ...(raw || {}),
    city,
    currency,
    pendingAmount,
    availableBalance: pendingAmount,
    completedOrders,
    deliveredCount: completedOrders,
    pendingOrders: firstNumber([raw?.pendingOrders, raw?.pendingCount]),
    paidAmount: firstNumber([raw?.paidAmount]),
    paidCount: firstNumber([raw?.paidCount]),
    lifetimePaidAmount: firstNumber([raw?.lifetimePaidAmount]),
    totalEarnings,
  };
}

const publicApi = axios.create({
  timeout: REQUEST_TIMEOUT_MS,
});

const authenticatedApi = axios.create({
  timeout: REQUEST_TIMEOUT_MS,
});

publicApi.interceptors.request.use((config) => {
  ensureConfiguredBaseUrl();
  return {
    ...config,
    baseURL: API_BASE_URL,
    headers: {
      Accept: "application/json",
      ...(config.headers || {}),
    },
  };
});

authenticatedApi.interceptors.request.use(async (config) => {
  ensureConfiguredBaseUrl();
  const accessToken = await getAccessToken();

  return {
    ...config,
    baseURL: API_BASE_URL,
    headers: {
      Accept: "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(config.headers || {}),
    },
  };
});

export async function loginDriver({ identifier, phone, email, password }) {
  try {
    const response = await publicApi.post(DRIVER_API_PATHS.login, {
      identifier: String(identifier || "").trim(),
      phone: String(phone || "").trim(),
      email: String(email || "").trim(),
      password: String(password || ""),
    });
    console.log("[driverApi] login response", response.data);

    const payload = readPayload(response);
    const accessToken = extractAccessToken(payload);

    if (!accessToken) {
      throw createAppError("The login response did not include an access token.", "AUTH_ERROR");
    }

    return {
      accessToken,
      refreshToken: extractRefreshToken(payload),
      driver: normalizeDriverProfile(payload),
    };
  } catch (error) {
    throw normalizeRequestError(error, "Unable to sign in.");
  }
}

export async function signupDriverApplication({
  fullName,
  phone,
  email,
  password,
  zoneLabel,
  vehicleType,
  availability,
  payoutMethod,
  payoutAccountName,
  payoutAccountNumber,
  payoutNotes,
}) {
  try {
    const response = await publicApi.post(DRIVER_API_PATHS.signup, {
      fullName: String(fullName || "").trim(),
      phone: String(phone || "").trim(),
      email: String(email || "").trim(),
      password: String(password || ""),
      zoneLabel: String(zoneLabel || "").trim(),
      vehicleType: String(vehicleType || "").trim(),
      availability: String(availability || "").trim(),
      payoutMethod: String(payoutMethod || "").trim(),
      payoutAccountName: String(payoutAccountName || "").trim(),
      payoutAccountNumber: String(payoutAccountNumber || "").trim(),
      payoutNotes: String(payoutNotes || "").trim(),
    });
    return readPayload(response);
  } catch (error) {
    throw normalizeRequestError(error, "Unable to submit driver application.");
  }
}

export async function fetchDriverOrders({ scope = "all", status = "" } = {}) {
  try {
    const params = new URLSearchParams();
    if (scope) params.set("scope", scope);
    if (status) params.set("status", status);
    const response = await authenticatedApi.get(
      `${DRIVER_API_PATHS.orders}?${params.toString()}`
    );
    return normalizeDriverOrders(extractOrders(readPayload(response)));
  } catch (error) {
    throw normalizeRequestError(error, "Unable to load driver orders.");
  }
}

export async function fetchAssignedOrders() {
  return fetchDriverOrders({ scope: "all" });
}

export async function fetchCurrentDriverOffer() {
  try {
    const response = await authenticatedApi.get(DRIVER_API_PATHS.currentOffer);
    const payload = readPayload(response);
    return normalizeDriverOffer(payload?.offer || payload?.currentOffer || null);
  } catch (error) {
    throw normalizeRequestError(error, "Unable to load the current order offer.");
  }
}

export async function fetchActiveDriverOrder() {
  try {
    const response = await authenticatedApi.get(DRIVER_API_PATHS.activeOrder);
    const payload = readPayload(response);
    const candidate = payload?.order ?? payload?.activeOrder ?? null;
    if (!candidate || typeof candidate !== "object") {
      return null;
    }
    return normalizeDriverOrder(extractSingleOrder(candidate)) || null;
  } catch (error) {
    if (Number(error?.response?.status || 0) === 404) {
      return null;
    }
    throw normalizeRequestError(error, "Unable to load the active delivery.");
  }
}

export async function fetchDriverOrderDetails(orderId) {
  try {
    const response = await authenticatedApi.get(DRIVER_API_PATHS.orderDetails(orderId));
    return normalizeDriverOrder(extractSingleOrder(readPayload(response)));
  } catch (error) {
    throw normalizeRequestError(error, "Unable to load order details.");
  }
}

export async function acceptDriverOrder(orderId) {
  try {
    const response = await authenticatedApi.post(DRIVER_API_PATHS.orderAccept(orderId));
    const payload = readPayload(response);
    return normalizeDriverOrder(extractSingleOrder(payload)) || payload;
  } catch (error) {
    throw normalizeRequestError(error, "Unable to accept order.");
  }
}

export async function rejectDriverOrder(orderId, { reason, note } = {}) {
  try {
    const response = await authenticatedApi.post(DRIVER_API_PATHS.orderReject(orderId), {
      reason: String(reason || "").trim(),
      note: String(note || "").trim(),
    });
    return readPayload(response);
  } catch (error) {
    throw normalizeRequestError(error, "Unable to reject order.");
  }
}

export async function markDriverArrivedAtRestaurant(orderId) {
  try {
    const response = await authenticatedApi.post(DRIVER_API_PATHS.orderArrivedRestaurant(orderId));
    return readPayload(response);
  } catch (error) {
    throw normalizeRequestError(error, "Unable to confirm restaurant arrival.");
  }
}

export async function markDriverPickedUp(orderId) {
  try {
    const response = await authenticatedApi.post(DRIVER_API_PATHS.orderPickedUp(orderId));
    return readPayload(response);
  } catch (error) {
    throw normalizeRequestError(error, "Unable to confirm pickup.");
  }
}

export async function markDriverOnTheWay(orderId) {
  try {
    const response = await authenticatedApi.post(DRIVER_API_PATHS.orderOnTheWay(orderId));
    return readPayload(response);
  } catch (error) {
    throw normalizeRequestError(error, "Unable to confirm the delivery is on the way.");
  }
}

export async function markDriverArrivedAtCustomer(orderId) {
  try {
    const response = await authenticatedApi.post(DRIVER_API_PATHS.orderArrivedCustomer(orderId));
    return readPayload(response);
  } catch (error) {
    throw normalizeRequestError(error, "Unable to confirm customer arrival.");
  }
}

export async function confirmDriverPayment(orderId, { method, provider, reference, note } = {}) {
  try {
    const response = await authenticatedApi.post(DRIVER_API_PATHS.orderPayment(orderId), {
      method: String(method || "").trim(),
      provider: String(provider || "").trim(),
      reference: String(reference || "").trim(),
      note: String(note || "").trim(),
    });
    return readPayload(response);
  } catch (error) {
    throw normalizeRequestError(error, "Unable to confirm payment.");
  }
}

export async function deliverDriverOrder(orderId, { deliveryOtp, proofNote, photoUrl, proof } = {}) {
  try {
    const response = await authenticatedApi.post(DRIVER_API_PATHS.orderDelivered(orderId), {
      deliveryOtp: String(deliveryOtp || "").trim(),
      proofNote: String(proofNote || "").trim(),
      photoUrl: String(photoUrl || "").trim(),
      proof:
        proof && typeof proof === "object"
          ? {
              note: String(proof.note || "").trim(),
              photoUrl: String(proof.photoUrl || "").trim(),
            }
          : undefined,
    });
    return readPayload(response);
  } catch (error) {
    throw normalizeRequestError(error, "Unable to confirm delivery.");
  }
}

export async function syncDriverActions(actions = []) {
  try {
    const response = await authenticatedApi.post(DRIVER_API_PATHS.sync, {
      actions: Array.isArray(actions) ? actions : [],
    });
    return readPayload(response);
  } catch (error) {
    throw normalizeRequestError(error, "Unable to sync pending driver actions.");
  }
}

export async function timeoutDriverOffer(orderId) {
  try {
    const response = await authenticatedApi.post(DRIVER_API_PATHS.orderOfferTimeout(orderId));
    return readPayload(response);
  } catch (error) {
    throw normalizeRequestError(error, "Unable to expire order offer.");
  }
}

export async function updateDriverOrderStatus(orderId, status, options = {}) {
  try {
    const normalizedStatus = String(status || "").trim();
    if (normalizedStatus === "accepted") {
      return acceptDriverOrder(orderId);
    }
    const action =
      normalizedStatus === "picked_up" || normalizedStatus === "out_for_delivery"
        ? "picked_up"
        : normalizedStatus === "delivered"
        ? "delivered"
        : normalizedStatus;
    const response = await authenticatedApi.post(DRIVER_API_PATHS.orderStatus(orderId), {
      action,
      deliveryOtp: String(options.deliveryOtp || "").trim(),
      proofNote: String(options.proofNote || "").trim(),
      photoUrl: String(options.photoUrl || "").trim(),
    });
    const payload = readPayload(response);
    const nextOrder = extractSingleOrder(payload);

    if (nextOrder && typeof nextOrder === "object") {
      return normalizeDriverOrder(nextOrder) || nextOrder;
    }

    return {
      status: String(payload?.status || status || "").trim(),
      deliveryProof: payload?.deliveryProof || null,
      updatedAt: payload?.updatedAt || new Date().toISOString(),
    };
  } catch (error) {
    throw normalizeRequestError(error, "Unable to update order status.");
  }
}

export async function submitDriverOrderProof(orderId, { note, photoUrl } = {}) {
  try {
    const response = await authenticatedApi.post(DRIVER_API_PATHS.orderProof(orderId), {
      note: String(note || "").trim(),
      photoUrl: String(photoUrl || "").trim(),
    });
    return readPayload(response);
  } catch (error) {
    throw normalizeRequestError(error, "Unable to save delivery proof.");
  }
}

export async function reportDriverOrderException(orderId, { reason, note } = {}) {
  try {
    const response = await authenticatedApi.post(DRIVER_API_PATHS.orderException(orderId), {
      reason: String(reason || "").trim(),
      note: String(note || "").trim(),
    });
    return readPayload(response);
  } catch (error) {
    throw normalizeRequestError(error, "Unable to report delivery exception.");
  }
}

export async function sendDriverLocation({ latitude, longitude, lat, lng, accuracy, heading, speed }) {
  try {
    const safeLatitude = Number(latitude ?? lat);
    const safeLongitude = Number(longitude ?? lng);
    const response = await authenticatedApi.post(DRIVER_API_PATHS.location, {
      latitude: safeLatitude,
      longitude: safeLongitude,
      accuracy,
      heading,
      speed,
    });
    return readPayload(response);
  } catch (error) {
    throw normalizeRequestError(error, "Unable to update driver location.");
  }
}

export async function fetchDriverEarnings() {
  try {
    const response = await authenticatedApi.get(DRIVER_API_PATHS.earnings);
    return normalizeEarningsSummary(readPayload(response));
  } catch (error) {
    throw normalizeRequestError(error, "Unable to load earnings.");
  }
}

export async function fetchDriverPayouts() {
  try {
    const response = await authenticatedApi.get(DRIVER_API_PATHS.payouts);
    return readPayload(response) || {};
  } catch (error) {
    throw normalizeRequestError(error, "Unable to load payout requests.");
  }
}

export async function requestDriverPayout() {
  try {
    const response = await authenticatedApi.post(DRIVER_API_PATHS.requestPayout, {});
    return readPayload(response) || {};
  } catch (error) {
    throw normalizeRequestError(error, "Unable to request payout.");
  }
}

export async function fetchDriverProfile() {
  try {
    const response = await authenticatedApi.get(DRIVER_API_PATHS.profile);
    const payload = readPayload(response);
    return normalizeDriverProfile(payload) || payload || null;
  } catch (error) {
    throw normalizeRequestError(error, "Unable to load driver profile.");
  }
}

export async function fetchDriverStatus() {
  try {
    const response = await authenticatedApi.get(DRIVER_API_PATHS.status);
    return normalizeDriverStatus(readPayload(response));
  } catch (error) {
    throw normalizeRequestError(error, "Unable to load driver status.");
  }
}

export async function updateDriverStatus(status, options = {}) {
  try {
    const response = await authenticatedApi.post(DRIVER_API_PATHS.status, {
      status: String(status || "").trim(),
      reason: String(options.reason || options.pauseReason || "").trim(),
      pauseReason: String(options.pauseReason || options.reason || "").trim(),
      note: String(options.note || "").trim(),
    });
    return normalizeDriverStatus(readPayload(response));
  } catch (error) {
    throw normalizeRequestError(error, "Unable to update driver status.");
  }
}

export async function goDriverOnline() {
  try {
    const response = await authenticatedApi.post(DRIVER_API_PATHS.online);
    return normalizeDriverStatus(readPayload(response));
  } catch (error) {
    throw normalizeRequestError(error, "Unable to go online.");
  }
}

export async function goDriverOffline() {
  try {
    const response = await authenticatedApi.post(DRIVER_API_PATHS.offline);
    return normalizeDriverStatus(readPayload(response));
  } catch (error) {
    throw normalizeRequestError(error, "Unable to go offline.");
  }
}

export async function registerDriverPushToken(pushToken) {
  try {
    const response = await authenticatedApi.post(DRIVER_API_PATHS.pushToken, {
      pushToken: String(pushToken || "").trim(),
    });
    return readPayload(response);
  } catch (error) {
    throw normalizeRequestError(error, "Unable to register driver push token.");
  }
}
