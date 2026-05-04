export type ReviewSource = "track" | "history" | "support" | "unknown";

const REVIEW_SOURCES = new Set<ReviewSource>(["track", "history", "support", "unknown"]);

export function validateRating(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < 1 || parsed > 5) return null;
  return parsed;
}

export function normalizeComment(value: unknown): string {
  return String(value || "").trim().slice(0, 280);
}

export function normalizeSource(value: unknown): ReviewSource {
  const source = String(value || "").trim().toLowerCase() as ReviewSource;
  return REVIEW_SOURCES.has(source) ? source : "unknown";
}

