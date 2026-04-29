export type CollectionMethod =
  | "in_person"
  | "bank_deposit"
  | "bank_transfer"
  | "transfer"
  | "pickup"
  | "other";

type ProofInput = {
  collectionMethod?: string | null;
  receiptRef?: string | null;
  receiptPhotoUrl?: string | null;
};

export function normalizeCollectionMethod(input: unknown): CollectionMethod | null {
  const value = String(input || "").trim().toLowerCase();
  if (!value) return null;
  if (
    value === "in_person" ||
    value === "bank_deposit" ||
    value === "bank_transfer" ||
    value === "transfer" ||
    value === "pickup" ||
    value === "other"
  ) {
    return value;
  }
  return null;
}

export function evaluateProofCompleteness(
  input: ProofInput | null | undefined,
  proofRequiredNonInPerson: boolean
) {
  const collectionMethod = normalizeCollectionMethod(input?.collectionMethod);
  const receiptRef = String(input?.receiptRef || "").trim();
  const receiptPhotoUrl = String(input?.receiptPhotoUrl || "").trim();
  const missingFields: string[] = [];

  if (!collectionMethod) {
    missingFields.push("collectionMethod");
  }

  const nonInPerson = Boolean(collectionMethod && collectionMethod !== "in_person");
  const hasAnyProof = Boolean(receiptRef || receiptPhotoUrl);
  if (proofRequiredNonInPerson && nonInPerson && !hasAnyProof) {
    missingFields.push("receiptRef_or_receiptPhotoUrl");
  }

  return {
    collectionMethod,
    nonInPerson,
    proofComplete: missingFields.length === 0,
    missingFields,
  };
}
