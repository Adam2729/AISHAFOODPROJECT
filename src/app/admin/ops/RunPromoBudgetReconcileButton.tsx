"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  adminKey: string;
  weekKey: string;
};

export default function RunPromoBudgetReconcileButton({ adminKey, weekKey }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function runNow() {
    setRunning(true);
    setError("");
    const res = await fetch(
      `/api/admin/jobs/promo-budget-reconcile?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
        weekKey
      )}`,
      {
        method: "POST",
      }
    );
    const json = await res.json().catch(() => null);
    setRunning(false);
    if (!res.ok || !json?.ok) {
      setError(json?.error?.message || json?.error || "Could not reconcile promo budget.");
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
        {running ? "Running..." : "Reconcile budget now"}
      </button>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

