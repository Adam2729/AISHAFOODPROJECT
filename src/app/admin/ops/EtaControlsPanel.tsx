"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type EtaRow = {
  businessId: string;
  name: string;
  eta: {
    minMins: number;
    maxMins: number;
    prepMins: number;
    text: string;
  };
};

type Props = {
  adminKey: string;
  rows: EtaRow[];
};

type DraftMap = Record<
  string,
  {
    minMins: string;
    maxMins: string;
    prepMins: string;
  }
>;

export default function EtaControlsPanel({ adminKey, rows }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loadingId, setLoadingId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [drafts, setDrafts] = useState<DraftMap>(
    rows.reduce<DraftMap>((acc, row) => {
      acc[row.businessId] = {
        minMins: String(row.eta.minMins),
        maxMins: String(row.eta.maxMins),
        prepMins: String(row.eta.prepMins),
      };
      return acc;
    }, {})
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(q));
  }, [query, rows]);

  function updateDraft(
    businessId: string,
    key: "minMins" | "maxMins" | "prepMins",
    value: string
  ) {
    setDrafts((prev) => ({
      ...prev,
      [businessId]: {
        minMins: prev[businessId]?.minMins ?? "",
        maxMins: prev[businessId]?.maxMins ?? "",
        prepMins: prev[businessId]?.prepMins ?? "",
        [key]: value,
      },
    }));
  }

  async function saveEta(businessId: string) {
    if (loadingId) return;
    const draft = drafts[businessId];
    const minMins = Number(draft?.minMins);
    const maxMins = Number(draft?.maxMins);
    const prepMins = Number(draft?.prepMins);
    if (!Number.isFinite(minMins) || !Number.isFinite(maxMins) || !Number.isFinite(prepMins)) {
      setError("ETA invalida: usa solo numeros.");
      return;
    }
    setLoadingId(businessId);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(
        `/api/admin/businesses/eta?key=${encodeURIComponent(adminKey)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessId,
            minMins,
            maxMins,
            prepMins,
          }),
        }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        const message =
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          "No se pudo guardar ETA.";
        setError(message);
        return;
      }
      setSuccess("ETA actualizada.");
      router.refresh();
    } catch {
      setError("No se pudo conectar para guardar ETA.");
    } finally {
      setLoadingId("");
    }
  }

  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold">ETA Controls</h2>
      <p className="mt-1 text-xs text-slate-500">
        Edita tiempos estimados de entrega por negocio.
      </p>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar negocio..."
        className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mt-2 text-sm text-emerald-700">{success}</p> : null}
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-2">Business</th>
              <th className="pb-2">Current</th>
              <th className="pb-2">Min</th>
              <th className="pb-2">Max</th>
              <th className="pb-2">Prep</th>
              <th className="pb-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 50).map((row) => (
              <tr key={row.businessId} className="border-t border-slate-100">
                <td className="py-2">{row.name}</td>
                <td className="py-2">{row.eta.text}</td>
                <td className="py-2">
                  <input
                    value={drafts[row.businessId]?.minMins ?? ""}
                    onChange={(e) => updateDraft(row.businessId, "minMins", e.target.value)}
                    className="w-20 rounded border border-slate-300 px-2 py-1"
                    inputMode="numeric"
                  />
                </td>
                <td className="py-2">
                  <input
                    value={drafts[row.businessId]?.maxMins ?? ""}
                    onChange={(e) => updateDraft(row.businessId, "maxMins", e.target.value)}
                    className="w-20 rounded border border-slate-300 px-2 py-1"
                    inputMode="numeric"
                  />
                </td>
                <td className="py-2">
                  <input
                    value={drafts[row.businessId]?.prepMins ?? ""}
                    onChange={(e) => updateDraft(row.businessId, "prepMins", e.target.value)}
                    className="w-20 rounded border border-slate-300 px-2 py-1"
                    inputMode="numeric"
                  />
                </td>
                <td className="py-2">
                  <button
                    type="button"
                    onClick={() => saveEta(row.businessId)}
                    disabled={Boolean(loadingId)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                  >
                    {loadingId === row.businessId ? "Saving..." : "Save"}
                  </button>
                </td>
              </tr>
            ))}
            {!filtered.length ? (
              <tr>
                <td colSpan={6} className="py-3 text-center text-slate-500">
                  No businesses match this search.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

