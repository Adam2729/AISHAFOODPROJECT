/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type MetricsResponse = {
  ok: boolean;
  weekKey?: string;
  kpis?: {
    businessesActive: number;
    ordersToday: number;
    ordersThisWeek: number;
    feeThisWeek: number;
  };
  topBusinesses?: { businessId: string; name: string; orders: number; subtotal: number }[];
  error?: { message?: string } | string;
};

export default function AdminDashboardPage() {
  const [key, setKey] = useState("");
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const urlKey = new URLSearchParams(window.location.search).get("key") || "";
    if (urlKey) setKey(urlKey);
  }, []);

  async function load() {
    if (!key) return;
    setError("");
    const res = await fetch(`/api/admin/metrics?key=${encodeURIComponent(key)}`);
    const json = (await res.json()) as MetricsResponse;
    if (!res.ok || !json.ok) {
      setError(typeof json.error === "string" ? json.error : json.error?.message || "Failed to load");
      return;
    }
    setData(json);
  }

  useEffect(() => {
    load();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="mx-auto min-h-screen max-w-5xl p-6">
      <h1 className="text-2xl font-bold">AishaFood Admin</h1>
      <p className="text-sm text-slate-600">Local marketplace - Santo Domingo</p>

      <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="ADMIN_KEY"
          className="rounded-lg border border-slate-300 px-3 py-2"
        />
        <button onClick={load} className="w-fit rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">
          Refresh
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>

      {data?.kpis ? (
        <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card title="Active Businesses" value={data.kpis.businessesActive} />
          <Card title="Orders Today" value={data.kpis.ordersToday} />
          <Card title="Orders This Week" value={data.kpis.ordersThisWeek} />
          <Card title="Fee This Week" value={`RD$ ${data.kpis.feeThisWeek.toFixed(2)}`} />
        </section>
      ) : null}

      <section className="mt-6 flex flex-wrap gap-3">
        <Link href={`/admin/businesses?key=${encodeURIComponent(key)}`} className="rounded-lg border px-4 py-2">
          Manage Businesses
        </Link>
        <Link href={`/admin/settlements?key=${encodeURIComponent(key)}`} className="rounded-lg border px-4 py-2">
          Weekly Settlements
        </Link>
      </section>

      {data?.topBusinesses?.length ? (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold">Top Businesses ({data.weekKey})</h2>
          <div className="mt-3 divide-y divide-slate-100">
            {data.topBusinesses.map((b) => (
              <div key={b.businessId} className="flex items-center justify-between py-2 text-sm">
                <span>{b.name}</span>
                <span>{b.orders} orders</span>
                <span>RD$ {Number(b.subtotal).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function Card({ title, value }: { title: string; value: string | number }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </article>
  );
}
