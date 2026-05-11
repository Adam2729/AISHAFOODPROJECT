export function formatCurrency(amount: number, currencyCode: string = "XOF") {
  const value = Number(amount || 0);
  const currency = String(currencyCode || "XOF").trim().toUpperCase();
  const normalizedCurrency = currency === "DOP" || currency === "GBP" ? currency : "XOF";
  const locale =
    normalizedCurrency === "DOP" ? "es-DO" : normalizedCurrency === "GBP" ? "en-GB" : "fr-ML";
  const fractionDigits = normalizedCurrency === "XOF" ? 0 : 2;

  if (normalizedCurrency === "XOF") {
    return `${new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value)} FCFA`;
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: normalizedCurrency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatTimeLabel(value: string) {
  const raw = String(value || "").trim();
  return raw || "Not set";
}

export function formatRelativeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}
