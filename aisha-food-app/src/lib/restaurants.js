import { Alert, Linking } from "react-native";
import { apiPost } from "./api";
import { getProductSizeLabel } from "./catalogPresentation";
import { API_BASE_URL } from "./config";
import { formatMoney } from "./formatters";
import { getMarketConfig } from "./marketConfig";

export const RESTAURANT_IMAGE_PLACEHOLDER = require("../../assets/brand/brand.png");

function normalizeDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function formatWhatsAppAmount(amount, cityOrMarket) {
  const market = getMarketConfig(cityOrMarket);
  const numericAmount = Number(amount || 0);
  const safeAmount = Number.isFinite(numericAmount) ? Math.round(numericAmount) : 0;
  return `${safeAmount.toLocaleString("en-US")} ${market.currencyDisplay || "FCFA"}`;
}

function getItemQuantity(item) {
  return Math.max(1, Number(item?.quantity || item?.qty || 1));
}

export function getRestaurantDisplayName(restaurant, fallback = "Restaurant") {
  const name = String(
    restaurant?.name || restaurant?.businessName || restaurant?.restaurantName || ""
  ).trim();
  return name || fallback;
}

function isLocalHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function getApiOrigin() {
  try {
    return API_BASE_URL ? new URL(API_BASE_URL).origin : "";
  } catch {
    return "";
  }
}

