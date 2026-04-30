import { createHash, timingSafeEqual } from "node:crypto";
import {
  ENV_PAYTECH_API_KEY,
  ENV_PAYTECH_BASE_URL,
  ENV_PAYTECH_CANCEL_URL,
  ENV_PAYTECH_MODE,
  ENV_PAYTECH_SECRET_KEY,
  ENV_PAYTECH_SUCCESS_URL,
  ENV_PAYTECH_WEBHOOK_SECRET,
} from "@/lib/env";

type PayTechRequestInput = {
  itemName: string;
  itemPrice: number;
  refCommand: string;
  currency?: "XOF";
  successUrl?: string | null;
  cancelUrl?: string | null;
  ipnUrl?: string | null;
  customField?: string | null;
};

type PayTechCreateResult = {
  paymentUrl: string;
  redirectUrl: string;
  token: string | null;
  provider: "paytech";
  raw: Record<string, unknown>;
};

type PayTechWebhookVerifyInput = {
  payload: Record<string, unknown>;
  webhookSecret?: string | null;
};

type PayTechWebhookVerifyResult = {
  ok: boolean;
  reason: string | null;
};

type NormalizedPayTechStatus = {
  normalized: "pending" | "paid" | "failed" | "cancelled";
  rawStatus: string | null;
};

function normalizeText(value: unknown, max = 2000) {
  return String(value || "").trim().slice(0, max);
}

