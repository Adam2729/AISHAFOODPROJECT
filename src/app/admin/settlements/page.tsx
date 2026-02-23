/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Settlement = {
  _id: string;
  businessId: string;
  businessName: string;
  weekKey: string;
  status: "pending" | "collected";
  ordersCount: number;
  grossSubtotal: number;
  feeTotal: number;
  receiptRef?: string;
  collectedAt?: string;
  collectorName?: string;
  collectionMethod?: "cash" | "transfer" | "other";
  receiptPhotoUrl?: string;
};

type ProofForm = {
  receiptRef: string;
  collectorName: string;
  collectionMethod: "cash" | "transfer" | "other";
  receiptPhotoUrl: string;
};

export default function AdminSettlementsPage() {
  const [key, setKey] = useState("");
  const [ready, setReady] = useState(false);
  const [weekKey, setWeekKey] = useState("");
  const [rows, setRows] = useState<Settlement[]>([]);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState("");
  const [proofForms, setProofForms] = useState<Record<string, ProofForm>>({});

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const urlKey = sp.get("key") || "";
    if (urlKey) setKey(urlKey);
    setReady(true);
  }, []);

  const query = useMemo(() => {
    const sp = new URLSearchParams();
    if (key) sp.set("key", key);
    if (weekKey) sp.set("weekKey", weekKey);
    return sp.toString();
  }, [key, weekKey]);

  async function load() {
    if (!ready || !key) return;
    setError("");
    const res = await fetch(`/api/admin/settlements?${query}`);
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Failed to load settlements");
      return;
    }
    setRows(json.settlements || []);
    if (!weekKey) setWeekKey(json.weekKey || "");
  }

  function getInitialProofForm(row: Settlement): ProofForm {
    return {
      receiptRef: String(row.receiptRef || ""),
      collectorName: String(row.collectorName || ""),
      collectionMethod: row.collectionMethod || "cash",
      receiptPhotoUrl: String(row.receiptPhotoUrl || ""),
    };
  }

  function getProofForm(row: Settlement): ProofForm {
    return proofForms[row._id] || getInitialProofForm(row);
  }

  function updateProofForm(row: Settlement, patch: Partial<ProofForm>) {
    setProofForms((prev) => ({
      ...prev,
      [row._id]: {
        ...getProofForm(row),
        ...patch,
      },
    }));
  }

  async function collect(row: Settlement) {
    if (!key) return;
    setSavingId(row._id);
    setError("");
    const current = getProofForm(row);
    const receiptRef = current.receiptRef.trim();
    const collectorName = current.collectorName.trim();
    const receiptPhotoUrl = current.receiptPhotoUrl.trim();
    const payload: {
      businessId: string;
      weekKey: string;
      receiptRef: string;
      collectionMethod: "cash" | "transfer" | "other";
      collectorName?: string;
      receiptPhotoUrl?: string;
    } = {
      businessId: row.businessId,
      weekKey: row.weekKey,
      receiptRef,
      collectionMethod: current.collectionMethod || "cash",
      receiptPhotoUrl,
    };
    if (collectorName) payload.collectorName = collectorName;

    const res = await fetch(`/api/admin/settlements/collect?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    setSavingId("");
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Failed to mark collected");
      return;
    }
    setProofForms((prev) => {
      const next = { ...prev };
      delete next[row._id];
      return next;
    });
    load();
  }

  useEffect(() => {
    load();
  }, [query, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return null;

  if (!key) {
    return (
      <main className="mx-auto min-h-screen max-w-6xl p-6">
        <h1 className="text-2xl font-bold">Weekly Settlements</h1>
        <p className="mt-2 text-sm text-red-600">
          Unauthorized. Usa la URL con <code>?key=ADMIN_KEY</code>.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Weekly Settlements</h1>
        <Link href={`/admin?key=${encodeURIComponent(key)}`} className="rounded-lg border px-3 py-2 text-sm">
          Back to Admin
        </Link>
      </div>

      <div className="mb-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <input className="input" value={weekKey} onChange={(e) => setWeekKey(e.target.value)} placeholder="YYYY-Www" />
        <div className="flex gap-2">
          <button onClick={load} className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">
            Refresh
          </button>
          <a
            href={`/api/admin/settlements/export?key=${encodeURIComponent(key)}${weekKey ? `&weekKey=${encodeURIComponent(weekKey)}` : ""}`}
            className="rounded-lg border border-slate-300 px-4 py-2 font-semibold"
          >
            Export CSV
          </a>
        </div>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-2">Business</th>
              <th className="pb-2">Week</th>
              <th className="pb-2">Orders</th>
              <th className="pb-2">Subtotal</th>
              <th className="pb-2">Fee</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r._id} className="border-t border-slate-100">
                <td className="py-2">{r.businessName}</td>
                <td className="py-2">{r.weekKey}</td>
                <td className="py-2">{r.ordersCount}</td>
                <td className="py-2">RD$ {Number(r.grossSubtotal).toFixed(2)}</td>
                <td className="py-2 font-semibold">RD$ {Number(r.feeTotal).toFixed(2)}</td>
                <td className="py-2">
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{r.status}</span>
                </td>
                <td className="py-2">
                  {r.status === "pending" ? (
                    <div className="grid gap-2">
                      <input
                        className="input"
                        placeholder="Receipt reference"
                        value={getProofForm(r).receiptRef}
                        onChange={(e) => updateProofForm(r, { receiptRef: e.target.value })}
                      />
                      <input
                        className="input"
                        placeholder="Collector name (optional)"
                        value={getProofForm(r).collectorName}
                        onChange={(e) => updateProofForm(r, { collectorName: e.target.value })}
                        maxLength={60}
                      />
                      <select
                        className="input"
                        value={getProofForm(r).collectionMethod}
                        onChange={(e) =>
                          updateProofForm(r, {
                            collectionMethod: e.target.value as "cash" | "transfer" | "other",
                          })
                        }
                      >
                        <option value="cash">cash</option>
                        <option value="transfer">transfer</option>
                        <option value="other">other</option>
                      </select>
                      <input
                        className="input"
                        placeholder="Receipt photo URL (optional)"
                        value={getProofForm(r).receiptPhotoUrl}
                        onChange={(e) => updateProofForm(r, { receiptPhotoUrl: e.target.value })}
                      />
                      <button
                        disabled={savingId === r._id}
                        onClick={() => collect(r)}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        {savingId === r._id ? "Saving..." : "Mark Collected"}
                      </button>
                    </div>
                  ) : (
                    <div className="grid gap-1 text-xs text-slate-600">
                      <span>Done</span>
                      <span>
                        Collected via {r.collectionMethod || "cash"}
                        {r.collectorName ? ` by ${r.collectorName}` : ""}
                      </span>
                      {r.receiptRef ? <span>ReceiptRef: {r.receiptRef}</span> : null}
                      {r.receiptPhotoUrl ? (
                        <a
                          href={r.receiptPhotoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-700 underline"
                        >
                          Receipt photo
                        </a>
                      ) : null}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .input {
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          padding: 0.55rem 0.7rem;
        }
      `}</style>
    </main>
  );
}
