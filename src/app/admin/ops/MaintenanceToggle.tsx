"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  adminKey: string;
  maintenanceMode: boolean;
  source: string;
};

export default function MaintenanceToggle({ adminKey, maintenanceMode, source }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const envForcesOn = source === "env" || source === "env+db";

  async function onToggle() {
    if (loading || envForcesOn) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/maintenance?key=${encodeURIComponent(adminKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !maintenanceMode }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        const message =
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          "No se pudo actualizar mantenimiento.";
        setError(message);
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo conectar para actualizar mantenimiento.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={loading || envForcesOn}
        onClick={onToggle}
        className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
          loading || envForcesOn ? "bg-slate-400" : maintenanceMode ? "bg-emerald-700" : "bg-amber-600"
        }`}
      >
        {loading ? "Actualizando..." : maintenanceMode ? "Desactivar (DB)" : "Activar (DB)"}
      </button>
      {envForcesOn ? (
        <p className="mt-2 text-xs text-amber-700">Env forces maintenance ON</p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

