import formatPrice from "./formatPrice";
import { getMarketConfig, getMarketLocale } from "./marketConfig";

export function formatMoney(amount, cityOrCurrency) {
  const value = Number(amount || 0);
  const safeValue = Number.isFinite(value) ? value : 0;
  const market = typeof cityOrCurrency === "string"
    ? getMarketConfig({ currencyCode: cityOrCurrency, currency: cityOrCurrency })
    : getMarketConfig(cityOrCurrency);
  return formatPrice(safeValue, market);
}

export function formatDateTime(value, cityOrMarket) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const market = getMarketConfig(cityOrMarket);
  return parsed.toLocaleString(getMarketLocale(market), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: market.defaultTimezone,
  });
}

export function formatDateOnly(value, cityOrMarket) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const market = getMarketConfig(cityOrMarket);
  return parsed.toLocaleDateString(getMarketLocale(market), {
    dateStyle: "medium",
    timeZone: market.defaultTimezone,
  });
}

export function paymentMethodLabel(method, cityOrMarket) {
  const market = getMarketConfig(cityOrMarket);
  const isSpanish = market.defaultLanguage === "es";
  switch (String(method || "").trim().toLowerCase()) {
    case "orange_money":
      return "Orange Money";
    case "orange_money_ml":
      return "Orange Money Mali";
    case "orange_money_sn":
      return "Orange Money Senegal";
    case "wave":
      return "Wave";
    case "moov_money":
      return "Moov Money";
    case "moov_money_ml":
      return "Moov Money Mali";
    case "mobile_money":
      return isSpanish ? "Dinero movil" : "Mobile money";
    case "paytech":
      return market.marketCode === "SN"
        ? "PayTech / Orange Money Senegal / Wave / Carte"
        : "PayTech / Orange Money Mali / Moov Money Mali / Wave";
    case "wallet":
      return isSpanish ? "Billetera" : "Portefeuille";
    case "card":
      return isSpanish ? "Tarjeta bancaria" : "Carte bancaire";
    case "cash":
    default:
      return isSpanish ? "Efectivo / Cash" : "Espèces / Cash";
  }
}

export function paymentStatusLabel(status, cityOrMarket) {
  const market = getMarketConfig(cityOrMarket);
  const isSpanish = market.defaultLanguage === "es";
  switch (String(status || "").trim().toLowerCase()) {
    case "authorized":
      return isSpanish ? "Autorizado" : "Autorise";
    case "paid":
      return isSpanish ? "Pagado" : "Paye";
    case "failed":
      return isSpanish ? "Fallido" : "Echoue";
    case "cancelled":
    case "canceled":
      return isSpanish ? "Cancelado" : "Annule";
    case "refunded":
      return isSpanish ? "Reembolsado" : "Rembourse";
    case "pending":
    default:
      return isSpanish ? "Pendiente" : "En attente";
  }
}

export function orderStatusLabel(status, cityOrMarket) {
  const market = getMarketConfig(cityOrMarket);
  const isSpanish = market.defaultLanguage === "es";
  switch (String(status || "").trim().toLowerCase()) {
    case "pending_payment":
      return isSpanish ? "Pago en espera" : "Paiement en attente";
    case "accepted":
      return isSpanish ? "Aceptado" : "Acceptee";
    case "preparing":
      return isSpanish ? "En preparacion" : "En preparation";
    case "ready":
      return isSpanish ? "Listo" : "Pret";
    case "out_for_delivery":
      return isSpanish ? "En camino" : "En livraison";
    case "delivered":
      return isSpanish ? "Entregado" : "Livree";
    case "cancelled":
      return isSpanish ? "Cancelado" : "Annulee";
    case "new":
    default:
      return isSpanish ? "Pedido recibido" : "Commande recue";
  }
}

export function buildOrderTimeline(status, cityOrMarket) {
  const market = getMarketConfig(cityOrMarket);
  const isSpanish = market.defaultLanguage === "es";
  const normalized = String(status || "new").trim().toLowerCase();
  if (normalized === "pending_payment") {
    return [];
  }
  const steps = [
    { key: "new", label: isSpanish ? "Pedido recibido" : "Commande recue" },
    { key: "accepted", label: isSpanish ? "Aceptado" : "Acceptee" },
    { key: "preparing", label: isSpanish ? "En preparacion" : "En preparation" },
    { key: "ready", label: isSpanish ? "Listo" : "Pret" },
    { key: "out_for_delivery", label: isSpanish ? "En camino" : "En livraison" },
    { key: "delivered", label: isSpanish ? "Entregado" : "Livree" },
  ];

  if (normalized === "cancelled") {
    return steps
      .map((step, index) => ({
        ...step,
        done: index === 0,
        active: false,
      }))
      .concat({
        key: "cancelled",
        label: isSpanish ? "Cancelado" : "Annulee",
        done: false,
        active: true,
      });
  }

  const activeIndex = Math.max(
    0,
    steps.findIndex((step) => step.key === normalized)
  );

  return steps.map((step, index) => ({
    ...step,
    done: index < activeIndex,
    active: index === activeIndex,
  }));
}
