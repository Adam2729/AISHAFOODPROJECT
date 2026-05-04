type EtaLike = {
  minMins?: number | null;
  maxMins?: number | null;
  prepMins?: number | null;
};

const DEFAULT_MIN = 25;
const DEFAULT_MAX = 40;
const DEFAULT_PREP = 15;

function toInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(parsed);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function clampEta(minMins: unknown, maxMins: unknown, prepMins: unknown) {
  let minValue = clamp(toInt(minMins, DEFAULT_MIN), 5, 180);
  let maxValue = clamp(toInt(maxMins, DEFAULT_MAX), 5, 240);
  const prepValue = clamp(toInt(prepMins, DEFAULT_PREP), 0, 120);
  if (maxValue < minValue) {
    const next = minValue;
    minValue = maxValue;
    maxValue = next;
  }
  return {
    minMins: minValue,
    maxMins: maxValue,
    prepMins: prepValue,
  };
}

export function formatEtaText(minMins: unknown, maxMins: unknown) {
  const normalized = clampEta(minMins, maxMins, DEFAULT_PREP);
  if (normalized.minMins === normalized.maxMins) {
    return `${normalized.minMins} min`;
  }
  return `${normalized.minMins}-${normalized.maxMins} min`;
}

export function computeOrderEtaSnapshot(businessEta: EtaLike | null | undefined) {
  const normalized = clampEta(
    businessEta?.minMins,
    businessEta?.maxMins,
    businessEta?.prepMins
  );
  return {
    etaMinMins: normalized.minMins,
    etaMaxMins: normalized.maxMins,
    etaPrepMins: normalized.prepMins,
    etaText: formatEtaText(normalized.minMins, normalized.maxMins),
  };
}