function resolveMediaUrl(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";

  if (/^(data:|file:|content:)/i.test(candidate)) {
    return candidate;
  }

  const apiOrigin = getApiOrigin();
  if (candidate.startsWith("/")) {
    return apiOrigin ? `${apiOrigin}${candidate}` : candidate;
  }

  if (/^uploads\//i.test(candidate)) {
    return apiOrigin ? `${apiOrigin}/${candidate}` : `/${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (isLocalHost(parsed.hostname) && apiOrigin) {
      return `${apiOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch {
    return apiOrigin ? `${apiOrigin}/${candidate.replace(/^\.?\//, "")}` : candidate;
  }
}

export function getRestaurantImageSource(restaurant) {
  const candidate = resolveMediaUrl(restaurant?.logo || restaurant?.image);
  if (candidate) {
    return { uri: candidate };
  }
  return RESTAURANT_IMAGE_PLACEHOLDER;
}

export function getMenuItemImageSource(item) {
  const candidate = resolveMediaUrl(item?.image || item?.imageUrl);
  if (candidate) {
    return { uri: candidate };
  }
  return RESTAURANT_IMAGE_PLACEHOLDER;
}

export function formatRestaurantEta(minutes, cityOrMarket) {
  const value = Number(minutes || 0);
  const market = getMarketConfig(cityOrMarket);
  if (!Number.isFinite(value) || value <= 0) {
    return market.defaultLanguage === "es" ? "ETA pendiente" : "ETA en attente";
  }
  return `${Math.round(value)} min`;
}

export function formatRestaurantDeliveryFee(amount, cityOrMarket) {
  const value = Number(amount || 0);
  const market = getMarketConfig(cityOrMarket);
  if (!Number.isFinite(value) || value <= 0) {
    return market.defaultLanguage === "es" ? "Entrega gratis" : "Livraison offerte";
  }
  return formatMoney(value, cityOrMarket);
}

export async function trackSponsoredRestaurantClick(restaurant) {
  const sponsored = Boolean(restaurant?.sponsored);
  const campaignId = String(restaurant?.campaignId || "").trim();
  const businessId = String(
    restaurant?.restaurantId ||
      restaurant?.businessId ||
      restaurant?.id ||
      restaurant?._id ||
      ""
  ).trim();

  if (!sponsored || !campaignId || !businessId) return false;

  try {
    await apiPost("/api/public/ads/click", {
      campaignId,
      businessId,
    });
    return true;
  } catch {
    return false;
  }
}

export function groupMenuItemsByCategory(menu, cityOrMarket) {
  const rows = Array.isArray(menu) ? menu : [];
  const market = getMarketConfig(cityOrMarket);
  const fallbackCategory = market.defaultLanguage === "es" ? "Menu" : "Menu";
  const map = new Map();

  rows.forEach((item) => {
    const category = String(item?.category || fallbackCategory).trim() || fallbackCategory;
    if (!map.has(category)) {
      map.set(category, []);
    }
    map.get(category).push(item);
  });

  return Array.from(map.entries()).map(([category, items]) => ({
    category,
    items,
  }));
}

export function normalizeMenuItem(raw, business = {}) {
  const itemId = String(raw?.itemId || raw?.id || raw?._id || raw?.productId || "").trim();
  return {
    ...raw,
    itemId,
    id: itemId,
    productId: itemId,
    name: String(raw?.name || "").trim(),
    description: String(raw?.description || "").trim(),
    price: Number(raw?.price || raw?.unitPrice || 0),
    image: String(raw?.image || raw?.imageUrl || "").trim(),
    imageUrl: String(raw?.imageUrl || raw?.image || "").trim(),
    category: String(raw?.category || raw?.categoryName || "").trim() || "Menu",
    displaySize: String(raw?.displaySize || "").trim(),
    quantityValue: raw?.quantityValue ?? null,
    quantityUnit: String(raw?.quantityUnit || "").trim(),
    sizeLabel: getProductSizeLabel(raw),
    isAvailable: raw?.isAvailable !== false,
    businessId: String(raw?.businessId || business?.id || business?.restaurantId || "").trim(),
    businessName: String(raw?.businessName || business?.name || business?.businessName || "").trim(),
    businessType: String(raw?.businessType || business?.type || "").trim(),
  };
}

export async function openRestaurantOrderWhatsApp({
  restaurantName,
  whatsapp,
  phone,
  items,
  address,
  landmark,
  note,
  paymentMethod,
  totalAmount,
  city,
  supportWhatsApp,
}) {
  const restaurantDigits = normalizeDigits(whatsapp || phone);
  const market = getMarketConfig(city);
  const digits = restaurantDigits || normalizeDigits(supportWhatsApp || market.supportWhatsApp);
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  const safeRestaurantName = String(restaurantName || "OranjeEats restaurant").trim() || "OranjeEats restaurant";
  const safeAddress = String(address || "").trim();
  const safeLandmark = String(landmark || "").trim();
  const safeNote = String(note || "").trim();
  const safePaymentMethod = String(paymentMethod || "").trim();
  const computedTotal = Number.isFinite(Number(totalAmount))
    ? Number(totalAmount)
    : safeItems.reduce(
        (sum, item) => sum + getItemQuantity(item) * Number(item?.price || 0),
        0
      );

  if (!safeItems.length) {
    Alert.alert("WhatsApp", "Cart is empty.");
    return false;
  }

  if (!digits) {
    Alert.alert("WhatsApp", "WhatsApp support is not configured.");
    return false;
  }

  const itemLines = safeItems
    .map((item) => {
      const sizeLabel = getProductSizeLabel(item);
      const qty = getItemQuantity(item);
      const lineTotal = qty * Number(item?.price || 0);
      return `- ${String(item?.name || "Menu item")}${sizeLabel ? ` (${sizeLabel})` : ""} x${qty} = ${formatWhatsAppAmount(lineTotal, market)}`;
    })
    .join("\n");

  const messageLines = [
    "Hello 👋",
    "",
    "I want to order from OranjeEats:",
    "",
    `Restaurant: ${safeRestaurantName}`,
    "",
    "Order:",
    itemLines,
    "",
    `Total: ${formatWhatsAppAmount(computedTotal, market)}`,
    "",
    "Delivery address:",
    safeAddress || "-",
  ];

  if (safeLandmark) {
    messageLines.push(`Near: ${safeLandmark}`);
  }
  if (safeNote) {
    messageLines.push(`Note: ${safeNote}`);
  }
  if (safePaymentMethod) {
    messageLines.push("", `Payment: ${safePaymentMethod}`);
  }

  messageLines.push("", "Please confirm 🙏");
  const message = messageLines.join("\n");

  try {
    await Linking.openURL(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`);
    return true;
  } catch {
    Alert.alert("WhatsApp", "No fue posible abrir WhatsApp en este dispositivo.");
    return false;
  }
}
