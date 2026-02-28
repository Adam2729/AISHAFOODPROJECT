"use client";

import { useState } from "react";

type Props = {
  adminKey: string;
  onDone?: () => void | Promise<void>;
};

export default function RunPerformanceRecomputeButton({ adminKey, onDone }: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function runNow() {
    setRunning(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/jobs/performance-recompute?key=${encodeURIComponent(adminKey)}`, {
        method: "POST",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error?.message || json?.error || "Could not run performance recompute.");
        return;
      }
      setSuccess(
        `Done: processed ${Number(json.processed || 0)}, updated ${Number(json.updated || 0)}.`
      );
      if (onDone) await onDone();
    } catch {
      setError("Could not run performance recompute.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={runNow}
        disabled={running}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-60"
      >
        {running ? "Running..." : "Run Performance Recompute Now"}
      </button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {success ? <p className="text-xs text-emerald-700">{success}</p> : null}
    </div>
  );
}
