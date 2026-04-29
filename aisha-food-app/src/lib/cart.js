import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "aisha_market_cart_v1";

function normalize(cart) {
  return {
    businessId: cart?.businessId || "",
    businessName: cart?.businessName || "",
    businessType: cart?.businessType || "",
    items: Array.isArray(cart?.items) ? cart.items : [],
  };
}

export async function getCart() {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return normalize({});
  try {
    return normalize(JSON.parse(raw));
  } catch {
    return normalize({});
  }
}

export async function saveCart(cart) {
  await AsyncStorage.setItem(KEY, JSON.stringify(normalize(cart)));
}

export async function clearCart() {
  await AsyncStorage.removeItem(KEY);
}

export async function addToCart({
  businessId,
  businessName,
  businessType,
  productId,
  name,
  price,
  imageUrl,
  image,
  category,
  displaySize,
  quantityValue,
  quantityUnit,
}) {
  const cart = await getCart();
  if (cart.businessId && cart.businessId !== businessId) {
    throw new Error("Solo puedes comprar en un negocio por pedido.");
  }

  const idx = cart.items.findIndex((it) => it.productId === productId);
  if (idx >= 0) {
    cart.items[idx].qty = Math.min(50, Number(cart.items[idx].qty || 1) + 1);
    cart.items[idx] = {
      ...cart.items[idx],
      name,
      price: Number(price),
      imageUrl: String(imageUrl || image || cart.items[idx].imageUrl || cart.items[idx].image || ""),
      image: String(image || imageUrl || cart.items[idx].image || cart.items[idx].imageUrl || ""),
      category: String(category || cart.items[idx].category || ""),
      displaySize: String(displaySize || cart.items[idx].displaySize || ""),
      quantityValue: quantityValue ?? cart.items[idx].quantityValue ?? null,
      quantityUnit: String(quantityUnit || cart.items[idx].quantityUnit || ""),
    };
  } else {
    cart.items.push({
      productId,
      name,
      price: Number(price),
      imageUrl: String(imageUrl || image || ""),
      image: String(image || imageUrl || ""),
      qty: 1,
      category: String(category || ""),
      displaySize: String(displaySize || ""),
      quantityValue: quantityValue ?? null,
      quantityUnit: String(quantityUnit || ""),
    });
  }

  cart.businessId = businessId;
  cart.businessName = businessName;
  cart.businessType = String(businessType || cart.businessType || "");
  await saveCart(cart);
  return cart;
}

export async function updateCartQty(productId, qty) {
  const cart = await getCart();
  const nextQty = Math.max(1, Math.min(50, Number(qty)));
  cart.items = cart.items.map((it) => (it.productId === productId ? { ...it, qty: nextQty } : it));
  await saveCart(cart);
  return cart;
}

export async function removeFromCart(productId) {
  const cart = await getCart();
  cart.items = cart.items.filter((it) => it.productId !== productId);
  if (!cart.items.length) {
    cart.businessId = "";
    cart.businessName = "";
    cart.businessType = "";
  }
  await saveCart(cart);
  return cart;
}

export function getCartSubtotal(cart) {
  return (cart.items || []).reduce((sum, it) => sum + Number(it.price || 0) * Number(it.qty || 0), 0);
}