function firstText(values: unknown[], max = 2000) {
  for (const value of values) {
    const text = normalizeText(value, max);
    if (text) return text;
  }
  return "";
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex").toLowerCase();
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(String(a || "").trim().toLowerCase());
  const right = Buffer.from(String(b || "").trim().toLowerCase());
  if (!left.length || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function ensurePayTechConfigured() {
  if (!ENV_PAYTECH_API_KEY || !ENV_PAYTECH_SECRET_KEY) {
    const error = new Error("PayTech credentials are not configured.") as Error & {
      status?: number;
      code?: string;
    };
    error.status = 503;
    error.code = "PAYTECH_NOT_CONFIGURED";
    throw error;
  }
}

function normalizePayTechBaseUrl() {
  return normalizeText(ENV_PAYTECH_BASE_URL).replace(/\/+$/, "") || "https://paytech.sn/api";
}

function extractPaymentUrl(payload: Record<string, unknown>) {
  return firstText(
    [
      payload.redirect_url,
      payload.payment_url,
      payload.redirectUrl,
      payload.paymentUrl,
      payload.url,
    ],
    1200
  );
}

export function getPayTechDefaultSuccessUrl() {
  return ENV_PAYTECH_SUCCESS_URL;
}

export function getPayTechDefaultCancelUrl() {
  return ENV_PAYTECH_CANCEL_URL;
}

export function getPayTechWebhookSecret() {
  return ENV_PAYTECH_WEBHOOK_SECRET;
}

export async function createPayTechPayment(
  input: PayTechRequestInput
): Promise<PayTechCreateResult> {
  ensurePayTechConfigured();

  const itemName = normalizeText(input.itemName, 255);
  const refCommand = normalizeText(input.refCommand, 120);
  const itemPrice = Math.round(Number(input.itemPrice || 0));
  const currency = input.currency || "XOF";
  const successUrl = normalizeText(input.successUrl || getPayTechDefaultSuccessUrl(), 1200);
  const cancelUrl = normalizeText(input.cancelUrl || getPayTechDefaultCancelUrl(), 1200);
  const ipnUrl = normalizeText(input.ipnUrl, 1200);
  const customField = normalizeText(input.customField, 2000);

  if (!itemName || !refCommand || !Number.isFinite(itemPrice) || itemPrice <= 0) {
    const error = new Error("Invalid PayTech payment request payload.") as Error & {
      status?: number;
      code?: string;
    };
    error.status = 400;
    error.code = "PAYTECH_REQUEST_INVALID";
    throw error;
  }
  if (!successUrl || !cancelUrl || !ipnUrl) {
    const error = new Error(
      "PayTech URLs are incomplete. successUrl, cancelUrl, and ipnUrl are required."
    ) as Error & {
      status?: number;
      code?: string;
    };
    error.status = 503;
    error.code = "PAYTECH_URLS_INCOMPLETE";
    throw error;
  }

  const response = await fetch(`${normalizePayTechBaseUrl()}/payment/request-payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      API_KEY: ENV_PAYTECH_API_KEY || "",
      API_SECRET: ENV_PAYTECH_SECRET_KEY || "",
    },
    body: JSON.stringify({
      item_name: itemName,
      item_price: itemPrice,
      ref_command: refCommand,
      currency,
      env: ENV_PAYTECH_MODE === "prod" ? "prod" : "test",
      success_url: successUrl,
      cancel_url: cancelUrl,
      ipn_url: ipnUrl,
      custom_field: customField || undefined,
    }),
    cache: "no-store",
  });

  const rawText = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
  } catch {
    payload = rawText ? { raw: rawText } : {};
  }

  if (!response.ok) {
    const message =
      firstText([payload.message, payload.error_message, payload.error, rawText], 500) ||
      `PayTech request-payment failed with ${response.status}.`;
    const error = new Error(message) as Error & { status?: number; code?: string };
    error.status = 502;
    error.code = "PAYTECH_REQUEST_FAILED";
    throw error;
  }

  const paymentUrl = extractPaymentUrl(payload);
  if (!paymentUrl) {
    const error = new Error("PayTech response did not include a payment URL.") as Error & {
      status?: number;
      code?: string;
    };
    error.status = 502;
    error.code = "PAYTECH_INVALID_RESPONSE";
    throw error;
  }

  return {
    paymentUrl,
    redirectUrl: paymentUrl,
    token: firstText([payload.token, payload.payment_token], 255) || null,
    provider: "paytech",
    raw: payload,
  };
}

export function verifyPayTechWebhook(
  input: PayTechWebhookVerifyInput
): PayTechWebhookVerifyResult {
  const payload = input.payload || {};
  const apiKeyHash = firstText([payload.api_key_sha256, payload.api_key_hash], 255);
  const apiSecretHash = firstText([payload.api_secret_sha256, payload.api_secret_hash], 255);
  const webhookSecret = normalizeText(input.webhookSecret, 255);

  let verifiedBySignature = false;
  if (ENV_PAYTECH_API_KEY && apiKeyHash) {
    verifiedBySignature = safeEqual(apiKeyHash, sha256Hex(ENV_PAYTECH_API_KEY));
    if (!verifiedBySignature) {
      return { ok: false, reason: "Invalid PayTech API key hash." };
    }
  }
  if (ENV_PAYTECH_SECRET_KEY && apiSecretHash) {
    const secretMatches = safeEqual(apiSecretHash, sha256Hex(ENV_PAYTECH_SECRET_KEY));
    if (!secretMatches) {
      return { ok: false, reason: "Invalid PayTech secret hash." };
    }
    verifiedBySignature = true;
  }

  let verifiedByWebhookSecret = false;
  if (ENV_PAYTECH_WEBHOOK_SECRET) {
    if (!webhookSecret || !safeEqual(webhookSecret, ENV_PAYTECH_WEBHOOK_SECRET)) {
      return { ok: false, reason: "Invalid PayTech webhook secret." };
    }
    verifiedByWebhookSecret = true;
  }

  if (!verifiedBySignature && !verifiedByWebhookSecret) {
    return {
      ok: false,
      reason: "No trusted PayTech signature or webhook secret was present.",
    };
  }

  return { ok: true, reason: null };
}

export function normalizePayTechStatus(input: Record<string, unknown>): NormalizedPayTechStatus {
  const rawStatus = firstText(
    [input.type_event, input.status, input.payment_status, input.result, input.state],
    120
  ).toLowerCase();

  if (
    ["sale_complete", "success", "successful", "paid", "completed", "complete"].includes(rawStatus)
  ) {
    return {
      normalized: "paid",
      rawStatus: rawStatus || null,
    };
  }

  if (
    ["sale_canceled", "sale_cancel", "sale_cancelled", "cancelled", "canceled"].includes(rawStatus)
  ) {
    return {
      normalized: "cancelled",
      rawStatus: rawStatus || null,
    };
  }

  if (["failed", "error", "denied", "declined", "sale_failed"].includes(rawStatus)) {
    return {
      normalized: "failed",
      rawStatus: rawStatus || null,
    };
  }

  return {
    normalized: "pending",
    rawStatus: rawStatus || null,
  };
}
