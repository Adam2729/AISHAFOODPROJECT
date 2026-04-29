import type { CityLean } from "@/lib/city";

export const CUSTOMER_CART_STORAGE_KEY = "aisha.customer.cart";

export type CustomerCartItem = {
  itemId: string;
  name: string;
  quantity: number;
  price: number;
  category?: string | null;
  image?: string | null;
};

export type CustomerCartState = {
  cityId: string;
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string;
  restaurantPhone?: string | null;
  restaurantWhatsApp?: string | null;
  deliveryFee: number;
  estimatedDeliveryMinutes: number;
  items: CustomerCartItem[];
};

function normalizeSlugPart(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildRestaurantSlug(input: { restaurantId: string; name: string }) {
  const base = normalizeSlugPart(input.name) || "restaurant";
  return `${base}-${String(input.restaurantId || "").trim()}`;
}

export function parseRestaurantIdFromSlug(slug: string) {
  const raw = String(slug || "").trim();
  const match = raw.match(/([a-f0-9]{24})$/i);
  return match ? match[1] : "";
}

export function estimateRestaurantDeliveryMinutes(eta?: {
  minMins?: number | null;
  maxMins?: number | null;
}) {
  const min = Number(eta?.minMins || 0);
  const max = Number(eta?.maxMins || 0);
  if (min > 0 && max > 0) return Math.round((min + max) / 2);
  if (max > 0) return Math.round(max);
  if (min > 0) return Math.round(min);
  return 30;
}

export function getRestaurantListDeliveryFee(city: Pick<CityLean, "deliveryFeeModel" | "deliveryFeeBands">) {
  if (city.deliveryFeeModel === "restaurantPays") return 0;
  const firstBand = Array.isArray(city.deliveryFeeBands) ? city.deliveryFeeBands[0] : null;
  return Number(firstBand?.fee || 0);
}

export function sanitizeWhatsAppNumber(value: unknown) {
  return String(value || "").replace(/[^\d]/g, "");
}

export function buildRestaurantWhatsAppText(input: {
  restaurantName: string;
  items?: Array<{ name?: string; quantity?: number }>;
  address?: string;
}) {
  const itemsText = Array.isArray(input.items) && input.items.length
    ? input.items
        .map((item) => `- ${String(item.name || "Item")} x${Math.max(1, Number(item.quantity || 1))}`)
        .join("\n")
    : "- ";
  const address = String(input.address || "").trim();
  return `Hello, I want to order from ${String(input.restaurantName || "this restaurant")}\nItems:\n${itemsText}\nAddress: ${address}`;
}

export function readCustomerCart() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CUSTOMER_CART_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CustomerCartState | null;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCustomerCart(cart: CustomerCartState | null) {
  if (typeof window === "undefined") return;
  if (!cart) {
    window.localStorage.removeItem(CUSTOMER_CART_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(CUSTOMER_CART_STORAGE_KEY, JSON.stringify(cart));
}

export function clearCustomerCart() {
  writeCustomerCart(null);
}

export function computeCartSubtotal(items: CustomerCartItem[]) {
  return items.reduce((sum, item) => {
    return sum + Math.max(1, Number(item.quantity || 1)) * Number(item.price || 0);
  }, 0);
}
