import { getMarketConfig } from "./marketConfig";

function normalize(value) {
  return String(value || "").trim();
}

function normalizeLower(value) {
  return normalize(value).toLowerCase();
}

export function getCustomerUiCopy(cityOrMarket) {
  const market = getMarketConfig(cityOrMarket);
  const isSpanish = market.defaultLanguage === "es";

  return {
    isSpanish,
    weakConnection: isSpanish
      ? "Conexion debil. Algunas informaciones pueden actualizarse mas tarde."
      : "Connexion faible. Certaines informations peuvent être mises à jour plus tard.",
    locationUnavailable: isSpanish
      ? "Ubicacion no disponible. Puedes ingresar tu direccion manualmente."
      : "Localisation indisponible. Vous pouvez entrer votre adresse manuellement.",
    locationCaptured: isSpanish
      ? "Ubicacion guardada. Completa o corrige la direccion escrita si hace falta."
      : "Localisation enregistree. Vous pouvez encore completer ou corriger l'adresse ecrite.",
    savedOffline: isSpanish
      ? "Tu carrito queda guardado en este telefono si la conexion baja."
      : "Votre panier reste enregistre sur ce telephone si la connexion baisse.",
    manualPaymentNote: isSpanish
      ? "Pagaras al momento de la entrega."
      : "Vous paierez à la livraison.",
    courierComingSoon: isSpanish
      ? "Courier local disponible con soporte OranjeEats."
      : "Course locale disponible avec le support OranjeEats.",
    courierHelp: isSpanish
      ? "Comparte la direccion y los detalles por WhatsApp mientras mantenemos el flujo de pedido intacto."
      : "Partage l'adresse et les details par WhatsApp pendant que nous gardons le flux de commande intact.",
    savedAddressMissing: isSpanish
      ? "Agrega tu direccion en checkout."
      : "Ajoutez votre adresse au checkout.",
    savedAddressLabel: isSpanish ? "Entrega" : "Livraison",
  };
}

export function getHomeSurfaceTabs(cityOrMarket) {
  const { isSpanish } = getCustomerUiCopy(cityOrMarket);
  return [
    { key: "food", label: isSpanish ? "Comida" : "Food" },
    { key: "shops", label: isSpanish ? "Tiendas" : "Shops" },
    { key: "courier", label: "Courier" },
  ];
}

export function getCustomerPaymentOptions(cityOrMarket, availableMethods = []) {
  const market = getMarketConfig(cityOrMarket);
  const isSpanish = market.defaultLanguage === "es";
  const methodSet = new Set(
    (Array.isArray(availableMethods) && availableMethods.length ? availableMethods : market.paymentMethods || ["cash"])
      .map((value) => normalizeLower(value))
  );

  const cashOption = {
    key: "cash",
    backendMethod: "cash",
    label: isSpanish ? "Efectivo / Cash" : "Espèces / Cash",
    note: getCustomerUiCopy(cityOrMarket).manualPaymentNote,
  };

  const mobileMoneyOptions = [
    {
      key: "orange_money",
      backendMethod: "mobile_money",
      label: "Orange Money",
      note: isSpanish
        ? "Pago seguro en linea via PayTech."
        : "Paiement securise en ligne via PayTech.",
    },
    {
      key: "wave",
      backendMethod: "mobile_money",
      label: "Wave",
      note: isSpanish
        ? "Pago seguro en linea via PayTech."
        : "Paiement securise en ligne via PayTech.",
    },
    {
      key: "moov_money",
      backendMethod: "mobile_money",
      label: "Moov Money",
      note: isSpanish
        ? "Pago seguro en linea via PayTech."
        : "Paiement securise en ligne via PayTech.",
    },
  ];

  const payTechOption = {
    key: "paytech",
    backendMethod: "paytech",
    label: isSpanish
      ? "Payer avec Orange Money / Wave / Carte"
      : "Payer avec Orange Money / Wave / Carte",
    note: isSpanish
      ? "Pago seguro en linea via PayTech."
      : "Paiement securise en ligne via PayTech.",
  };

  const options = [];
  if (methodSet.has("cash")) options.push(cashOption);
  if (methodSet.has("mobile_money")) {
    options.push(...mobileMoneyOptions);
  }
  if (methodSet.has("paytech")) {
    options.push(payTechOption);
  }

  return options.length ? options : [cashOption];
}

export function isShopBusinessType(value) {
  const normalized = normalizeLower(value);
  return (
    normalized.includes("shop") ||
    normalized.includes("store") ||
    normalized.includes("retail") ||
    normalized.includes("colmado") ||
    normalized.includes("grocery") ||
    normalized.includes("supermarket") ||
    normalized.includes("market") ||
    normalized.includes("pharmacy")
  );
}

export function composeDeliveryAddress({ addressLine, district, landmark }) {
  const parts = [normalize(addressLine), normalize(district)].filter(Boolean);
  let summary = parts.join(", ");
  const safeLandmark = normalize(landmark);
  if (safeLandmark) {
    summary = summary ? `${summary} | ${safeLandmark}` : safeLandmark;
  }
  return summary;
}

export function readSavedCustomerAddress(savedCustomer) {
  const safeSaved = savedCustomer && typeof savedCustomer === "object" ? savedCustomer : {};
  const addressLine = normalize(safeSaved.addressLine || safeSaved.address);
  const district = normalize(safeSaved.district || safeSaved.neighborhood || safeSaved.quartier);
  const landmark = normalize(safeSaved.landmark || safeSaved.repere);
  const deliveryInstructions = normalize(safeSaved.deliveryInstructions || safeSaved.notes);

  return {
    addressLine,
    district,
    landmark,
    deliveryInstructions,
    composedAddress: composeDeliveryAddress({ addressLine, district, landmark }),
  };
}

export function buildSavedAddressSummary(savedCustomer, cityOrMarket) {
  const copy = getCustomerUiCopy(cityOrMarket);
  const fields = readSavedCustomerAddress(savedCustomer);
  return fields.composedAddress || copy.savedAddressMissing;
}
