import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  API_URL,
  apiRequest,
  getApiUrl,
  toApiAssetUrl,
} from "@/src/lib/api";
import {
  clearSession,
  getMerchant,
  getToken,
  saveMerchant,
  saveToken,
} from "@/src/lib/session";
import { useMerchantOrders } from "@/src/hooks/useMerchantOrders";
import {
  type DeliveryModel,
  type MenuItem,
  type MerchantApplicationDraft,
  type MerchantOrder,
  type MerchantProfile,
  mockMenuItems,
  mockMerchantProfile,
  SUPPORT_WHATSAPP,
} from "@/src/data/mockData";

type AuthState = "loggedOut" | "pending" | "approved";
type SignupInput = Omit<MerchantApplicationDraft, "id">;

type LoginResult = {
  ok: boolean;
  pending?: boolean;
  message?: string;
};

type DashboardStats = {
  newOrders: number;
  preparing: number;
  ready: number;
  activeOrders: number;
  todaySales: number;
};

type MerchantPayoutShape = {
  preferredMethod?: unknown;
  accountName?: unknown;
  payoutContactName?: unknown;
  accountNumber?: unknown;
  notes?: unknown;
  details?: unknown;
};

type MerchantAppContextValue = {
  booting: boolean;
  authState: AuthState;
  token: string;
  apiUrl: string;
  merchantProfile: MerchantProfile;
  pendingApplication: MerchantApplicationDraft | null;
  menuItems: MenuItem[];
  supportWhatsApp: string;
  storeOpen: boolean;
  orders: MerchantOrder[];
  ordersLoading: boolean;
  ordersRefreshing: boolean;
  ordersError: string;
  usingDemoData: boolean;
  ordersConnectionSlow: boolean;
  ordersLastUpdatedAt: string;
  ordersIsLiveFastMode: boolean;
  newOrder: MerchantOrder | null;
  dashboardStats: DashboardStats;
  refreshOrders: (options?: { silent?: boolean; debounceMs?: number }) => Promise<MerchantOrder[]>;
  acceptOrder: (orderId: string) => Promise<unknown>;
  rejectOrder: (orderId: string, extra?: Record<string, unknown>) => Promise<unknown>;
  updateOrderStatus: (
    orderId: string,
    status: string,
    extra?: Record<string, unknown>
  ) => Promise<unknown>;
  getOrderById: (orderId: string) => MerchantOrder | undefined;
  login: (identifier: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  submitApplication: (input: SignupInput) => Promise<MerchantApplicationDraft>;
  resetPendingApplication: () => void;
  toggleStoreOpen: () => Promise<void>;
  toggleMenuAvailability: (itemId: string) => void;
  updateProfile: (input: Partial<MerchantProfile>) => Promise<void>;
};

const MerchantAppContext = createContext<MerchantAppContextValue | null>(null);

function matchesCredential(identifier: string, candidate: string) {
  return String(identifier || "").trim().toLowerCase() === String(candidate || "").trim().toLowerCase();
}

function normalizeDeliveryModel(value: unknown, fallback: DeliveryModel = "self_delivery"): DeliveryModel {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "platform_driver") return "platform_driver";
  if (normalized === "both") return "both";
  if (normalized === "self_delivery" || normalized === "own_driver") return "self_delivery";
  return fallback;
}

function normalizeCurrencyCode(value: unknown) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "DOP") return "DOP";
  if (normalized === "GBP") return "GBP";
  return "XOF";
}

function resolveAssetUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return toApiAssetUrl(raw);
  } catch {
    return raw;
  }
}

