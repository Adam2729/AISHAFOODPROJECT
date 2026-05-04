"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  adminKey: string;
  autoPauseEnabled: boolean;
  slowAcceptThreshold: number;
  cancelThreshold: number;
};

type LoadingAction = "toggle" | "save" | "";

export default function SlaControls({
  adminKey,
  autoPauseEnabled,
  slowAcceptThreshold,
  cancelThreshold,
}: Props) {
  const router = useRouter();
  const [loadingAction, setLoadingAction] = useState<LoadingAction>("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [slowDraft, setSlowDraft] = useState(String(slowAcceptThreshold));
  const [cancelDraft, setCancelDraft] = useState(String(cancelThreshold));

  useEffect(() => {
    setSlowDraft(String(slowAcceptThreshold));
  }, [slowAcceptThreshold]);

  useEffect(() => {
    setCancelDraft(String(cancelThreshold));
  }, [cancelThreshold]);

  async function toggleAutoPause() {
    setLoadingAction("toggle");
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/settings/bool?key=${encodeURIComponent(adminKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "sla_auto_pause_enabled", value: !autoPauseEnabled }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "No se pudo actualizar auto-pause."
        );
        return;
      }
      setSuccess("Auto-pause actualizado.");
      router.refresh();
    } catch {
      setError("No se pudo conectar para actualizar auto-pause.");
    } finally {
      setLoadingAction("");
    }
  }

  async function saveThresholds() {
    const nextSlow = Number(slowDraft);
    const nextCancel = Number(cancelDraft);
    if (!Number.isFinite(nextSlow) || !Number.isFinite(nextCancel)) {
      setError("Los thresholds deben ser numericos.");
      return;
    }

    setLoadingAction("save");
    setError("");
    setSuccess("");
    try {
      const [slowRes, cancelRes] = await Promise.all([
        fetch(`/api/admin/settings/number?key=${encodeURIComponent(adminKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "sla_slow_accept_threshold", value: nextSlow }),
        }),
        fetch(`/api/admin/settings/number?key=${encodeURIComponent(adminKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "sla_cancel_threshold", value: nextCancel }),
        }),
      ]);

      const slowJson = await slowRes.json().catch(() => null);
      const cancelJson = await cancelRes.json().catch(() => null);
      if (!slowRes.ok || !slowJson?.ok || !cancelRes.ok || !cancelJson?.ok) {
        setError(
          (typeof slowJson?.error === "string"
            ? slowJson.error
            : slowJson?.error?.message || "") ||
            (typeof cancelJson?.error === "string"
              ? cancelJson.error
              : cancelJson?.error?.message || "") ||
            "No se pudieron guardar thresholds."
        );
        return;
      }

      setSuccess("Thresholds guardados.");
      router.refresh();
    } catch {
      setError("No se pudo conectar para guardar thresholds.");
    } finally {
      setLoadingAction("");
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <button
        type="button"
        disabled={Boolean(loadingAction)}
        onClick={toggleAutoPause}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
      >
        {loadingAction === "toggle"
          ? "Actualizando..."
          : autoPauseEnabled
            ? "Desactivar SLA Auto-Pause"
            : "Activar SLA Auto-Pause"}
      </button>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm text-slate-700">
          Slow accept threshold
          <input
            value={slowDraft}
            onChange={(e) => setSlowDraft(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            inputMode="numeric"
          />
        </label>
        <label className="text-sm text-slate-700">
          Cancel threshold
          <input
            value={cancelDraft}
            onChange={(e) => setCancelDraft(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            inputMode="numeric"
          />
        </label>
      </div>

      <button
        type="button"
        disabled={Boolean(loadingAction)}
        onClick={saveThresholds}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
      >
        {loadingAction === "save" ? "Guardando..." : "Guardar SLA Thresholds"}
      </button>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {success ? <p className="text-xs text-emerald-700">{success}</p> : null}
    </div>
  );
}
