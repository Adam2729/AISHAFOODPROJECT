export const MERCHANT_CANCELLATION_REASONS = [
  "item_unavailable",
  "restaurant_too_busy",
  "customer_unreachable",
  "duplicate_order",
  "payment_issue",
  "delivery_unavailable",
  "other",
] as const;

export const MERCHANT_ISSUE_TYPES = [
  "customer_not_answering",
  "rider_delayed",
  "wrong_address",
  "item_unavailable",
  "payment_problem",
  "other",
] as const;

export const ORDER_ADJUSTMENT_TYPES = [
  "refund",
  "credit",
  "charge_adjustment",
  "writeoff",
  "other",
] as const;

export const ORDER_EVENT_TYPES = [
  "accepted",
  "preparing",
  "ready",
  "assigned_rider",
  "out_for_delivery",
  "otp_verified",
  "cash_received",
  "cancelled",
  "issue_reported",
  "adjustment_recorded",
] as const;

export type MerchantCancellationReasonCode =
  (typeof MERCHANT_CANCELLATION_REASONS)[number];
export type MerchantIssueType = (typeof MERCHANT_ISSUE_TYPES)[number];
export type OrderAdjustmentType = (typeof ORDER_ADJUSTMENT_TYPES)[number];
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

type OrderEventInput = {
  type: OrderEventType;
  label: string;
  detail?: string | null;
  actor?: string | null;
  createdAt?: Date;
};

function normalize(value: unknown) {
  return String(value || "").trim();
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function isMerchantCancellationReasonCode(
  value: unknown
): value is MerchantCancellationReasonCode {
  return MERCHANT_CANCELLATION_REASONS.includes(
    String(value || "").trim() as MerchantCancellationReasonCode
  );
}

export function isMerchantIssueType(value: unknown): value is MerchantIssueType {
  return MERCHANT_ISSUE_TYPES.includes(
    String(value || "").trim() as MerchantIssueType
  );
}

export function isOrderAdjustmentType(
  value: unknown
): value is OrderAdjustmentType {
  return ORDER_ADJUSTMENT_TYPES.includes(
    String(value || "").trim() as OrderAdjustmentType
  );
}

export function getMerchantCancellationReasonLabel(value: unknown) {
  switch (String(value || "").trim()) {
    case "item_unavailable":
      return "Item unavailable";
    case "restaurant_too_busy":
      return "Restaurant too busy";
    case "customer_unreachable":
      return "Customer unreachable";
    case "duplicate_order":
      return "Duplicate order";
    case "payment_issue":
      return "Payment issue";
    case "delivery_unavailable":
      return "Delivery unavailable";
    case "other":
      return "Other";
    default:
      return titleCase(normalize(value).replace(/_/g, " ")) || "Other";
  }
}

export function getMerchantIssueTypeLabel(value: unknown) {
  switch (String(value || "").trim()) {
    case "customer_not_answering":
      return "Customer not answering";
    case "rider_delayed":
      return "Rider delayed";
    case "wrong_address":
      return "Wrong address";
    case "item_unavailable":
      return "Item unavailable";
    case "payment_problem":
      return "Payment problem";
    case "other":
      return "Other";
    default:
      return titleCase(normalize(value).replace(/_/g, " ")) || "Other";
  }
}

export function getOrderAdjustmentTypeLabel(value: unknown) {
  switch (String(value || "").trim()) {
    case "refund":
      return "Refund";
    case "credit":
      return "Credit";
    case "charge_adjustment":
      return "Charge adjustment";
    case "writeoff":
      return "Write-off";
    case "other":
      return "Other";
    default:
      return titleCase(normalize(value).replace(/_/g, " ")) || "Other";
  }
}

export function getCancellationSummary(input: {
  reason?: unknown;
  note?: unknown;
}) {
  const reasonLabel = getMerchantCancellationReasonLabel(input.reason);
  const note = normalize(input.note);
  return {
    reasonLabel,
    summary: note ? `${reasonLabel}: ${note}` : reasonLabel,
  };
}

export function getIssueSummary(input: {
  issueType?: unknown;
  note?: unknown;
}) {
  const issueLabel = getMerchantIssueTypeLabel(input.issueType);
  const note = normalize(input.note);
  return {
    issueLabel,
    summary: note ? `${issueLabel}: ${note}` : issueLabel,
  };
}

export function buildOrderEvent(input: OrderEventInput) {
  return {
    type: input.type,
    label: normalize(input.label).slice(0, 120),
    detail: normalize(input.detail).slice(0, 280) || null,
    actor: normalize(input.actor).slice(0, 80) || null,
    createdAt: input.createdAt || new Date(),
  };
}

export function buildOrderEventPush(event: ReturnType<typeof buildOrderEvent>) {
  return {
    $push: {
      orderEvents: {
        $each: [event],
        $slice: -40,
      },
    },
  };
}

export function buildMerchantIssuePush(issue: {
  issueType: MerchantIssueType;
  note?: string | null;
  createdBy?: string | null;
  createdAt?: Date;
}) {
  return {
    $push: {
      merchantIssues: {
        $each: [
          {
            issueType: issue.issueType,
            note: normalize(issue.note).slice(0, 280),
            createdBy: normalize(issue.createdBy).slice(0, 80) || "merchant",
            createdAt: issue.createdAt || new Date(),
          },
        ],
        $slice: -20,
      },
    },
  };
}

export function buildAdjustmentPush(adjustment: {
  adjustmentType: OrderAdjustmentType;
  amount: number;
  reason: string;
  note?: string | null;
  createdBy: string;
  createdAt?: Date;
}) {
  return {
    $push: {
      adjustments: {
        $each: [
          {
            adjustmentType: adjustment.adjustmentType,
            amount: adjustment.amount,
            reason: normalize(adjustment.reason).slice(0, 140),
            note: normalize(adjustment.note).slice(0, 280),
            createdBy: normalize(adjustment.createdBy).slice(0, 80),
            createdAt: adjustment.createdAt || new Date(),
          },
        ],
        $slice: -30,
      },
    },
  };
}