function buildProfile(
  settingsBusiness: Record<string, unknown> | null | undefined,
  contextBusiness: Record<string, unknown> | null | undefined,
  fallbackProfile?: MerchantProfile | null
): MerchantProfile {
  const fallback = fallbackProfile || mockMerchantProfile;
  const settingsHours = (settingsBusiness?.hours || null) as Record<string, unknown> | null;
  const settingsPayout = (settingsBusiness?.payout || null) as MerchantPayoutShape | null;

  return {
    id: String(settingsBusiness?.id || contextBusiness?.id || fallback.id || ""),
    restaurantName: String(settingsBusiness?.name || contextBusiness?.name || fallback.restaurantName || ""),
    ownerName: String(settingsBusiness?.ownerName || contextBusiness?.ownerName || fallback.ownerName || ""),
    email: String(settingsBusiness?.email || contextBusiness?.email || fallback.email || ""),
    phone: String(settingsBusiness?.phone || contextBusiness?.phone || fallback.phone || ""),
    whatsapp: String(settingsBusiness?.whatsapp || contextBusiness?.whatsapp || fallback.whatsapp || ""),
    address: String(settingsBusiness?.address || fallback.address || ""),
    area: String(settingsBusiness?.area || fallback.area || ""),
    city: String(contextBusiness?.cityName || fallback.city || ""),
    cuisineType: String(settingsBusiness?.cuisineType || fallback.cuisineType || ""),
    openingHours: String(
      settingsHours && typeof settingsHours.weekly === "object"
        ? formatHours(settingsHours)
        : settingsBusiness?.openingHoursText || fallback.openingHours || ""
    ),
    logoUrl: resolveAssetUrl(settingsBusiness?.logoUrl || fallback.logoUrl || ""),
    deliveryModel: normalizeDeliveryModel(
      settingsBusiness?.deliveryType || contextBusiness?.deliveryType || fallback.deliveryModel,
      fallback.deliveryModel
    ),
    payoutMethod: String(settingsPayout?.preferredMethod || fallback.payoutMethod || "cash"),
    payoutAccountName: String(
      settingsPayout?.accountName || settingsPayout?.payoutContactName || fallback.payoutAccountName || ""
    ),
    payoutAccountNumber: String(settingsPayout?.accountNumber || fallback.payoutAccountNumber || ""),
    payoutNotes: String(
      settingsPayout?.notes || settingsPayout?.details || fallback.payoutNotes || ""
    ),
    approved: true,
    currencyCode: normalizeCurrencyCode(contextBusiness?.currencyCode || fallback.currencyCode),
    supportWhatsApp: String(contextBusiness?.supportWhatsApp || fallback.supportWhatsApp || SUPPORT_WHATSAPP),
    portalStatus: String(contextBusiness?.portalStatus || fallback.portalStatus || "online"),
    isManuallyPaused: Boolean(
      settingsBusiness?.isManuallyPaused ?? contextBusiness?.isManuallyPaused ?? fallback.isManuallyPaused
    ),
  };
}

function formatHours(hours: Record<string, unknown>) {
  const timezone = String(hours?.timezone || "").trim();
  if (!hours?.weekly || typeof hours.weekly !== "object") {
    return timezone || "";
  }

  const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const firstOpenDay = dayKeys.find((day) => {
    const row = (hours.weekly as Record<string, { closed?: boolean }>)[day];
    return row && !row.closed;
  });

  if (!firstOpenDay) {
    return timezone ? `Closed all week (${timezone})` : "Closed all week";
  }

  const sample = (hours.weekly as Record<string, { open?: string; close?: string }>)[firstOpenDay];
  const range = [String(sample?.open || "").trim(), String(sample?.close || "").trim()].filter(Boolean).join(" - ");
  return timezone && range ? `${range} (${timezone})` : range || timezone;
}

function buildUniformWeeklyHours(openingHours: string) {
  const normalized = String(openingHours || "").trim();
  const match = normalized.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})(?:\s*\((.+)\))?$/i);
  if (!match) return null;

  const [, open, close] = match;
  return {
    timezone: "Africa/Bamako",
    weekly: {
      mon: { open, close, closed: false },
      tue: { open, close, closed: false },
      wed: { open, close, closed: false },
      thu: { open, close, closed: false },
      fri: { open, close, closed: false },
      sat: { open, close, closed: false },
      sun: { open, close, closed: false },
    },
  };
}

function buildPendingApplication(
  input: SignupInput,
  applicationId: string
): MerchantApplicationDraft {
  return {
    id: applicationId,
    ...input,
  };
}

