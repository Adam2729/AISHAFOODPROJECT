import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

import {
  approvedMerchantCredentials,
  type MerchantApplicationDraft,
  type MerchantOrder,
  type MerchantProfile,
  mockMenuItems,
  mockMerchantProfile,
  mockOrders,
  type OrderStatus,
  SUPPORT_WHATSAPP,
  type MenuItem,
} from "@/src/data/mockData";

type AuthState = "loggedOut" | "pending" | "approved";

type SignupInput = Omit<MerchantApplicationDraft, "id">;

type MerchantAppContextValue = {
  booting: boolean;
  authState: AuthState;
  merchantProfile: MerchantProfile;
  pendingApplication: MerchantApplicationDraft | null;
  orders: MerchantOrder[];
  menuItems: MenuItem[];
  storeOpen: boolean;
  supportWhatsApp: string;
  paymentsSnapshot: {
    todaySales: number;
    weeklySales: number;
    deliveryFees: number;
    commission: number;
    merchantNet: number;
    settlementStatus: string;
  };
  login: (identifier: string, password: string) => { ok: boolean; pending?: boolean; message?: string };
  logout: () => void;
  submitApplication: (input: SignupInput) => MerchantApplicationDraft;
  resetPendingApplication: () => void;
  toggleStoreOpen: () => void;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
  toggleMenuAvailability: (itemId: string) => void;
  updateProfile: (input: Partial<MerchantProfile>) => void;
  getOrderById: (orderId: string) => MerchantOrder | undefined;
};

const MerchantAppContext = createContext<MerchantAppContextValue | null>(null);

function matchesCredential(identifier: string, candidate: string) {
  return String(identifier || "").trim().toLowerCase() === String(candidate || "").trim().toLowerCase();
}

function calculatePaymentsSnapshot(orders: MerchantOrder[]) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const chargeable = orders.filter((order) => order.status !== "cancelled");
  const todayOrders = chargeable.filter((order) => String(order.createdAt || "").startsWith(todayKey));
  const todaySales = todayOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const weeklySales = chargeable.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const deliveryFees = chargeable.reduce((sum, order) => sum + Number(order.deliveryFee || 0), 0);
  const commission = Math.round(weeklySales * 0.08);
  const merchantNet = weeklySales - commission;

  return {
    todaySales,
    weeklySales,
    deliveryFees,
    commission,
    merchantNet,
    settlementStatus: "Next settlement scheduled for tomorrow at 10:00",
  };
}

export function MerchantAppProvider({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [authState, setAuthState] = useState<AuthState>("loggedOut");
  const [pendingApplication, setPendingApplication] = useState<MerchantApplicationDraft | null>(null);
  const [merchantProfile, setMerchantProfile] = useState<MerchantProfile>(mockMerchantProfile);
  const [orders, setOrders] = useState<MerchantOrder[]>(mockOrders);
  const [menuItems, setMenuItems] = useState<MenuItem[]>(mockMenuItems);
  const [storeOpen, setStoreOpen] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setBooting(false), 1400);
    return () => clearTimeout(timer);
  }, []);

  const paymentsSnapshot = useMemo(() => calculatePaymentsSnapshot(orders), [orders]);

  const value = useMemo<MerchantAppContextValue>(
    () => ({
      booting,
      authState,
      merchantProfile,
      pendingApplication,
      orders,
      menuItems,
      storeOpen,
      supportWhatsApp: SUPPORT_WHATSAPP,
      paymentsSnapshot,
      login(identifier, password) {
        const normalizedIdentifier = String(identifier || "").trim();
        const normalizedPassword = String(password || "");

        if (
          normalizedPassword === approvedMerchantCredentials.password &&
          (matchesCredential(normalizedIdentifier, approvedMerchantCredentials.email) ||
            matchesCredential(normalizedIdentifier, approvedMerchantCredentials.phone))
        ) {
          setAuthState("approved");
          return { ok: true };
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

        return {
          ok: false,
          message: "Invalid credentials. Use the approved mock account or submit an application first.",
        };
      },
      logout() {
        setAuthState("loggedOut");
      },
      submitApplication(input) {
        const application: MerchantApplicationDraft = {
          id: `APP-${Date.now().toString().slice(-6)}`,
          ...input,
        };
        setPendingApplication(application);
        setAuthState("pending");
        return application;
      },
      resetPendingApplication() {
        setPendingApplication(null);
        setAuthState("loggedOut");
      },
      toggleStoreOpen() {
        setStoreOpen((current) => !current);
      },
      updateOrderStatus(orderId, status) {
        setOrders((current) =>
          current.map((order) => (order.id === orderId ? { ...order, status } : order))
        );
      },
      toggleMenuAvailability(itemId) {
        setMenuItems((current) =>
          current.map((item) =>
            item.id === itemId ? { ...item, available: !item.available } : item
          )
        );
      },
      updateProfile(input) {
        setMerchantProfile((current) => ({ ...current, ...input }));
      },
      getOrderById(orderId) {
        return orders.find((order) => order.id === orderId);
      },
    }),
    [authState, booting, menuItems, merchantProfile, orders, paymentsSnapshot, pendingApplication, storeOpen]
  );

  return <MerchantAppContext.Provider value={value}>{children}</MerchantAppContext.Provider>;
}

export function useMerchantApp() {
  const context = useContext(MerchantAppContext);
  if (!context) {
    throw new Error("useMerchantApp must be used within MerchantAppProvider");
  }
  return context;
}
