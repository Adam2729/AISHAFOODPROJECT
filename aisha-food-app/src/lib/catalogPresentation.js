const UNIT_ALIASES = new Map([
  ["kilogram", "kg"],
  ["kilograms", "kg"],
  ["kgs", "kg"],
  ["gram", "g"],
  ["grams", "g"],
  ["litre", "litre"],
  ["liter", "litre"],
  ["litres", "litre"],
  ["liters", "litre"],
  ["l", "litre"],
  ["millilitre", "ml"],
  ["milliliter", "ml"],
  ["millilitres", "ml"],
  ["milliliters", "ml"],
  ["piece", "piece"],
  ["pieces", "piece"],
  ["pcs", "piece"],
  ["pc", "piece"],
  ["packs", "pack"],
  ["bottles", "bottle"],
  ["cans", "can"],
  ["boxes", "box"],
]);

const UNIT_DISPLAY = {
  kg: "kg",
  g: "g",
  litre: "L",
  ml: "ml",
  piece: "pcs",
  pack: "pack",
  bottle: "bottle",
  can: "can",
  box: "box",
};

function normalizeQuantityUnit(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  const canonical = UNIT_ALIASES.get(normalized) || normalized;
  return UNIT_DISPLAY[canonical] ? canonical : "";
}

function normalizeQuantityValue(value) {
  const parsed = Number(String(value ?? "").trim().replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(3));
}

function formatQuantityValue(value) {
  if (!Number.isFinite(Number(value))) return "";
  return Number.isInteger(Number(value))
    ? String(Number(value))
    : String(Number(value)).replace(/0+$/, "").replace(/\.$/, "");
}

export function getProductSizeLabel(item) {
  const explicit = String(item?.displaySize || item?.sizeLabel || "").trim().replace(/\s+/g, " ");
  const name = String(item?.name || "").trim().toLowerCase();
  if (explicit) {
    return name.includes(explicit.toLowerCase()) ? "" : explicit;
  }

  const quantityValue = normalizeQuantityValue(item?.quantityValue);
  const quantityUnit = normalizeQuantityUnit(item?.quantityUnit);
  if (!quantityValue || !quantityUnit) return "";

  const generated = `${formatQuantityValue(quantityValue)} ${UNIT_DISPLAY[quantityUnit]}`;
  return name.includes(generated.toLowerCase()) ? "" : generated;
}

export function getProductCategoryLabel(item, fallback = "") {
  const category = String(item?.category || item?.categoryName || "").trim().replace(/\s+/g, " ");
  return category || fallback;
}

export function getUnavailableCopy(cityOrMarket) {
  const isSpanish = String(cityOrMarket?.defaultLanguage || "").toLowerCase() === "es";
  return isSpanish ? "Indisponible" : "Indisponible";
}

export function getReorderRemovalMessage(reasonCode, cityOrMarket) {
  const isSpanish = String(cityOrMarket?.defaultLanguage || "").toLowerCase() === "es";
  const code = String(reasonCode || "").trim();
  if (code === "archived") {
    return isSpanish
      ? "Este articulo ya no esta en el catalogo."
      : "Cet article n'est plus au catalogue.";
  }
  if (code === "unavailable") {
    return isSpanish
      ? "Este articulo esta temporalmente agotado."
      : "Cet article est temporairement en rupture de stock.";
  }
  return isSpanish
    ? "Este articulo no esta disponible actualmente."
    : "Cet article n'est pas disponible actuellement.";
}
