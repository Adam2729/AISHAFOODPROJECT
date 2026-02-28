"use client";

import { useState } from "react";

type Tier = "gold" | "silver" | "bronze" | "probation";

type Props = {
  adminKey: string;
  businessId: string;
  initialBoost: number;
  initialTier: Tier | null;
  initialNote: string;
  onSaved?: () => void | Promise<void>;
};

export default function PerformanceOverrideForm({
  adminKey,
  businessId,
  initialBoost,
  initialTier,
  initialNote,
  onSaved,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [boost, setBoost] = useState(String(initialBoost));
  const [tier, setTier] = useState<string>(initialTier || "");
  const [note, setNote] = useState(initialNote || "");
  const [confirmText, setConfirmText] = useState("");

  async function saveOverride() {
    if (confirmText.trim().toUpperCase() !== "OVERRIDE") {
      setError('Type "OVERRIDE" to confirm.');
      return;
    }
    const parsedBoost = Number(boost);
    if (!Number.isFinite(parsedBoost)) {
      setError("Boost must be a number.");
      return;
    }
    if (String(note || "").trim().length > 200) {
      setError("Note max length is 200.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/admin/businesses/performance/override?key=${encodeURIComponent(adminKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessId,
            overrideBoost: parsedBoost,
            overrideTier: tier ? tier : null,
            note,
            confirm: "OVERRIDE",
          }),
        }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error?.message || json?.error || "Could not save override.");
        return;
      }
      setConfirmText("");
      if (onSaved) await onSaved();
      setOpen(false);
    } catch {
      setError("Could not save override.");
    } finally {
      setLoading(false);
    }
  }

  async function clearOverride() {
    const confirm = window.prompt('Type "CLEAR" to clear override:', "");
    if (String(confirm || "").trim().toUpperCase() !== "CLEAR") return;

    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/admin/businesses/performance/clear?key=${encodeURIComponent(adminKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessId,
            confirm: "CLEAR",
          }),
        }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error?.message || json?.error || "Could not clear override.");
        return;
      }
      setBoost("0");
      setTier("");
      setNote("");
      setConfirmText("");
      if (onSaved) await onSaved();
      setOpen(false);
    } catch {
      setError("Could not clear override.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-1">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
      >
        {open ? "Close Override" : "Boost"}
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={clearOverride}
        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
      >
        Clear Override
      </button>
      {open ? (
        <div className="mt-1 grid gap-1 rounded border border-slate-200 bg-slate-50 p-2">
          <input
            value={boost}
            onChange={(e) => setBoost(e.target.value)}
            placeholder="Boost (-50..50)"
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="">tier auto</option>
            <option value="gold">gold</option>
            <option value="silver">silver</option>
            <option value="bronze">bronze</option>
            <option value="probation">probation</option>
          </select>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder='Type OVERRIDE'
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <button
            type="button"
            disabled={loading}
            onClick={saveOverride}
            className="rounded bg-slate-900 px-2 py-1 text-xs font-semibold text-white"
          >
            {loading ? "Saving..." : "Apply Override"}
          </button>
        </div>
      ) : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
