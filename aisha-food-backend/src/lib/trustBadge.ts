export type TrustBadge = "top" | "good" | "new" | "at_risk";

type TrustInput = {
  acceptanceWithin7mRate30d: number;
  complaints30d: number;
  delivered30d: number;
  isPaused?: boolean;
  isManuallyPaused?: boolean;
  businessTier?: string | null;
  staleNewOrdersCount24h?: number;
};

function toNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function computeTrustBadge(input: TrustInput): {
  badge: TrustBadge;
  reason?: string;
} {
  const delivered30d = Math.max(0, toNumber(input.delivered30d));
  const complaints30d = Math.max(0, toNumber(input.complaints30d));
  const acceptanceWithin7mRate30d = Math.max(
    0,
    Math.min(1, toNumber(input.acceptanceWithin7mRate30d))
  );
  const staleNewOrdersCount24h = Math.max(0, toNumber(input.staleNewOrdersCount24h));
  const tier = String(input.businessTier || "").trim().toLowerCase();
  const paused = Boolean(input.isPaused) || Boolean(input.isManuallyPaused);

  if (tier === "probation" || paused || staleNewOrdersCount24h >= 5) {
    return { badge: "at_risk", reason: "ops_signal" };
  }

  if (delivered30d < 10) {
    return { badge: "new", reason: "low_volume" };
  }

  if (acceptanceWithin7mRate30d >= 0.75 && complaints30d <= 2) {
    return { badge: "top", reason: "fast_low_complaints" };
  }

  if (acceptanceWithin7mRate30d >= 0.5 && complaints30d <= 5) {
    return { badge: "good", reason: "stable" };
  }

  return { badge: "at_risk", reason: "quality_signal" };
}

