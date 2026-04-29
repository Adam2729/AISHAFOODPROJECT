import nodemailer from "nodemailer";
import {
  ENV_EMAIL_FROM,
  ENV_RUNTIME_STAGE,
  ENV_SMTP_HOST,
  ENV_SMTP_PASS,
  ENV_SMTP_PORT,
  ENV_SMTP_USER,
} from "@/lib/env";

export type EmailSendInput = {
  to: string;
  subject: string;
  text: string;
  html?: string | null;
};

export type EmailSendResult = {
  sent: boolean;
  provider: "smtp" | "console" | "unconfigured";
  status: "sent" | "logged" | "failed" | "skipped";
  error: string | null;
  messageId: string | null;
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function isEmailValid(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function smtpConfigured() {
  return Boolean(
    ENV_SMTP_HOST &&
      ENV_SMTP_PORT &&
      ENV_SMTP_USER &&
      ENV_SMTP_PASS &&
      ENV_EMAIL_FROM
  );
}

function buildConsoleResult(input: EmailSendInput): EmailSendResult {
  console.info(
    JSON.stringify({
      type: "email_delivery_log",
      mode: ENV_RUNTIME_STAGE,
      provider: "console",
      to: normalizeText(input.to),
      from: ENV_EMAIL_FROM || "EMAIL_FROM not configured",
      subject: normalizeText(input.subject),
      text: normalizeText(input.text),
      timestamp: new Date().toISOString(),
    })
  );

  return {
    sent: false,
    provider: "console",
    status: "logged",
    error: null,
    messageId: null,
  };
}

export function formatE164ForDisplay(value: unknown) {
  const digits = normalizeText(value).replace(/\D+/g, "");
  if (!digits) return "";
  return `+${digits}`;
}

export async function sendEmail(input: EmailSendInput): Promise<EmailSendResult> {
  const to = normalizeText(input.to).toLowerCase();
  const subject = normalizeText(input.subject);
  const text = normalizeText(input.text);
  const html = normalizeText(input.html);

  if (!to || !isEmailValid(to) || !subject || !text) {
    return {
      sent: false,
      provider: smtpConfigured() ? "smtp" : ENV_RUNTIME_STAGE === "production" ? "unconfigured" : "console",
      status: "failed",
      error: "Invalid email input.",
      messageId: null,
    };
  }

  if (!smtpConfigured()) {
    if (ENV_RUNTIME_STAGE !== "production") {
      return buildConsoleResult({ to, subject, text, html });
    }

    console.warn(
      JSON.stringify({
        type: "email_delivery_skipped",
        provider: "unconfigured",
        to,
        subject,
        reason: "SMTP provider not configured.",
        timestamp: new Date().toISOString(),
      })
    );

    return {
      sent: false,
      provider: "unconfigured",
      status: "skipped",
      error: "SMTP provider not configured.",
      messageId: null,
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: ENV_SMTP_HOST || undefined,
      port: ENV_SMTP_PORT || 587,
      secure: ENV_SMTP_PORT === 465,
      auth: {
        user: ENV_SMTP_USER || undefined,
        pass: ENV_SMTP_PASS || undefined,
      },
    });

    const info = await transporter.sendMail({
      from: ENV_EMAIL_FROM || undefined,
      to,
      subject,
      text,
      ...(html ? { html } : {}),
    });

    return {
      sent: true,
      provider: "smtp",
      status: "sent",
      error: null,
      messageId: normalizeText(info.messageId) || null,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown email delivery failure.";
    console.error(
      JSON.stringify({
        type: "email_delivery_failed",
        provider: "smtp",
        to,
        subject,
        error: message,
        timestamp: new Date().toISOString(),
      })
    );

    return {
      sent: false,
      provider: "smtp",
      status: "failed",
      error: message,
      messageId: null,
    };
  }
}
