import { Alert, Linking } from "react-native";

export function normalizeWhatsAppDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

export async function openBusinessWhatsApp({
  whatsapp,
  customerName,
  orderNumber,
  businessName,
}) {
  const wa = normalizeWhatsAppDigits(whatsapp);
  if (!wa) return false;

  const safeName = String(customerName || "cliente").trim() || "cliente";
  const safeOrder = String(orderNumber || "").trim();
  const text = `Hola! Soy ${safeName}. Mi pedido es ${safeOrder}.`;
  const url = `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;

  try {
    await Linking.openURL(url);
    return true;
  } catch {
    Alert.alert(
      "No se pudo abrir WhatsApp",
      `No pudimos abrir WhatsApp para contactar a ${businessName || "el negocio"}.`
    );
    return false;
  }
}
