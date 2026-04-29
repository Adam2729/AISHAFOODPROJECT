"use client";

import { useEffect, useRef } from "react";

type DeliveryOtpModalProps = {
  open: boolean;
  orderNumber?: string;
  otpLast4?: string | null;
  deliveryMode?: "self_delivery" | "platform_driver";
  value: string;
  saving?: boolean;
  error?: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export default function DeliveryOtpModal({
  open,
  orderNumber,
  otpLast4,
  deliveryMode = "self_delivery",
  value,
  saving = false,
  error = "",
  onChange,
  onClose,
  onSubmit,
}: DeliveryOtpModalProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 40);
  }, [open]);

  useEffect(() => {
    if (!open || saving) return;
    if (String(value || "").trim().length === 6) {
      onSubmit();
    }
  }, [open, onSubmit, saving, value]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4">
      <div className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_25px_70px_rgba(15,23,42,0.25)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Delivery OTP
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">
              {deliveryMode === "platform_driver" ? "Fallback OTP finalization" : "Enter customer OTP"}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {deliveryMode === "platform_driver"
                ? "Use this only when the driver flow cannot complete the delivery and the customer can still provide the code."
                : "Enter the 6-digit customer OTP to complete the delivery cleanly."}
            </p>
            <p className="mt-2 text-sm font-medium text-slate-700">
              Order {String(orderNumber || "-")}
              {otpLast4 ? ` • last 4 ${otpLast4}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"
          >
            Close
          </button>
        </div>

        <div className="mt-5">
          <label className="block text-sm font-semibold text-slate-700" htmlFor="delivery-otp-input">
            Customer OTP
          </label>
          <input
            id="delivery-otp-input"
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={value}
            onChange={(event) =>
              onChange(String(event.target.value || "").replace(/\D+/g, "").slice(0, 6))
            }
            className="mt-2 w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] text-slate-950 outline-none transition focus:border-slate-900 focus:bg-white"
            placeholder="••••••"
          />
          <p className="mt-2 text-xs text-slate-500">
            The code auto-submits after 6 digits. If it fails, you can retry from here.
          </p>
          {error ? <p className="mt-3 text-sm font-medium text-rose-700">{error}</p> : null}
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={saving || String(value || "").trim().length !== 6}
            className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Verifying..." : "Confirm OTP"}
          </button>
        </div>
      </div>
    </div>
  );
}
