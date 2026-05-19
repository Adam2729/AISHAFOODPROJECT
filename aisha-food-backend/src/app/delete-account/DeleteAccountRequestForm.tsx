"use client";

import { useMemo, useState } from "react";

type FormState = {
  name: string;
  contact: string;
  accountType: string;
  reason: string;
};

const EMAIL_TARGET = "support@oranjeeats.com";

const initialState: FormState = {
  name: "",
  contact: "",
  accountType: "customer",
  reason: "",
};

function buildMailtoHref(form: FormState) {
  const subject = `Delete account request - ${form.accountType || "account"}`;
  const body = [
    "Hello OranjeEats support,",
    "",
    "I would like to request account deletion.",
    "",
    `Name: ${form.name || "-"}`,
    `Email or phone: ${form.contact || "-"}`,
    `Account type: ${form.accountType || "-"}`,
    `Reason: ${form.reason || "-"}`,
    "",
    "Please confirm the next steps for my deletion request.",
  ].join("\n");

  return `mailto:${EMAIL_TARGET}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function DeleteAccountRequestForm() {
  const [form, setForm] = useState<FormState>(initialState);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const mailtoHref = useMemo(() => buildMailtoHref(form), [form]);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setSubmitted(false);
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.trim();
    const contact = form.contact.trim();

    if (!name || !contact) {
      setError("Please enter your name and your email or phone number.");
      return;
    }

    setError("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/account/delete-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          email_or_phone: contact,
          accountType: form.accountType,
          reason: form.reason.trim(),
        }),
      });

      let payload: { ok?: boolean; error?: { message?: string }; message?: string } | null = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error?.message || payload?.message || "Could not send request.");
      }

      setSubmitted(true);
      setForm(initialState);
    } catch (requestError) {
      setError("Could not send the request directly. Opening your email app instead.");
      window.location.href = mailtoHref;
      console.warn("Delete request API unavailable, using mailto fallback.", requestError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-[28px] border border-orange-100 bg-white/98 p-6 shadow-[0_24px_80px_-40px_rgba(249,115,22,0.45)] sm:p-8">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-700">
          Deletion request
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-slate-950">Request account deletion</h2>
        <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
          This form sends a deletion request to OranjeEats support. If the request API is unavailable,
          the form falls back to your email app and pre-fills a message to{" "}
          <span className="font-semibold text-slate-900">{EMAIL_TARGET}</span>.
        </p>
      </div>

      <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-slate-800">Full name</span>
          <input
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            placeholder="Your full name"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-semibold text-slate-800">Email or phone number</span>
          <input
            value={form.contact}
            onChange={(event) => updateField("contact", event.target.value)}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            placeholder="name@example.com or +223..."
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-semibold text-slate-800">Account type</span>
          <select
            value={form.accountType}
            onChange={(event) => updateField("accountType", event.target.value)}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
          >
            <option value="customer">Customer</option>
            <option value="merchant">Merchant / Restaurant</option>
            <option value="driver">Driver</option>
          </select>
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-semibold text-slate-800">Reason</span>
          <textarea
            value={form.reason}
            onChange={(event) => updateField("reason", event.target.value)}
            rows={5}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            placeholder="Optional reason or context for the request"
          />
        </label>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        ) : null}

        {submitted ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
            Your account deletion request has been received and logged. OranjeEats support will review
            it before any account action is taken.
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-2xl bg-orange-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-orange-600"
          >
            {submitting ? "Sending request..." : "Send deletion request"}
          </button>
          <a
            href={`mailto:${EMAIL_TARGET}`}
            className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-orange-300 hover:text-orange-700"
          >
            Email support directly
          </a>
        </div>
      </form>
    </section>
  );
}
