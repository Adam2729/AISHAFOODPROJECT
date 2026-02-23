"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  adminKey: string;
  pilotMode: boolean;
  allowlistEnabled: boolean;
  allowlistSize: number;
  allowlistRaw: string;
};

type LoadingAction = "pilot" | "allowlistEnabled" | "allowlist" | "";

export default function PilotModeControls({
  adminKey,
  pilotMode,
  allowlistEnabled,
  allowlistSize,
  allowlistRaw,
}: Props) {
  const router = useRouter();
  const [loadingAction, setLoadingAction] = useState<LoadingAction>("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [allowlistDraft, setAllowlistDraft] = useState(allowlistRaw);

  useEffect(() => {
    setAllowlistDraft(allowlistRaw);
  }, [allowlistRaw]);

  async function updateBoolSetting(key: "pilot_mode" | "pilot_allowlist_enabled", value: boolean) {
    setLoadingAction(key === "pilot_mode" ? "pilot" : "allowlistEnabled");
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/settings/bool?key=${encodeURIComponent(adminKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "No se pudo actualizar configuracion."
        );
        return;
      }
      setSuccess("Configuracion actualizada.");
      router.refresh();
    } catch {
      setError("No se pudo conectar para actualizar configuracion.");
    } finally {
      setLoadingAction("");
    }
  }

  async function saveAllowlist() {
    setLoadingAction("allowlist");
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/settings/string?key=${encodeURIComponent(adminKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "pilot_allowlist_phones",
          value: allowlistDraft,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "No se pudo guardar allowlist."
        );
        return;
      }
      setSuccess("Allowlist guardada.");
      router.refresh();
    } catch {
      setError("No se pudo conectar para guardar allowlist.");
    } finally {
      setLoadingAction("");
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={Boolean(loadingAction)}
          onClick={() => updateBoolSetting("pilot_mode", !pilotMode)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
        >
          {loadingAction === "pilot"
            ? "Actualizando..."
            : pilotMode
              ? "Desactivar Pilot Mode"
              : "Activar Pilot Mode"}
        </button>
        <button
          type="button"
          disabled={Boolean(loadingAction)}
          onClick={() => updateBoolSetting("pilot_allowlist_enabled", !allowlistEnabled)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
        >
          {loadingAction === "allowlistEnabled"
            ? "Actualizando..."
            : allowlistEnabled
              ? "Desactivar Allowlist"
              : "Activar Allowlist"}
        </button>
      </div>

      <div>
        <p className="mb-1 text-xs text-slate-500">Allowlist entries: {allowlistSize}</p>
        <textarea
          value={allowlistDraft}
          onChange={(e) => setAllowlistDraft(e.target.value)}
          rows={5}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="8095550001, 8291234567"
        />
      </div>

      <button
        type="button"
        disabled={Boolean(loadingAction)}
        onClick={saveAllowlist}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
      >
        {loadingAction === "allowlist" ? "Guardando..." : "Guardar Allowlist"}
      </button>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {success ? <p className="text-xs text-emerald-700">{success}</p> : null}
    </div>
  );
}
