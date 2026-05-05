import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAppShell } from "../context/AppShellContext";
import LoyaltySummaryCard from "../components/LoyaltySummaryCard";
import { apiGet, apiPost } from "../lib/api";
import { clearCart, getCart, getCartSubtotal } from "../lib/cart";
import { getProductSizeLabel } from "../lib/catalogPresentation";
import {
  composeDeliveryAddress,
  getCustomerPaymentOptions,
  getCustomerUiCopy,
  readSavedCustomerAddress,
} from "../lib/customerUi";
import { paymentMethodLabel } from "../lib/formatters";
import { getSupportAvailability } from "../lib/orderPresentation";
import formatPrice from "../lib/formatPrice";
import { getCurrentCoords } from "../lib/location";
import { getOrCreateSessionId } from "../lib/sessionId";
import { openSupportWhatsApp } from "../lib/supportWhatsApp";
import { getUserProfile } from "../lib/userProfile";

const SAVED_CUSTOMER_KEY = "aisha_saved_customer";

function normalizePhone(value) {
  return String(value || "").replace(/\D+/g, "").trim();
}

function normalizeCheckoutPaymentMethod(method) {
  const normalized = String(method || "").trim().toLowerCase();
  if (["wave", "orange_money", "moov_money", "mobile_money"].includes(normalized)) {
    return "paytech";
  }
  if (normalized === "paytech") return "paytech";
  return "cash";
}

