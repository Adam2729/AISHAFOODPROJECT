import { Alert, Linking } from "react-native";
import { getSelectedCity } from "./citySelection";
import { getMarketConfig } from "./marketConfig";

function normalizeDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

export async function openSupportWhatsApp({
  orderNumber,
  businessName,
  supportWhatsApp,
  defaultText,
  issuePrompt,
  city,
}) {
  const selectedCity = city || (await getSelectedCity().catch(() => null));
  const market = getMarketConfig(selectedCity);
  const explicitSupport = normalizeDigits(supportWhatsApp);
  const waPath = explicitSupport || market.supportWhatsApp;
  const isSpanish = market.defaultLanguage === "es";
  const usingPlaceholderSupport =
    (!explicitSupport && !market.supportWhatsAppConfigured) ||
    !normalizeDigits(waPath) ||
    market.supportWhatsAppIsPlaceholder;

  if (usingPlaceholderSupport) {
    Alert.alert(
      isSpanish ? "Soporte no configurado" : "Support non configure",
      isSpanish
        ? "El numero de soporte sigue en placeholder. Reemplazalo por la linea real de WhatsApp antes del lanzamiento."
        : "Le numero de support est encore un placeholder. Remplace-le par la vraie ligne WhatsApp avant le lancement."
    );
    return false;
  }

  const safeOrderNumber = String(orderNumber || "").trim();
  const safeBusinessName = String(businessName || "").trim();
  const baseText =
    String(defaultText || "").trim() ||
    (isSpanish
      ? "Hola, necesito ayuda con mi pedido."
      : "Bonjour, j'ai besoin d'aide pour ma commande.");

  const parts = [baseText];
  if (safeOrderNumber && safeBusinessName) {
    parts.push(
      isSpanish
        ? `Pedido ${safeOrderNumber} en ${safeBusinessName}.`
        : `Commande ${safeOrderNumber} chez ${safeBusinessName}.`
    );
  } else if (safeBusinessName) {
    parts.push(isSpanish ? `Restaurante: ${safeBusinessName}.` : `Restaurant : ${safeBusinessName}.`);
  } else if (safeOrderNumber) {
    parts.push(isSpanish ? `Pedido: ${safeOrderNumber}.` : `Commande : ${safeOrderNumber}.`);
  }

  const prompt = String(issuePrompt || "").trim();
  if (prompt) parts.push(prompt);

  const url = `https://wa.me/${waPath}?text=${encodeURIComponent(parts.join(" "))}`;

  try {
    await Linking.openURL(url);
    return true;
  } catch {
    Alert.alert(
      isSpanish ? "Soporte" : "Support",
      isSpanish ? "No fue posible abrir WhatsApp." : "Impossible d'ouvrir WhatsApp."
    );
    return false;
  }
}
