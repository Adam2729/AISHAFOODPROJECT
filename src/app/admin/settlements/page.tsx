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
};

export default function AdminSettlementsPage() {
  const [key, setKey] = useState("");
  const [weekKey, setWeekKey] = useState("");
  const [rows, setRows] = useState<Settlement[]>([]);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState("");

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const urlKey = sp.get("key") || "";
    if (urlKey) setKey(urlKey);
  }, []);

  const query = useMemo(() => {
    const sp = new URLSearchParams();
    if (key) sp.set("key", key);
    if (weekKey) sp.set("weekKey", weekKey);
    return sp.toString();
  }, [key, weekKey]);

  async function load() {
    if (!key) return;
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

  async function collect(row: Settlement) {
    if (!key) return;
    setSavingId(row._id);
    setError("");
    const receiptRef = window.prompt("Receipt reference (optional):", "") || "";
    const res = await fetch(`/api/admin/settlements/collect?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId: row.businessId, weekKey: row.weekKey, receiptRef }),
    });
    const json = await res.json();
    setSavingId("");
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Failed to mark collected");
      return;
    }
    load();
  }

  useEffect(() => {
    load();
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Weekly Settlements</h1>
        <Link href={`/admin?key=${encodeURIComponent(key)}`} className="rounded-lg border px-3 py-2 text-sm">
          Back to Admin
        </Link>
      </div>

      <div className="mb-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <input className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ADMIN_KEY" />
        <input className="input" value={weekKey} onChange={(e) => setWeekKey(e.target.value)} placeholder="YYYY-Www" />
        <button onClick={load} className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">
          Refresh
        </button>
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
                    <button
                      disabled={savingId === r._id}
                      onClick={() => collect(r)}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      {savingId === r._id ? "Saving..." : "Mark Collected"}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-500">Done</span>
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
