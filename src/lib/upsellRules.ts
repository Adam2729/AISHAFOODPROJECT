type ProductLike = {
  productId: string;
  name: string;
  price: number;
  imageUrl?: string;
  category?: string;
};

type CartLine = {
  productId: string;
  qty: number;
};

type BuildSuggestionsArgs = {
  businessType: string;
  cartItems: CartLine[];
  cartProducts: ProductLike[];
  availableProducts: ProductLike[];
  subtotal: number;
};

type Suggestion = ProductLike & {
  reasonEs: string;
};

export const drinksKeywords = ["bebida", "jug", "refresco", "soda", "agua"];
export const sidesKeywords = ["side", "acompan", "papas", "tost", "arep", "yuca"];
export const essentialsKeywords = ["pan", "leche", "huevo", "arroz", "aceite"];

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function productText(product: ProductLike) {
  return normalizeText(`${product.name || ""} ${product.category || ""}`);
}

function hasAnyKeyword(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(normalizeText(keyword)));
}

export function isDrinkLike(product: ProductLike) {
  return hasAnyKeyword(productText(product), drinksKeywords);
}

export function isSideLike(product: ProductLike) {
  return hasAnyKeyword(productText(product), sidesKeywords);
}

export function isEssentialLike(product: ProductLike) {
  return hasAnyKeyword(productText(product), essentialsKeywords);
}

function sortByImageThenPrice(left: ProductLike, right: ProductLike) {
  const leftHasImage = left.imageUrl ? 1 : 0;
  const rightHasImage = right.imageUrl ? 1 : 0;
  if (leftHasImage !== rightHasImage) {
    return rightHasImage - leftHasImage;
  }
  if (left.price !== right.price) {
    return left.price - right.price;
  }
  return left.name.localeCompare(right.name, "es");
}

function pickFirst(
  products: ProductLike[],
  used: Set<string>,
  predicate: (product: ProductLike) => boolean
) {
  for (const product of products) {
    const productId = String(product.productId || "");
    if (!productId || used.has(productId)) continue;
    if (!predicate(product)) continue;
    used.add(productId);
    return product;
  }
  return null;
}

export function buildUpsellSuggestions(args: BuildSuggestionsArgs): Suggestion[] {
  const businessType = String(args.businessType || "").trim().toLowerCase();
  const subtotal = Number(args.subtotal || 0);
  const cartProducts = Array.isArray(args.cartProducts) ? args.cartProducts : [];
  const inCartIds = new Set(
    (Array.isArray(args.cartItems) ? args.cartItems : [])
      .map((row) => String(row.productId || ""))
      .filter(Boolean)
  );

  const availableProducts = (Array.isArray(args.availableProducts) ? args.availableProducts : [])
    .filter((row) => String(row.productId || "") && !inCartIds.has(String(row.productId)))
    .sort(sortByImageThenPrice);

  const suggestions: Suggestion[] = [];
  const used = new Set<string>();

  const hasDrinksInCart = cartProducts.some(isDrinkLike);
  const hasSidesInCart = cartProducts.some(isSideLike);
  const onlyMainsInCart = cartProducts.length > 0 && !hasDrinksInCart && !hasSidesInCart;
  const onlyStaplesInCart =
    businessType === "colmado" &&
    cartProducts.length > 0 &&
    cartProducts.every((product) => isEssentialLike(product));

  if (onlyMainsInCart) {
    const drink = pickFirst(availableProducts, used, isDrinkLike);
    if (drink) {
      suggestions.push({
        ...drink,
        reasonEs: "Agrega una bebida para completar tu pedido.",
      });
    }
  }

  if (onlyStaplesInCart) {
    const essential = pickFirst(availableProducts, used, isEssentialLike);
    if (essential) {
      suggestions.push({
        ...essential,
        reasonEs: "Te puede faltar un esencial para la compra.",
      });
    }
  }

  if (subtotal < 400) {
    while (suggestions.length < 2) {
      const cheap = pickFirst(availableProducts, used, () => true);
      if (!cheap) break;
      suggestions.push({
        ...cheap,
        reasonEs: "Completa tu pedido con una opcion economica.",
      });
    }
  }

  while (suggestions.length < 2) {
    const generic = pickFirst(availableProducts, used, () => true);
    if (!generic) break;
    suggestions.push({
      ...generic,
      reasonEs: "Sugerido para completar tu compra.",
    });
  }

  return suggestions.slice(0, 2);
}

