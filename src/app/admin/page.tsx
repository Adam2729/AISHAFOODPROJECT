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
    commissionToday: number;
    feeThisWeek: number;
    ordersWeeklyGrowthPct: number;
    commissionWeeklyGrowthPct: number;
    activeBusinesses: number;
    churnedBusinesses: number;
    repeatCustomerRate: number;
  };
  topBusinesses?: { businessId: string; name: string; orders: number; subtotal: number }[];
  error?: { message?: string } | string;
};

export default function AdminDashboardPage() {
  const [key, setKey] = useState("");
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const urlKey = new URLSearchParams(window.location.search).get("key") || "";
    if (urlKey) setKey(urlKey);
    setReady(true);
  }, []);

  async function load() {
    if (!ready || !key) return;
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
  }, [key, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return null;

  if (!key) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">AishaFood Admin</h1>
        <p className="mt-2 text-sm text-red-600">
          Unauthorized. Usa la URL con <code>?key=ADMIN_KEY</code>.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl p-6">
      <h1 className="text-2xl font-bold">AishaFood Admin</h1>
      <p className="text-sm text-slate-600">Local marketplace - Santo Domingo</p>

      <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <button onClick={load} className="w-fit rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">
          Refresh
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>

      {data?.kpis ? (
        <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card title="Active Businesses" value={data.kpis.businessesActive} />
          <Card title="Orders Today" value={data.kpis.ordersToday} />
          <Card title="Commission Today" value={`RD$ ${data.kpis.commissionToday.toFixed(2)}`} />
          <Card title="Fee This Week" value={`RD$ ${data.kpis.feeThisWeek.toFixed(2)}`} />
          <Card title="Orders This Week" value={data.kpis.ordersThisWeek} />
          <Card title="Weekly Orders Growth" value={`${data.kpis.ordersWeeklyGrowthPct.toFixed(2)}%`} />
          <Card title="Weekly Fee Growth" value={`${data.kpis.commissionWeeklyGrowthPct.toFixed(2)}%`} />
          <Card title="Repeat Customer Rate" value={`${(data.kpis.repeatCustomerRate * 100).toFixed(2)}%`} />
        </section>
      ) : null}

      {data?.kpis ? (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold">Weekly Growth</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <GrowthBar label="Orders vs last week" value={data.kpis.ordersWeeklyGrowthPct} />
            <GrowthBar label="Commission vs last week" value={data.kpis.commissionWeeklyGrowthPct} />
          </div>
        </section>
      ) : null}

      <section className="mt-6 flex flex-wrap gap-3">
        <Link href={`/admin/businesses?key=${encodeURIComponent(key)}`} className="rounded-lg border px-4 py-2">
          Manage Businesses
        </Link>
        <Link href={`/admin/settlements?key=${encodeURIComponent(key)}`} className="rounded-lg border px-4 py-2">
          Weekly Settlements
        </Link>
        {data?.weekKey ? (
          <a
            href={`/api/admin/settlements/export?key=${encodeURIComponent(key)}&weekKey=${encodeURIComponent(data.weekKey)}`}
            className="rounded-lg border px-4 py-2"
          >
            Export CSV ({data.weekKey})
          </a>
        ) : null}
      </section>

      {data?.topBusinesses?.length ? (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold">Top Businesses ({data.weekKey})</h2>
          <div className="mt-3 divide-y divide-slate-100">
            {data.topBusinesses.map((b) => (
              <div key={b.businessId} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                <span>{b.orders} orders</span>
                <span>RD$ {Number(b.subtotal).toFixed(2)}</span>
                {data.weekKey ? (
                  <a
                    href={`/api/admin/audit?key=${encodeURIComponent(key)}&businessId=${encodeURIComponent(
                      b.businessId
                    )}&weekKey=${encodeURIComponent(data.weekKey)}&limit=100`}
                    className="rounded border px-2 py-1 text-xs"
                  >
                    Audit week
                  </a>
                ) : null}
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

function GrowthBar({ label, value }: { label: string; value: number }) {
  const abs = Math.min(Math.abs(value), 100);
  const positive = value >= 0;
  return (
    <article className="rounded-lg border border-slate-200 p-3">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${positive ? "text-emerald-700" : "text-red-700"}`}>
        {value.toFixed(2)}%
      </p>
      <div className="mt-2 h-2 rounded bg-slate-100">
        <div
          className={`h-2 rounded ${positive ? "bg-emerald-500" : "bg-red-500"}`}
          style={{ width: `${abs}%` }}
        />
      </div>
    </article>
  );
}
