"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AtRiskBusiness = {
  id: string;
  name: string;
  paused: boolean;
  pausedReason?: string;
  health?: {
    complaintsCount?: number;
    cancelsCount30d?: number;
    slowAcceptCount30d?: number;
  };
};

type Props = {
  adminKey: string;
  businesses: AtRiskBusiness[];
};

export default function AtRiskMerchantsTable({ adminKey, businesses }: Props) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState("");
  const [loadingWeeklyReset, setLoadingWeeklyReset] = useState(false);
  const [error, setError] = useState("");

  async function pauseToggle(business: AtRiskBusiness) {
    if (loadingId || loadingWeeklyReset) return;
    const nextPaused = !business.paused;
    const reason = nextPaused
      ? window.prompt("Motivo de pausa (opcional, max 140):", business.pausedReason || "") || ""
      : "";
    if (nextPaused && reason.trim().length > 140) {
      setError("El motivo debe tener maximo 140 caracteres.");
      return;
    }

    setLoadingId(business.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/businesses/pause?key=${encodeURIComponent(adminKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: business.id,
          paused: nextPaused,
          reason,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "No se pudo actualizar pausa."
        );
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo conectar para actualizar pausa.");
    } finally {
      setLoadingId("");
    }
  }

  async function resetHealth(business: AtRiskBusiness) {
    if (loadingId || loadingWeeklyReset) return;
    const confirmed = window.confirm("Resetear contadores de salud para este negocio?");
    if (!confirmed) return;

    setLoadingId(business.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/businesses/health-reset?key=${encodeURIComponent(adminKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: business.id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "No se pudo resetear salud."
        );
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo conectar para resetear salud.");
    } finally {
      setLoadingId("");
    }
  }

  async function runWeeklyReset() {
    if (loadingId || loadingWeeklyReset) return;
    setLoadingWeeklyReset(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/jobs/weekly-health-reset?key=${encodeURIComponent(adminKey)}`, {
        method: "POST",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "No se pudo correr weekly reset."
        );
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo conectar para weekly reset.");
    } finally {
      setLoadingWeeklyReset(false);
    }
  }

  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">At-risk Merchants</h2>
        <button
          type="button"
          disabled={loadingWeeklyReset || Boolean(loadingId)}
          onClick={runWeeklyReset}
          className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold"
        >
          {loadingWeeklyReset ? "Running..." : "Run Weekly Health Reset"}
        </button>
      </div>
      {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-2">Business</th>
              <th className="pb-2">Paused</th>
              <th className="pb-2">Complaints</th>
              <th className="pb-2">Cancels(30d)</th>
              <th className="pb-2">SlowAccept(30d)</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {businesses.length ? (
              businesses.map((b) => (
                <tr key={b.id} className="border-t border-slate-100 align-top">
                  <td className="py-2">{b.name}</td>
                  <td className="py-2">
                    {b.paused ? (
                      <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
                        Paused
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="py-2">{Number(b.health?.complaintsCount || 0)}</td>
                  <td className="py-2">{Number(b.health?.cancelsCount30d || 0)}</td>
                  <td className="py-2">{Number(b.health?.slowAcceptCount30d || 0)}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={Boolean(loadingId) || loadingWeeklyReset}
                        onClick={() => pauseToggle(b)}
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                      >
                        {loadingId === b.id ? "Saving..." : b.paused ? "Unpause" : "Pause"}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(loadingId) || loadingWeeklyReset}
                        onClick={() => resetHealth(b)}
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                      >
                        Reset health
                      </button>
                      <a
                        href={`/api/admin/businesses/audit?key=${encodeURIComponent(adminKey)}&businessId=${encodeURIComponent(
                          b.id
                        )}&limit=50`}
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                      >
                        Open business audit
                      </a>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="py-3 text-center text-slate-500">
                  No at-risk merchants.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