export default function CheckoutScreen({ navigation }) {
  const { selectedCity, market } = useAppShell();
  const [cart, setCart] = useState({ businessId: "", businessName: "", items: [] });
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [district, setDistrict] = useState("");
  const [landmark, setLandmark] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [lat, setLat] = useState(null);
  const [lng, setLng] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [selectedPaymentOption, setSelectedPaymentOption] = useState("cash");
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [promoResult, setPromoResult] = useState(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoMessage, setPromoMessage] = useState("");
  const [referralCodeInput, setReferralCodeInput] = useState("");
  const [referralMessage, setReferralMessage] = useState("");
  const [referralValid, setReferralValid] = useState(false);
  const [referralLoading, setReferralLoading] = useState(false);
  const [loyalty, setLoyalty] = useState(null);
  const [loyaltyLoading, setLoyaltyLoading] = useState(false);
  const [loyaltyError, setLoyaltyError] = useState("");
  const [loyaltyReloadNonce, setLoyaltyReloadNonce] = useState(0);
  const [deliveryQuote, setDeliveryQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteNotice, setQuoteNotice] = useState("");
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationStatus, setLocationStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const uiCopy = useMemo(() => getCustomerUiCopy(market), [market]);
  const supportAvailability = useMemo(() => getSupportAvailability(market), [market]);
  const composedAddress = useMemo(
    () => composeDeliveryAddress({ addressLine, district, landmark }),
    [addressLine, district, landmark]
  );
  const isSpanish = market.defaultLanguage === "es";
  const text = isSpanish
    ? {
        title: "Pago",
        subtitle: "Confirma los detalles de tu pedido antes de enviarlo.",
        support: "Soporte por WhatsApp",
        supportUnavailable: "Soporte no disponible",
        supportPrompt: "Necesito ayuda para finalizar mi pedido.",
        orderSummary: "Resumen del pedido",
        restaurant: "Restaurante",
        subtotal: "Subtotal",
        discount: "Descuento",
        deliveryFee: "Costo de entrega",
        total: "Total estimado",
        payment: "Pago",
        paymentMethod: "Metodo de pago",
        cash: "Pago contra entrega",
        mobileMoney: "Dinero movil",
        promo: "Codigo promo",
        promoPlaceholder: "PROMO2026",
        promoApply: "Aplicar",
        promoMissing: "Ingresa primero un codigo promo.",
        promoEmpty: "Tu carrito esta vacio.",
        promoApplied: "Codigo promo aplicado.",
        promoError: "No fue posible aplicar el codigo promo.",
        referral: "Codigo de referido",
        referralPlaceholder: "Codigo de referido",
        referralValidate: "Validar",
        referralNeedsPhone: "Ingresa tu numero antes de validar un codigo de referido.",
        referralValid: "El codigo de referido es valido.",
        referralInvalid: "Codigo de referido invalido.",
        referralError: "No fue posible validar el codigo de referido.",
        loyaltyTitle: "Fidelidad y billetera",
        deliveryDetails: "Detalles de entrega",
        namePlaceholder: "Tu nombre",
        phonePlaceholder: "Telefono",
        addressPlaceholder: "Direccion completa",
        districtPlaceholder: "Barrio / Quartier",
        landmarkPlaceholder: "Punto de referencia",
        notesPlaceholder: "Instrucciones de entrega",
        useGps: "Usar mi ubicacion actual",
        usingGps: "Leyendo GPS...",
        city: "Ciudad",
        cityMissing: "No seleccionada",
        paymentNote: uiCopy.manualPaymentNote,
        weakConnection: uiCopy.weakConnection,
        paytechPending:
          "Pago iniciado. Completa el pago en PayTech y vuelve para seguir el estado del pedido.",
        paytechInitFailed:
          "El pedido fue creado, pero no pudimos abrir el pago de PayTech. Revisa el estado del pedido o contacta soporte.",
        submit: "Enviar pedido",
        promoButton: "Aplicar",
        referralButton: "Validar",
        emptyCart: "Tu carrito esta vacio.",
        missingName: "Ingresa tu nombre.",
        missingPhone: "Ingresa tu numero de telefono.",
        missingAddress: "Ingresa tu direccion.",
        missingCity: "Selecciona una ciudad antes de continuar.",
        createError: "No fue posible crear el pedido.",
        loading: "Preparando checkout...",
      }
    : {
        title: "Paiement",
        subtitle: "Confirme les details de ta commande avant de valider.",
        support: "Support WhatsApp",
        supportUnavailable: "Support indisponible",
        supportPrompt: "J'ai besoin d'aide pour finaliser ma commande.",
        orderSummary: "Resume de la commande",
        restaurant: "Restaurant",
        subtotal: "Sous-total",
        discount: "Remise",
        deliveryFee: "Frais de livraison",
        total: "Total estime",
        payment: "Paiement",
        paymentMethod: "Mode de paiement",
        cash: "Paiement a la livraison",
        mobileMoney: "Mobile money",
        promo: "Code promo",
        promoPlaceholder: "PROMO2026",
        promoApply: "Appliquer",
        promoMissing: "Entre d'abord un code promo.",
        promoEmpty: "Ton panier est vide.",
        promoApplied: "Code promo applique.",
        promoError: "Impossible d'appliquer le code promo.",
        referral: "Code de parrainage",
        referralPlaceholder: "Code de parrainage",
        referralValidate: "Verifier",
        referralNeedsPhone: "Entre ton numero avant de verifier un code de parrainage.",
        referralValid: "Le code de parrainage est valide.",
        referralInvalid: "Code de parrainage invalide.",
        referralError: "Impossible de verifier le code de parrainage.",
        loyaltyTitle: "Fidelite et portefeuille",
        deliveryDetails: "Details de livraison",
        namePlaceholder: "Ton nom",
        phonePlaceholder: "Telephone",
        addressPlaceholder: "Adresse complete",
        districtPlaceholder: "Quartier",
        landmarkPlaceholder: "Repère / point de repère",
        notesPlaceholder: "Instructions de livraison",
        useGps: "Utiliser ma localisation",
        usingGps: "Lecture GPS...",
        city: "Ville",
        cityMissing: "Non selectionnee",
        paymentNote: uiCopy.manualPaymentNote,
        weakConnection: uiCopy.weakConnection,
        paytechPending:
          "Paiement lance. Termine le paiement dans PayTech puis reviens suivre la commande.",
        paytechInitFailed:
          "La commande est creee, mais le paiement PayTech n'a pas pu s'ouvrir. Verifie l'etat de la commande ou contacte le support.",
        submit: "Commander",
        promoButton: "Appliquer",
        referralButton: "Verifier",
        emptyCart: "Ton panier est vide.",
        missingName: "Entre ton nom.",
        missingPhone: "Entre ton numero de telephone.",
        missingAddress: "Entre ton adresse.",
        missingCity: "Selectionne une ville avant de continuer.",
        createError: "Impossible de creer la commande.",
        loading: "Preparation du checkout...",
      };

  const availablePaymentMethods = useMemo(() => {
    const methods = Array.isArray(market.paymentMethods) && market.paymentMethods.length
      ? market.paymentMethods
      : ["cash"];
    return methods.filter(
      (method) =>
        method === "cash" ||
        method === "orange_money" ||
        method === "wave" ||
        method === "moov_money" ||
        method === "mobile_money" ||
        method === "paytech"
    );
  }, [market.paymentMethods]);

  const paymentOptions = useMemo(
    () => getCustomerPaymentOptions(market, availablePaymentMethods),
    [availablePaymentMethods, market]
  );
  const selectedPaymentOptionConfig = useMemo(
    () =>
      paymentOptions.find((option) => option.key === selectedPaymentOption) ||
      paymentOptions[0] ||
      null,
    [paymentOptions, selectedPaymentOption]
  );

  useEffect(() => {
    if (!paymentOptions.some((option) => option.key === selectedPaymentOption)) {
      const fallback = paymentOptions[0] || { key: "cash", backendMethod: "cash" };
      setSelectedPaymentOption(fallback.key);
      setPaymentMethod(fallback.backendMethod);
    }
  }, [paymentOptions, selectedPaymentOption]);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      try {
        const currentCart = await getCart();
        if (!mounted) return;
        setCart(currentCart || { businessId: "", businessName: "", items: [] });

        const raw = await AsyncStorage.getItem(SAVED_CUSTOMER_KEY);
        if (!mounted || !raw) return;
        const saved = JSON.parse(raw);
        const savedAddress = readSavedCustomerAddress(saved);
        const savedPreferredPaymentMethod = String(
          saved?.preferredPaymentMethod || saved?.paymentMethod || ""
        ).trim();
        setCustomerName(String(saved?.customerName || ""));
        setPhone(normalizePhone(saved?.phone));
        setAddressLine(savedAddress.addressLine);
        setDistrict(savedAddress.district);
        setLandmark(savedAddress.landmark);
        setDeliveryInstructions(savedAddress.deliveryInstructions);
        if (savedPreferredPaymentMethod) {
          setSelectedPaymentOption(savedPreferredPaymentMethod);
          setPaymentMethod(
            savedPreferredPaymentMethod === "cash"
              ? "cash"
              : savedPreferredPaymentMethod === "paytech"
              ? "paytech"
              : "mobile_money"
          );
        }
        if (Number.isFinite(Number(saved?.lat))) setLat(Number(saved.lat));
        if (Number.isFinite(Number(saved?.lng))) setLng(Number(saved.lng));

        const savedPhone = normalizePhone(saved?.phone);
        if (savedPhone) {
          try {
            const profile = await getUserProfile(savedPhone);
            if (!mounted) return;
            if (String(profile?.displayName || "").trim()) {
              setCustomerName((current) => current || String(profile.displayName || ""));
            }
            if (String(profile?.city || "").trim()) {
              setDistrict((current) => current || String(profile.city || ""));
            }
          } catch {
            // Best effort only.
          }
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    boot().catch(() => {
      if (mounted) setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setPromoResult(null);
    setPromoMessage("");
  }, [cart.businessId, cart.items]);

  useEffect(() => {
    const safePhone = normalizePhone(phone);
    if (!safePhone || safePhone.length < 8) {
      setLoyalty(null);
      setLoyaltyError("");
      return undefined;
    }

    let mounted = true;
    const timer = setTimeout(async () => {
      setLoyaltyLoading(true);
      setLoyaltyError("");
      try {
        const response = await apiGet(`/api/public/loyalty?phone=${encodeURIComponent(safePhone)}`);
        if (!mounted) return;
        setLoyalty(response || null);
      } catch (requestError) {
        if (!mounted) return;
        setLoyalty(null);
        setLoyaltyError(requestError?.message || text.referralError);
      } finally {
        if (mounted) setLoyaltyLoading(false);
      }
    }, 350);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [phone, loyaltyReloadNonce, text.referralError]);

  useEffect(() => {
    let mounted = true;
    const businessId = String(cart.businessId || "").trim();
    const latNumber = Number(lat);
    const lngNumber = Number(lng);

    if (!businessId || !Number.isFinite(latNumber) || !Number.isFinite(lngNumber)) {
      setDeliveryQuote(null);
      setQuoteNotice("");
      return undefined;
    }

    async function loadQuote() {
      setQuoteLoading(true);
      setQuoteNotice("");
      try {
        const response = await apiGet(
          `/api/public/delivery/quote?businessId=${encodeURIComponent(
            businessId
          )}&lat=${latNumber}&lng=${lngNumber}`
        );
        if (!mounted) return;
        setDeliveryQuote(response || null);
      } catch {
        if (!mounted) return;
        setDeliveryQuote(null);
        setQuoteNotice(uiCopy.weakConnection);
      } finally {
        if (mounted) setQuoteLoading(false);
      }
    }

    loadQuote().catch(() => null);
    return () => {
      mounted = false;
    };
  }, [cart.businessId, lat, lng, uiCopy.weakConnection]);

  const subtotal = useMemo(() => getCartSubtotal(cart), [cart]);
  const safePhone = normalizePhone(phone);
  const discountAmount = Number(promoResult?.discount || 0);
  const finalSubtotal = Number(promoResult?.finalSubtotal || subtotal);
  const deliveryFee = Number(deliveryQuote?.delivery?.fee || 0);
  const estimatedTotal = finalSubtotal + deliveryFee;
  const validationMessage = useMemo(() => {
    if (!cart.businessId || !(cart.items || []).length) return text.emptyCart;
    if (!String(customerName || "").trim()) return text.missingName;
    if (!safePhone) return text.missingPhone;
    if (!String(addressLine || "").trim()) return text.missingAddress;
    if (!selectedCity?._id) return text.missingCity;
    return "";
  }, [addressLine, cart.businessId, cart.items, customerName, safePhone, selectedCity?._id, text]);

  async function applyPromo() {
    const code = String(promoCodeInput || "").trim().toUpperCase();
    if (!code) {
      Alert.alert(text.promo, text.promoMissing);
      return;
    }
    if (subtotal <= 0) {
      Alert.alert(text.promo, text.promoEmpty);
      return;
    }
    setPromoLoading(true);
    setPromoMessage("");
    try {
      const response = await apiPost("/api/public/promo/apply", {
        code,
        orderSubtotal: subtotal,
        cityId: selectedCity?._id,
      });
      setPromoResult(response || null);
      setPromoMessage(text.promoApplied);
    } catch (requestError) {
      setPromoResult(null);
      setPromoMessage(requestError?.message || text.promoError);
    } finally {
      setPromoLoading(false);
    }
  }

  async function validateReferral() {
    const code = String(referralCodeInput || "").trim().toUpperCase();
    if (!code) {
      setReferralValid(false);
      setReferralMessage("");
      return;
    }
    if (!safePhone) {
      Alert.alert(text.referral, text.referralNeedsPhone);
      return;
    }
    setReferralLoading(true);
    try {
      const response = await apiPost("/api/public/referral/validate", {
        code,
        phone: safePhone,
      });
      const valid = Boolean(response?.valid);
      setReferralValid(valid);
      setReferralMessage(valid ? text.referralValid : response?.reason || text.referralInvalid);
    } catch (requestError) {
      setReferralValid(false);
      setReferralMessage(requestError?.message || text.referralError);
    } finally {
      setReferralLoading(false);
    }
  }

  async function useGpsLocation() {
    setLocationLoading(true);
    setLocationStatus("");
    const result = await getCurrentCoords();
    setLocationLoading(false);

    if (!result.ok) {
      setLocationStatus(uiCopy.locationUnavailable);
      return;
    }

    setLat(result.coords.lat);
    setLng(result.coords.lng);
    setLocationStatus(uiCopy.locationCaptured);
  }

  async function submitOrder() {
    if (validationMessage) {
      Alert.alert(text.payment, validationMessage);
      return;
    }

    const referralCode = String(referralCodeInput || "").trim().toUpperCase();
    if (referralCode && !referralValid) {
      const response = await apiPost("/api/public/referral/validate", {
        code: referralCode,
        phone: safePhone,
      }).catch((requestError) => ({
        valid: false,
        reason: requestError?.message || text.referralError,
      }));

      if (!response?.valid) {
        setReferralValid(false);
        setReferralMessage(response?.reason || text.referralInvalid);
        Alert.alert(text.referral, response?.reason || text.referralInvalid);
        return;
      }

      setReferralValid(true);
      setReferralMessage(text.referralValid);
    }

    setSubmitting(true);
    setError("");
    try {
      const sessionId = await getOrCreateSessionId();
      const requestedPaymentMethod =
        selectedPaymentOption === "cash"
          ? paymentMethod
          : selectedPaymentOption || paymentMethod;
      const orderPaymentMethod = normalizeCheckoutPaymentMethod(requestedPaymentMethod);
      const isPayTechCheckout = orderPaymentMethod === "paytech";
      const response = await apiPost("/api/public/orders", {
        cityId: selectedCity?._id,
        restaurantId: cart.businessId,
        businessId: cart.businessId,
        items: (cart.items || []).map((item) => ({
          itemId: item.productId,
          quantity: Number(item.qty || 1),
          name: item.name,
          price: Number(item.price || 0),
          category: String(item.category || ""),
          displaySize: getProductSizeLabel(item),
          quantityValue: item.quantityValue ?? null,
          quantityUnit: String(item.quantityUnit || ""),
        })),
        customerName: String(customerName || "").trim(),
        phone: safePhone,
        address: String(composedAddress || "").trim(),
        notes: String(deliveryInstructions || "").trim(),
        paymentMethod: orderPaymentMethod,
        promoCode: promoResult?.code || undefined,
        referralCode: referralCode || undefined,
        sessionId,
        ...(Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
          ? { lat: Number(lat), lng: Number(lng) }
          : {}),
      });
      let paytechPaymentUrl = "";
      let paymentLinkError = "";

      if (isPayTechCheckout) {
        try {
          const paymentInit = await apiPost("/api/payments/paytech/request", {
            orderId: response?.orderId,
          });
          paytechPaymentUrl = String(paymentInit?.paymentUrl || "").trim();
          if (!paytechPaymentUrl) {
            paymentLinkError = text.paytechInitFailed;
          }
        } catch (requestError) {
          paymentLinkError = requestError?.message || text.paytechInitFailed;
        }
      }

      await AsyncStorage.setItem(
        SAVED_CUSTOMER_KEY,
        JSON.stringify({
          customerName: String(customerName || "").trim(),
          phone: safePhone,
          address: String(composedAddress || "").trim(),
          addressLine: String(addressLine || "").trim(),
          district: String(district || "").trim(),
          landmark: String(landmark || "").trim(),
          notes: String(deliveryInstructions || "").trim(),
          deliveryInstructions: String(deliveryInstructions || "").trim(),
          preferredPaymentMethod: selectedPaymentOption,
          paymentMethod,
          lat: Number.isFinite(Number(lat)) ? Number(lat) : null,
          lng: Number.isFinite(Number(lng)) ? Number(lng) : null,
          updatedAt: new Date().toISOString(),
        })
      );

      await clearCart().catch(() => null);

      navigation.replace("Confirmation", {
        orderId: response?.orderId,
        orderNumber: response?.orderNumber,
        businessId: response?.businessId || cart.businessId,
        businessName: response?.businessName || cart.businessName,
        payment: {
          ...(response?.payment || { status: "pending" }),
          method:
            response?.payment?.method === "mobile_money"
              ? selectedPaymentOption
              : response?.payment?.method ||
                (selectedPaymentOption === "cash" ? "cash" : selectedPaymentOption),
          status: isPayTechCheckout
            ? "pending"
            : response?.payment?.status || "pending",
          provider: isPayTechCheckout
            ? "paytech"
            : response?.payment?.provider || null,
        },
        totals: response?.totals || {
          subtotalBefore: subtotal,
          discountAmount,
          subtotalAfter: finalSubtotal,
          deliveryFeeToCustomer: deliveryFee,
          total: estimatedTotal,
        },
        loyalty: response?.loyalty || {
          pendingPoints: Math.max(0, Math.floor(estimatedTotal / 100)),
          referralCodeUsed: referralCode || null,
          referralRewardPending: Boolean(referralCode),
        },
        contact: response?.contact || null,
        support: response?.support || null,
        delivery: response?.delivery || null,
        deliveryOtp: response?.deliveryOtp || "",
        deliveryProof: response?.deliveryProof || null,
        city: selectedCity,
        paytechPaymentUrl: isPayTechCheckout ? paytechPaymentUrl : "",
        paymentPendingNotice: isPayTechCheckout ? text.paytechPending : "",
        paymentLinkError: isPayTechCheckout ? paymentLinkError : "",
      });

      if (isPayTechCheckout && paytechPaymentUrl) {
        Linking.openURL(paytechPaymentUrl).catch(() => {
          Alert.alert(text.payment, text.paytechPending);
        });
      } else if (isPayTechCheckout && paymentLinkError) {
        Alert.alert(text.payment, paymentLinkError);
      }
    } catch (requestError) {
      const message = requestError?.message || text.createError;
      setError(message);
      Alert.alert(text.payment, message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.stateCard}>
        <ActivityIndicator color="#F97316" />
        <Text style={styles.stateText}>{text.loading}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.safeArea}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{text.title}</Text>
        <Text style={styles.subtitle}>{text.subtitle}</Text>

        <Pressable
          disabled={!supportAvailability.configured}
          onPress={() =>
            openSupportWhatsApp({
              businessName: cart.businessName,
              issuePrompt: text.supportPrompt,
              city: selectedCity,
            })
          }
          style={[styles.supportButton, !supportAvailability.configured && styles.supportButtonDisabled]}
        >
          <Text style={styles.supportButtonText}>
            {supportAvailability.configured ? text.support : text.supportUnavailable}
          </Text>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{text.orderSummary}</Text>
          <Text style={styles.summaryRow}>
            {text.restaurant}: {String(cart.businessName || "").trim() || "Restaurant"}
          </Text>
          {(cart.items || []).map((item) => {
            const sizeLabel = getProductSizeLabel(item);
            return (
              <Text key={String(item.productId || item.name)} style={styles.summaryItem}>
                {Number(item.qty || 1)} x {String(item.name || "Menu item")}
                {sizeLabel ? ` (${sizeLabel})` : ""} - {formatPrice(Number(item.price || 0), market)}
              </Text>
            );
          })}
          <Text style={styles.summaryRow}>
            {text.subtotal}: {formatPrice(subtotal, market)}
          </Text>
          <Text style={styles.summaryRow}>
            {text.discount}: {discountAmount > 0 ? `-${formatPrice(discountAmount, market)}` : formatPrice(0, market)}
          </Text>
          <Text style={styles.summaryRow}>
            {text.deliveryFee}: {quoteLoading ? "..." : formatPrice(deliveryFee, market)}
          </Text>
          <Text style={styles.summaryTotal}>
            {text.total}: {formatPrice(estimatedTotal, market)}
          </Text>
          <Text style={styles.helperText}>
            {text.payment}: {paymentMethodLabel(selectedPaymentOption, market)}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{text.paymentMethod}</Text>
          <View style={styles.optionRow}>
            {paymentOptions.map((option) => {
              const active = selectedPaymentOption === option.key;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => {
                    setSelectedPaymentOption(option.key);
                    setPaymentMethod(option.backendMethod);
                  }}
                  style={[styles.optionCard, active && styles.optionCardActive]}
                >
                  <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.helperText}>
            {selectedPaymentOptionConfig?.note || text.paymentNote}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{text.promo}</Text>
          <View style={styles.inlineRow}>
            <TextInput
              value={promoCodeInput}
              onChangeText={(value) => setPromoCodeInput(String(value || "").toUpperCase())}
              placeholder={text.promoPlaceholder}
              placeholderTextColor="#94A3B8"
              style={[styles.input, styles.inlineInput]}
              autoCapitalize="characters"
            />
            <Pressable
              onPress={applyPromo}
              disabled={promoLoading}
              style={[styles.inlineButton, promoLoading && styles.inlineButtonDisabled]}
            >
              <Text style={styles.inlineButtonText}>{promoLoading ? "..." : text.promoButton}</Text>
            </Pressable>
          </View>
          {!!promoMessage ? (
            <Text style={[styles.helperText, promoResult ? styles.successText : styles.errorText]}>
              {promoMessage}
            </Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{text.referral}</Text>
          <View style={styles.inlineRow}>
            <TextInput
              value={referralCodeInput}
              onChangeText={(value) => {
                setReferralCodeInput(String(value || "").toUpperCase());
                setReferralValid(false);
                setReferralMessage("");
              }}
              placeholder={text.referralPlaceholder}
              placeholderTextColor="#94A3B8"
              style={[styles.input, styles.inlineInput]}
              autoCapitalize="characters"
            />
            <Pressable
              onPress={validateReferral}
              disabled={referralLoading}
              style={[styles.inlineButton, referralLoading && styles.inlineButtonDisabled]}
            >
              <Text style={styles.inlineButtonText}>{referralLoading ? "..." : text.referralButton}</Text>
            </Pressable>
          </View>
          {!!referralMessage ? (
            <Text style={[styles.helperText, referralValid ? styles.successText : styles.errorText]}>
              {referralMessage}
            </Text>
          ) : null}
        </View>

        <LoyaltySummaryCard
          title={text.loyaltyTitle}
          loyalty={loyalty}
          loading={loyaltyLoading}
          error={loyaltyError}
          onRetry={() => setLoyaltyReloadNonce((value) => value + 1)}
          city={selectedCity}
        />

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{text.deliveryDetails}</Text>
          <TextInput
            value={customerName}
            onChangeText={setCustomerName}
            placeholder={text.namePlaceholder}
            placeholderTextColor="#94A3B8"
            style={styles.input}
          />
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder={text.phonePlaceholder}
            placeholderTextColor="#94A3B8"
            keyboardType="phone-pad"
            style={styles.input}
          />
          <TextInput
            value={addressLine}
            onChangeText={setAddressLine}
            placeholder={text.addressPlaceholder}
            placeholderTextColor="#94A3B8"
            style={styles.input}
          />
          <TextInput
            value={district}
            onChangeText={setDistrict}
            placeholder={text.districtPlaceholder}
            placeholderTextColor="#94A3B8"
            style={styles.input}
          />
          <TextInput
            value={landmark}
            onChangeText={setLandmark}
            placeholder={text.landmarkPlaceholder}
            placeholderTextColor="#94A3B8"
            style={styles.input}
          />
          <TextInput
            value={deliveryInstructions}
            onChangeText={setDeliveryInstructions}
            placeholder={text.notesPlaceholder}
            placeholderTextColor="#94A3B8"
            multiline
            style={[styles.input, styles.textArea]}
          />

          <Pressable
            onPress={useGpsLocation}
            disabled={locationLoading}
            style={[styles.secondaryButton, locationLoading && styles.secondaryButtonDisabled]}
          >
            <Text style={styles.secondaryButtonText}>
              {locationLoading ? text.usingGps : text.useGps}
            </Text>
          </Pressable>

          <Text style={styles.helperText}>
            {text.city}: {selectedCity?.name || text.cityMissing}
            {locationStatus ? ` | ${locationStatus}` : ""}
          </Text>
          {quoteNotice ? <Text style={styles.helperText}>{quoteNotice}</Text> : null}
        </View>

        {validationMessage ? <Text style={styles.helperText}>{validationMessage}</Text> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable
          onPress={submitOrder}
          disabled={submitting || Boolean(validationMessage)}
          style={[styles.primaryButton, (submitting || validationMessage) && styles.primaryButtonDisabled]}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>{text.submit}</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 14,
  },
  title: {
    fontSize: 30,
    fontWeight: "900",
    color: "#0F172A",
  },
  subtitle: {
    color: "#64748B",
    fontSize: 14,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "900",
  },
  summaryRow: {
    color: "#334155",
    fontSize: 14,
  },
  summaryItem: {
    color: "#475569",
    fontSize: 13,
    lineHeight: 18,
  },
  summaryTotal: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "900",
  },
  helperText: {
    color: "#64748B",
    fontSize: 13,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: "#0F172A",
  },
  textArea: {
    minHeight: 84,
    textAlignVertical: "top",
  },
  supportButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#FFFFFF",
  },
  supportButtonText: {
    color: "#334155",
    fontWeight: "800",
  },
  supportButtonDisabled: {
    opacity: 0.55,
  },
  optionRow: {
    gap: 10,
  },
  optionCard: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#FFFFFF",
  },
  optionCardActive: {
    borderColor: "#0F172A",
    backgroundColor: "#F8FAFC",
  },
  optionTitle: {
    color: "#334155",
    fontWeight: "700",
  },
  optionTitleActive: {
    color: "#0F172A",
    fontWeight: "900",
  },
  inlineRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  inlineInput: {
    flex: 1,
  },
  inlineButton: {
    backgroundColor: "#0F172A",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inlineButtonDisabled: {
    backgroundColor: "#64748B",
  },
  inlineButtonText: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  secondaryButton: {
    backgroundColor: "#0F172A",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryButtonDisabled: {
    opacity: 0.7,
  },
  secondaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  primaryButton: {
    backgroundColor: "#F97316",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 54,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 16,
  },
  successText: {
    color: "#15803D",
  },
  errorText: {
    color: "#B91C1C",
  },
  stateCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 16,
    margin: 16,
    padding: 20,
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  stateText: {
    color: "#64748B",
    fontSize: 14,
  },
});
