const REVIEW_TAGS = [
  "rapido",
  "tarde",
  "caliente",
  "frio",
  "rico",
  "malo",
  "faltante",
  "amable",
  "caro",
  "buena_porcion",
  "mala_porcion",
  "empaque_bueno",
  "empaque_malo",
] as const;

export const REVIEW_TAGS_ALLOWLIST_ES = [...REVIEW_TAGS];

const ALLOWLIST_SET = new Set<string>(REVIEW_TAGS_ALLOWLIST_ES);

export function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const item of input) {
    const tag = String(item || "")
      .trim()
      .toLowerCase()
      .slice(0, 24);
    if (!tag) continue;
    if (!ALLOWLIST_SET.has(tag)) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 8) break;
  }

  return out;
}

