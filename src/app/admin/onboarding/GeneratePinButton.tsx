"use client";

import { useState } from "react";

type Props = {
  adminKey: string;
  businessId: string;
};

type PinResponse = {
  ok?: boolean;
  onboarding?: {
    temporaryPin?: string;
  };
  error?: { message?: string } | string;
};

export default function GeneratePinButton({ adminKey, businessId }: Props) {
  const [loading, setLoading] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  async function generate() {
    if (loading) return;
    setLoading(true);
    setError("");
    setPin("");
    try {
      const res = await fetch(`/api/admin/onboarding?key=${encodeURIComponent(adminKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      const json = (await res.json()) as PinResponse;
      if (!res.ok || !json?.ok) {
        const message =
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          "Could not generate PIN.";
        setError(message);
        return;
      }
      const nextPin = String(json?.onboarding?.temporaryPin || "");
      setPin(nextPin);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not generate PIN.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={generate}
        disabled={loading}
        className={`rounded-lg px-2 py-1 text-xs font-semibold ${
          loading ? "bg-slate-300 text-slate-700" : "bg-slate-900 text-white"
        }`}
      >
        {loading ? "..." : "Generate PIN"}
      </button>
      {pin ? <span className="font-mono text-xs text-emerald-700">{pin}</span> : null}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}

