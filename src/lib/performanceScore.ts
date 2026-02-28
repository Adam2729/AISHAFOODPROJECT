export type Tier = "gold" | "silver" | "bronze" | "probation";

type ScoreArgs = {
  slowAccept30d: number;
  cancels30d: number;
  complaints30d: number;
  paused: boolean;
  isProbationForced?: boolean;
  overrideBoost?: number;
};

type ProbationArgs = {
  slowAccept30d: number;
  cancels30d: number;
  complaints30d: number;
};

function toNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function computeScore(args: ScoreArgs): number {
  const slowAccept30d = toNumber(args.slowAccept30d);
  const cancels30d = toNumber(args.cancels30d);
  const complaints30d = toNumber(args.complaints30d);
  const overrideBoost = clamp(toNumber(args.overrideBoost), -50, 50);

  let score = 100;
  score -= slowAccept30d * 2;
  score -= cancels30d * 3;
  score -= complaints30d * 5;
  if (args.paused) score -= 20;
  score += overrideBoost;

  return clamp(Math.round(score), 0, 100);
}

export function computeTier(score: number): Tier {
  const safe = toNumber(score);
  if (safe >= 85) return "gold";
  if (safe >= 70) return "silver";
  if (safe >= 50) return "bronze";
  return "probation";
}

export function isProbation(args: ProbationArgs): boolean {
  const slowAccept30d = toNumber(args.slowAccept30d);
  const cancels30d = toNumber(args.cancels30d);
  const complaints30d = toNumber(args.complaints30d);
  return complaints30d >= 3 || cancels30d >= 10 || slowAccept30d >= 15;
}

export function computeTierWithProbation(args: { score: number; probation: boolean }): Tier {
  if (args.probation) return "probation";
  return computeTier(args.score);
}
