export function formatCurrency(amount: number) {
  const value = Number(amount || 0);
  return `${Math.round(value).toLocaleString("en-US")} FCFA`;
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
