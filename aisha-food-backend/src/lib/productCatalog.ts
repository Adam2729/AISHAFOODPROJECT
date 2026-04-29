export const PRODUCT_QUANTITY_UNITS = [
  "kg",
  "g",
  "litre",
  "ml",
  "piece",
  "pack",
  "bottle",
  "can",
  "box",
] as const;

export type ProductQuantityUnit = (typeof PRODUCT_QUANTITY_UNITS)[number];

const UNIT_ALIASES = new Map<string, ProductQuantityUnit>([
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

const UNIT_DISPLAY: Record<ProductQuantityUnit, string> = {
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

export function normalizeProductCategory(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

export function normalizeCategoryKey(value: unknown) {
  return normalizeProductCategory(value).toLocaleLowerCase("fr-FR");
}

export function normalizeProductQuantityUnit(value: unknown): ProductQuantityUnit | "" {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  const canonical = UNIT_ALIASES.get(normalized) || normalized;
  return PRODUCT_QUANTITY_UNITS.includes(canonical as ProductQuantityUnit)
    ? (canonical as ProductQuantityUnit)
    : "";
}

export function normalizeProductQuantityValue(value: unknown): number | null {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return Number.NaN;
  return Number(parsed.toFixed(3));
}

export function formatProductSizeLabel(input: {
  quantityValue?: number | string | null;
  quantityUnit?: string | null;
  displaySize?: string | null;
}) {
  const explicit = String(input.displaySize || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (explicit) return explicit;

  const quantityValue = normalizeProductQuantityValue(input.quantityValue);
  const quantityUnit = normalizeProductQuantityUnit(input.quantityUnit);
  if (!quantityValue || Number.isNaN(quantityValue) || !quantityUnit) return "";

  const valueText = Number.isInteger(quantityValue)
    ? String(quantityValue)
    : String(quantityValue).replace(/0+$/, "").replace(/\.$/, "");
  return `${valueText} ${UNIT_DISPLAY[quantityUnit]}`;
}

export function normalizeProductSizeInput(input: {
  quantityValue?: unknown;
  quantityUnit?: unknown;
  displaySize?: unknown;
}) {
  const quantityUnit = normalizeProductQuantityUnit(input.quantityUnit);
  const quantityValue = normalizeProductQuantityValue(input.quantityValue);
  const displaySize = String(input.displaySize || "").trim().replace(/\s+/g, " ").slice(0, 40);

  if ((input.quantityValue ?? "") !== "" && Number.isNaN(quantityValue)) {
    return {
      ok: false as const,
      code: "INVALID_QUANTITY_VALUE",
      message: "Quantity value must be a positive number.",
    };
  }

  if (String(input.quantityUnit || "").trim() && !quantityUnit) {
    return {
      ok: false as const,
      code: "INVALID_QUANTITY_UNIT",
      message: "Quantity unit is not supported.",
    };
  }

  if ((quantityValue && !quantityUnit) || (!quantityValue && quantityUnit)) {
    return {
      ok: false as const,
      code: "INVALID_QUANTITY",
      message: "Quantity value and unit must be provided together.",
    };
  }

  return {
    ok: true as const,
    quantityValue: quantityValue && !Number.isNaN(quantityValue) ? quantityValue : null,
    quantityUnit: quantityUnit || "",
    displaySize: formatProductSizeLabel({
      quantityValue,
      quantityUnit,
      displaySize,
    }),
  };
}

export function publicProductFilter(extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    isAvailable: true,
    isArchived: { $ne: true },
  };
}
