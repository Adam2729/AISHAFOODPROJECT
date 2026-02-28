"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  adminKey: string;
  promosEnabled: boolean;
  weeklyBudgetRdp: number;
  spentRdp: number;
  remainingRdp: number;
};

type LoadingAction = "toggle" | "save" | "";

export default function PromoBudgetControls({
  adminKey,
  promosEnabled,
  weeklyBudgetRdp,
  spentRdp,
  remainingRdp,
}: Props) {
  const router = useRouter();
  const [loadingAction, setLoadingAction] = useState<LoadingAction>("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [budgetDraft, setBudgetDraft] = useState(String(weeklyBudgetRdp));

  useEffect(() => {
    setBudgetDraft(String(weeklyBudgetRdp));
  }, [weeklyBudgetRdp]);

  async function togglePromos() {
    setLoadingAction("toggle");
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/settings/bool?key=${encodeURIComponent(adminKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "promos_enabled", value: !promosEnabled }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "No se pudo actualizar promos."
        );
        return;
      }
      setSuccess("Estado de promos actualizado.");
      router.refresh();
    } catch {
      setError("No se pudo conectar para actualizar promos.");
    } finally {
      setLoadingAction("");
    }
  }

  async function saveBudget() {
    const budget = Number(budgetDraft);
    if (!Number.isFinite(budget) || budget < 0) {
      setError("El presupuesto debe ser un numero mayor o igual a 0.");
      return;
    }

    setLoadingAction("save");
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/settings/number?key=${encodeURIComponent(adminKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "promo_budget_weekly_rdp", value: budget }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "No se pudo guardar presupuesto."
        );
        return;
      }
      setSuccess("Presupuesto actualizado.");
      router.refresh();
    } catch {
      setError("No se pudo conectar para guardar presupuesto.");
    } finally {
      setLoadingAction("");
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="text-xs text-slate-500">
        spent: RD$ {Number(spentRdp || 0).toFixed(2)} | remaining: RD$ {Number(remainingRdp || 0).toFixed(2)}
      </div>

      <button
        type="button"
        disabled={Boolean(loadingAction)}
        onClick={togglePromos}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
      >
        {loadingAction === "toggle"
          ? "Actualizando..."
          : promosEnabled
            ? "Desactivar Promos"
            : "Activar Promos"}
      </button>

      <label className="block text-sm text-slate-700">
        Presupuesto semanal (RD$)
        <input
          value={budgetDraft}
          onChange={(e) => setBudgetDraft(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          inputMode="numeric"
        />
      </label>

      <button
        type="button"
        disabled={Boolean(loadingAction)}
        onClick={saveBudget}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
      >
        {loadingAction === "save" ? "Guardando..." : "Guardar Presupuesto"}
      </button>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {success ? <p className="text-xs text-emerald-700">{success}</p> : null}
    </div>
  );
}

