"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  adminKey: string;
  weekKey: string;
};

export default function RunSettlementPreviewsButton({ adminKey, weekKey }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function runNow() {
    setRunning(true);
    setError("");
    const res = await fetch(
      `/api/admin/jobs/settlement-previews?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
        weekKey
      )}`,
      {
        method: "POST",
      }
    );
    const json = await res.json().catch(() => null);
    setRunning(false);
    if (!res.ok || !json?.ok) {
      setError(json?.error?.message || json?.error || "Could not run settlement previews.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <button
        onClick={runNow}
        disabled={running}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
      >
        {running ? "Running..." : "Run previews now"}
      </button>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