export function MerchantAppProvider({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [authState, setAuthState] = useState<AuthState>("loggedOut");
  const [token, setToken] = useState("");
  const [merchantProfile, setMerchantProfile] = useState<MerchantProfile>(mockMerchantProfile);
  const [pendingApplication, setPendingApplication] = useState<MerchantApplicationDraft | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>(mockMenuItems);

  const handleUnauthorized = useCallback(async () => {
    await clearSession();
    setToken("");
    setAuthState("loggedOut");
  }, []);

  const ordersState = useMerchantOrders({
    token,
    enabled: authState === "approved",
    onUnauthorized: handleUnauthorized,
  });

  const loadMerchantProfileFromApi = useCallback(async (
    sessionToken: string,
    fallbackProfile?: MerchantProfile | null
  ) => {
    const [settingsResult, contextResult] = await Promise.allSettled([
      apiRequest("/api/merchant/business/settings", "GET", undefined, sessionToken),
      apiRequest("/api/merchant/context", "GET", undefined, sessionToken),
    ]);

    if (settingsResult.status === "rejected" && contextResult.status === "rejected") {
      throw settingsResult.reason || contextResult.reason;
    }

    const settingsBusiness =
      settingsResult.status === "fulfilled" ? settingsResult.value?.business : null;
    const contextBusiness =
      contextResult.status === "fulfilled" ? contextResult.value?.business : null;

    return buildProfile(settingsBusiness, contextBusiness, fallbackProfile);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [storedToken, storedMerchant] = await Promise.all([getToken(), getMerchant()]);
        if (cancelled) return;

        if (!storedToken) {
          setBooting(false);
          return;
        }

        const fallbackProfile =
          storedMerchant && typeof storedMerchant === "object"
            ? buildProfile(storedMerchant, storedMerchant, storedMerchant as MerchantProfile)
            : null;

        try {
          const liveProfile = await loadMerchantProfileFromApi(storedToken, fallbackProfile);
          if (cancelled) return;
          setToken(storedToken);
          setMerchantProfile(liveProfile);
          setAuthState("approved");
          await saveMerchant(liveProfile);
        } catch (error: unknown) {
          if (cancelled) return;
          if ((error as { status?: number })?.status === 401) {
            await clearSession();
            setToken("");
            setAuthState("loggedOut");
          } else if (fallbackProfile) {
            setToken(storedToken);
            setMerchantProfile(fallbackProfile);
            setAuthState("approved");
          } else {
            setToken("");
            setAuthState("loggedOut");
          }
        }
      } finally {
        if (!cancelled) {
          setBooting(false);
        }
      }
    }

    bootstrap().catch(() => {
      if (!cancelled) {
        setBooting(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loadMerchantProfileFromApi]);

  const contextValue = useMemo<MerchantAppContextValue>(
    () => ({
      booting,
      authState,
      token,
      apiUrl: (() => {
        try {
          return getApiUrl();
        } catch {
          return API_URL || "";
        }
      })(),
      merchantProfile,
      pendingApplication,
      menuItems,
      supportWhatsApp: merchantProfile.supportWhatsApp || SUPPORT_WHATSAPP,
      storeOpen: !merchantProfile.isManuallyPaused,
      orders: ordersState.orders,
      ordersLoading: ordersState.loading,
      ordersRefreshing: ordersState.refreshing,
      ordersError: ordersState.error,
      usingDemoData: ordersState.usingDemoData,
      ordersConnectionSlow: ordersState.connectionSlow,
      ordersLastUpdatedAt: ordersState.lastUpdatedAt,
      ordersIsLiveFastMode: ordersState.isLiveFastMode,
      newOrder: ordersState.newOrder,
      dashboardStats: ordersState.dashboardStats,
      refreshOrders: ordersState.refreshOrders,
      acceptOrder: ordersState.acceptOrder,
      rejectOrder: ordersState.rejectOrder,
      updateOrderStatus: ordersState.updateOrderStatus,
      getOrderById: ordersState.getOrderById,
      async login(identifier, password) {
        const normalizedIdentifier = String(identifier || "").trim();
        const normalizedPassword = String(password || "").trim();
        if (!normalizedIdentifier || !normalizedPassword) {
          return {
            ok: false,
            message: "Enter your email or phone and password.",
          };
        }

        if (
          pendingApplication &&
          normalizedPassword === pendingApplication.password &&
          (matchesCredential(normalizedIdentifier, pendingApplication.email) ||
            matchesCredential(normalizedIdentifier, pendingApplication.phone))
        ) {
          setAuthState("pending");
          return { ok: true, pending: true };
        }

        try {
          const isEmail = normalizedIdentifier.includes("@");
          const response = await apiRequest("/api/merchant/auth/login", "POST", {
            identifier: normalizedIdentifier,
            email: isEmail ? normalizedIdentifier : undefined,
            phone: !isEmail ? normalizedIdentifier : undefined,
            password: normalizedPassword,
          });

          const nextToken = String(
            response?.token || response?.accessToken || response?.merchantToken || ""
          ).trim();
          if (!nextToken) {
            return {
              ok: false,
              message: "Login succeeded but no merchant session token was returned.",
            };
          }

          const seed = response?.merchant || response?.business || response?.user || null;
          const fallbackProfile = seed
            ? buildProfile(seed, seed, {
                ...mockMerchantProfile,
                restaurantName: String(seed?.name || mockMerchantProfile.restaurantName),
                email: String(seed?.email || mockMerchantProfile.email),
                phone: String(seed?.phone || mockMerchantProfile.phone),
                deliveryModel: normalizeDeliveryModel(seed?.deliveryType, mockMerchantProfile.deliveryModel),
              })
            : merchantProfile;

          const liveProfile = await loadMerchantProfileFromApi(nextToken, fallbackProfile);

          await saveToken(nextToken);
          await saveMerchant(liveProfile);

          setToken(nextToken);
          setMerchantProfile(liveProfile);
          setAuthState("approved");

          return { ok: true };
        } catch (error: unknown) {
          return {
            ok: false,
            message:
              (error as { message?: string })?.message ||
              "Cannot sign in right now. Please try again.",
          };
        }
      },
      async logout() {
        if (token) {
          apiRequest("/api/merchant/auth/logout", "POST", undefined, token).catch(() => null);
        }
        await clearSession();
        setToken("");
        setPendingApplication(null);
        setAuthState("loggedOut");
        setMerchantProfile(mockMerchantProfile);
      },
      async submitApplication(input) {
        const payload = {
          merchantType: "restaurant",
          deliveryModePreference: input.deliveryModel,
          deliveryType: input.deliveryModel === "platform_driver" ? "platform_driver" : "own_driver",
          businessName: input.restaurantName,
          ownerName: input.ownerName,
          phone: input.phone,
          email: input.email,
          password: input.password,
          whatsapp: input.whatsapp,
          cityName: input.city,
          address: input.address,
          cuisineType: input.cuisineType,
          openingHoursText: input.openingHours,
        };

        const response = await apiRequest("/api/public/merchant-applications", "POST", payload);
        const applicationId = String(response?.applicationId || response?.id || "").trim();
        const application = buildPendingApplication(input, applicationId || `APP-${Date.now()}`);
        setPendingApplication(application);
        setAuthState("pending");
        return application;
      },
      resetPendingApplication() {
        setPendingApplication(null);
        setAuthState("loggedOut");
      },
      async toggleStoreOpen() {
        const nextPaused = !merchantProfile.isManuallyPaused;
        if (!token) {
          setMerchantProfile((current) => ({
            ...current,
            isManuallyPaused: nextPaused,
            portalStatus: nextPaused ? "offline" : "online",
          }));
          return;
        }

        const response = await apiRequest(
          "/api/merchant/business/settings",
          "PATCH",
          { isManuallyPaused: nextPaused },
          token
        );

        const nextProfile = buildProfile(response?.business, null, {
          ...merchantProfile,
          isManuallyPaused: nextPaused,
          portalStatus: nextPaused ? "offline" : "online",
        });
        setMerchantProfile(nextProfile);
        await saveMerchant(nextProfile);
      },
      toggleMenuAvailability(itemId) {
        setMenuItems((current) =>
          current.map((item) =>
            item.id === itemId ? { ...item, available: !item.available } : item
          )
        );
      },
      async updateProfile(input) {
        const nextLocalProfile = { ...merchantProfile, ...input };
        if (!token) {
          setMerchantProfile(nextLocalProfile);
          await saveMerchant(nextLocalProfile);
          return;
        }

        const body: Record<string, unknown> = {
          name: nextLocalProfile.restaurantName,
          ownerName: nextLocalProfile.ownerName,
          email: nextLocalProfile.email,
          phone: nextLocalProfile.phone,
          whatsapp: nextLocalProfile.whatsapp,
          address: nextLocalProfile.address,
          area: nextLocalProfile.area || "",
          logoUrl: nextLocalProfile.logoUrl || "",
        };
        if (nextLocalProfile.deliveryModel !== "both") {
          body.deliveryType =
            nextLocalProfile.deliveryModel === "platform_driver" ? "platform_driver" : "own_driver";
        }
        const parsedHours = buildUniformWeeklyHours(nextLocalProfile.openingHours);
        if (parsedHours) {
          body.hours = parsedHours;
        }
        body.payout = {
          preferredMethod: nextLocalProfile.payoutMethod || "cash",
          accountName: nextLocalProfile.payoutAccountName || "",
          payoutContactName: nextLocalProfile.payoutAccountName || "",
          accountNumber: nextLocalProfile.payoutAccountNumber || "",
          notes: nextLocalProfile.payoutNotes || "",
          details: nextLocalProfile.payoutNotes || "",
        };

        const response = await apiRequest(
          "/api/merchant/business/settings",
          "PATCH",
          body,
          token
        );
        const liveProfile = buildProfile(response?.business, { ...merchantProfile, ...nextLocalProfile }, nextLocalProfile);
        setMerchantProfile(liveProfile);
        await saveMerchant(liveProfile);
      },
    }),
    [authState, booting, loadMerchantProfileFromApi, menuItems, merchantProfile, ordersState, pendingApplication, token]
  );

  return <MerchantAppContext.Provider value={contextValue}>{children}</MerchantAppContext.Provider>;
}

export function useMerchantApp() {
  const context = useContext(MerchantAppContext);
  if (!context) {
    throw new Error("useMerchantApp must be used within MerchantAppProvider");
  }
  return context;
}
