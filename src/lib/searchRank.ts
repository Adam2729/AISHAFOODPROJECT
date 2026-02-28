type TrustBadge = "top" | "good" | "new" | "at_risk";

type RankInput = {
  isOpenNow: boolean;
  trustBadge?: string | null;
  menuQualityScore?: number | null;
  distanceKm?: number | null;
  textScore?: number | null;
};

export function trustRank(badge: unknown) {
  const normalized = String(badge || "").trim().toLowerCase() as TrustBadge;
  if (normalized === "top") return 3;
  if (normalized === "good") return 2;
  if (normalized === "new") return 1;
  return 0;
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildBusinessRank(input: RankInput) {
  return {
    openRank: input.isOpenNow ? 1 : 0,
    trustRank: trustRank(input.trustBadge),
    menuRank: Math.max(0, Math.min(100, Math.round(toNumber(input.menuQualityScore, 0)))),
    distanceKm: Math.max(0, toNumber(input.distanceKm, 999999)),
    textScore: toNumber(input.textScore, 0),
  };
}

export function compareBusinessRank<
  T extends {
    rank: ReturnType<typeof buildBusinessRank>;
    name?: string;
  },
>(left: T, right: T) {
  if (left.rank.openRank !== right.rank.openRank) {
    return right.rank.openRank - left.rank.openRank;
  }
  if (left.rank.trustRank !== right.rank.trustRank) {
    return right.rank.trustRank - left.rank.trustRank;
  }
  if (left.rank.menuRank !== right.rank.menuRank) {
    return right.rank.menuRank - left.rank.menuRank;
  }
  if (left.rank.distanceKm !== right.rank.distanceKm) {
    return left.rank.distanceKm - right.rank.distanceKm;
  }
  if (left.rank.textScore !== right.rank.textScore) {
    return right.rank.textScore - left.rank.textScore;
  }
  return String(left.name || "").localeCompare(String(right.name || ""), "es");
}

export function compareProductRank<
  T extends {
    rank: ReturnType<typeof buildBusinessRank>;
    price?: number | null;
    name?: string;
  },
>(left: T, right: T) {
  const businessRankCmp = compareBusinessRank(left, right);
  if (businessRankCmp !== 0) return businessRankCmp;
  const priceDiff = toNumber(left.price, 0) - toNumber(right.price, 0);
  if (priceDiff !== 0) return priceDiff;
  return String(left.name || "").localeCompare(String(right.name || ""), "es");
}
