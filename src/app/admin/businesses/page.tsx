/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Business = {
  id: string;
  name: string;
  type: "restaurant" | "colmado";
  phone: string;
  address: string;
  commissionRate: number;
  subscription: {
    status: "trial" | "active" | "past_due" | "suspended";
    daysRemaining: number;
    graceDaysRemaining: number;
  };
};

const initialForm = {
  type: "restaurant",
  name: "",
  phone: "",
  whatsapp: "",
  address: "",
  lat: "",
  lng: "",
  logoUrl: "",
  commissionRate: "0.08",
  pin: "",
};

export default function AdminBusinessesPage() {
  const [key, setKey] = useState("");
  const [rows, setRows] = useState<Business[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(initialForm);

  useEffect(() => {
    const urlKey = new URLSearchParams(window.location.search).get("key") || "";
    if (urlKey) setKey(urlKey);
  }, []);

  const query = useMemo(() => `key=${encodeURIComponent(key)}`, [key]);

  async function load() {
    if (!key) return;
    setError("");
    const res = await fetch(`/api/admin/businesses?${query}`);
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Failed to load businesses");
      return;
    }
    setRows(json.businesses || []);
  }

  async function createBusiness(e: React.FormEvent) {
    e.preventDefault();
    if (!key) return;
    setSaving(true);
    setError("");
    const res = await fetch(`/api/admin/businesses?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        lat: Number(form.lat),
        lng: Number(form.lng),
        commissionRate: Number(form.commissionRate),
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Could not create business");
      return;
    }
    setForm(initialForm);
    load();
  }

  useEffect(() => {
    load();
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Businesses</h1>
        <Link href={`/admin?key=${encodeURIComponent(key)}`} className="rounded-lg border px-3 py-2 text-sm">
          Back to Admin
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr,1.5fr]">
        <form onSubmit={createBusiness} className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Create Business</h2>
          <div className="mt-3 grid gap-2">
            <input className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ADMIN_KEY" />
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "restaurant" | "colmado" })}>
              <option value="restaurant">restaurant</option>
              <option value="colmado">colmado</option>
            </select>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" />
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone" />
            <input className="input" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="WhatsApp" />
            <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Address" />
            <div className="grid grid-cols-2 gap-2">
              <input className="input" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} placeholder="Lat" />
              <input className="input" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} placeholder="Lng" />
            </div>
            <input className="input" value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="Logo URL" />
            <input
              className="input"
              value={form.commissionRate}
              onChange={(e) => setForm({ ...form, commissionRate: e.target.value })}
              placeholder="Commission rate (0.08)"
            />
            <input className="input" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} placeholder="Merchant PIN" />
            <button disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
          {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        </form>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Business List</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Phone</th>
                  <th className="pb-2">Commission</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="py-2">
                      <div className="font-medium">{b.name}</div>
                      <div className="text-xs text-slate-500">{b.address}</div>
                    </td>
                    <td className="py-2">{b.type}</td>
                    <td className="py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium">{b.subscription.status}</span>
                      {b.subscription.status === "trial" ? (
                        <p className="text-xs text-slate-500">Trial ends in {b.subscription.daysRemaining} days</p>
                      ) : null}
                      {b.subscription.status === "past_due" ? (
                        <p className="text-xs text-amber-600">Grace remaining {b.subscription.graceDaysRemaining} days</p>
                      ) : null}
                    </td>
                    <td className="py-2">{b.phone}</td>
                    <td className="py-2">{b.commissionRate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
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
