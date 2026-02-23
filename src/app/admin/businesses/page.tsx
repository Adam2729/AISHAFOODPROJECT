/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Business = {
  id: string;
  name: string;
  type: "restaurant" | "colmado";
  isDemo?: boolean;
  phone: string;
  address: string;
  commissionRate: number;
  paused?: boolean;
  pausedReason?: string;
  pausedAt?: string | null;
  health?: {
    complaintsCount?: number;
    cancelsCount30d?: number;
    slowAcceptCount30d?: number;
    lastHealthUpdateAt?: string | null;
    lastHealthResetAt?: string | null;
  };
  subscription: {
    status: "trial" | "active" | "past_due" | "suspended";
    daysRemaining: number;
    graceDaysRemaining: number;
  };
};

type RiskFilter = "all" | "paused" | "at-risk";

const initialForm = {
  type: "restaurant",
  isDemo: false,
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

function withDefaults(row: Business): Business {
  return {
    ...row,
    paused: Boolean(row.paused),
    pausedReason: String(row.pausedReason || ""),
    pausedAt: row.pausedAt || null,
    health: {
      complaintsCount: Number(row.health?.complaintsCount || 0),
      cancelsCount30d: Number(row.health?.cancelsCount30d || 0),
      slowAcceptCount30d: Number(row.health?.slowAcceptCount30d || 0),
      lastHealthUpdateAt: row.health?.lastHealthUpdateAt || null,
      lastHealthResetAt: row.health?.lastHealthResetAt || null,
    },
  };
}

function isAtRisk(b: Business) {
  const complaints = Number(b.health?.complaintsCount || 0);
  const cancels = Number(b.health?.cancelsCount30d || 0);
  const slowAccept = Number(b.health?.slowAcceptCount30d || 0);
  return Boolean(b.paused) || complaints >= 3 || cancels >= 5 || slowAccept >= 5;
}

export default function AdminBusinessesPage() {
  const [key, setKey] = useState("");
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<Business[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pinLoadingId, setPinLoadingId] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState("");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [complaintsDraft, setComplaintsDraft] = useState<Record<string, string>>({});
  const [lastOnboarding, setLastOnboarding] = useState<{
    businessName: string;
    temporaryPin: string;
  } | null>(null);
  const [form, setForm] = useState(initialForm);

  useEffect(() => {
    const urlKey = new URLSearchParams(window.location.search).get("key") || "";
    if (urlKey) setKey(urlKey);
    setReady(true);
  }, []);

  const query = useMemo(() => `key=${encodeURIComponent(key)}`, [key]);

  const filteredRows = useMemo(() => {
    if (riskFilter === "paused") return rows.filter((b) => Boolean(b.paused));
    if (riskFilter === "at-risk") return rows.filter((b) => isAtRisk(b));
    return rows;
  }, [rows, riskFilter]);

  async function load() {
    if (!ready || !key) return;
    setError("");
    const res = await fetch(`/api/admin/businesses?${query}`);
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Failed to load businesses");
      return;
    }

    const baseRows = Array.isArray(json.businesses) ? (json.businesses as Business[]) : [];
    const hydrated = await Promise.all(
      baseRows.map(async (row) => {
        try {
          const extraRes = await fetch(
            `/api/admin/businesses/pause?key=${encodeURIComponent(key)}&businessId=${encodeURIComponent(row.id)}`
          );
          const extraJson = await extraRes.json();
          if (!extraRes.ok || !extraJson?.ok) return withDefaults(row);
          return withDefaults({
            ...row,
            paused: Boolean(extraJson.paused),
            pausedReason: String(extraJson.pausedReason || ""),
            pausedAt: extraJson.pausedAt || null,
            health: extraJson.health || row.health,
          });
        } catch {
          return withDefaults(row);
        }
      })
    );

    setRows(hydrated);
    setComplaintsDraft(
      Object.fromEntries(
        hydrated.map((b) => [b.id, String(Number(b.health?.complaintsCount || 0))])
      )
    );
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
    await load();
  }

  async function generateOnboardingPin(businessId: string) {
    if (!key) return;
    setPinLoadingId(businessId);
    setError("");
    const res = await fetch(`/api/admin/onboarding?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId }),
    });
    const json = await res.json();
    setPinLoadingId("");
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Could not generate onboarding PIN");
      return;
    }
    const onboarding = json?.onboarding || {};
    setLastOnboarding({
      businessName: String(onboarding.businessName || ""),
      temporaryPin: String(onboarding.temporaryPin || ""),
    });
  }

  async function togglePause(business: Business) {
    if (!key) return;
    const nextPaused = !Boolean(business.paused);
    const reason = nextPaused
      ? window.prompt("Reason for pause (optional, max 140):", business.pausedReason || "") || ""
      : "";
    if (nextPaused && reason.trim().length > 140) {
      setError("Reason must be 140 characters or less.");
      return;
    }

    setActionLoadingId(business.id);
    setError("");
    const res = await fetch(`/api/admin/businesses/pause?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessId: business.id,
        paused: nextPaused,
        reason,
      }),
    });
    const json = await res.json();
    setActionLoadingId("");
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Could not update pause status");
      return;
    }
    await load();
  }

  async function setComplaints(businessId: string) {
    if (!key) return;
    const value = Number(complaintsDraft[businessId]);
    if (!Number.isInteger(value) || value < 0 || value > 999) {
      setError("Complaints must be an integer between 0 and 999.");
      return;
    }

    setActionLoadingId(businessId);
    setError("");
    const res = await fetch(`/api/admin/businesses/complaints?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId, complaintsCount: value }),
    });
    const json = await res.json();
    setActionLoadingId("");
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Could not set complaints count");
      return;
    }
    await load();
  }

  async function resetHealth(businessId: string) {
    if (!key) return;
    const confirmed = window.confirm("Reset cancels and slow-accept counters for this business?");
    if (!confirmed) return;

    setActionLoadingId(businessId);
    setError("");
    const res = await fetch(`/api/admin/businesses/health-reset?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId }),
    });
    const json = await res.json();
    setActionLoadingId("");
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Could not reset health counters");
      return;
    }
    await load();
  }

  useEffect(() => {
    load();
  }, [query, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return null;

  if (!key) {
    return (
      <main className="mx-auto min-h-screen max-w-7xl p-6">
        <h1 className="text-2xl font-bold">Businesses</h1>
        <p className="mt-2 text-sm text-red-600">
          Unauthorized. Usa la URL con <code>?key=ADMIN_KEY</code>.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Businesses</h1>
        <Link href={`/admin?key=${encodeURIComponent(key)}`} className="rounded-lg border px-3 py-2 text-sm">
          Back to Admin
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr,1.9fr]">
        <form onSubmit={createBusiness} className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Create Business</h2>
          <div className="mt-3 grid gap-2">
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "restaurant" | "colmado" })}>
              <option value="restaurant">restaurant</option>
              <option value="colmado">colmado</option>
            </select>
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={form.isDemo}
                onChange={(e) => setForm({ ...form, isDemo: e.target.checked })}
              />
              Demo business (training mode)
            </label>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Business List</h2>
            <div className="flex gap-2">
              {(["all", "paused", "at-risk"] as RiskFilter[]).map((option) => (
                <button
                  key={option}
                  onClick={() => setRiskFilter(option)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    riskFilter === option ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          {lastOnboarding ? (
            <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              PIN temporal para <strong>{lastOnboarding.businessName}</strong>: <strong>{lastOnboarding.temporaryPin}</strong>
            </p>
          ) : null}
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Demo</th>
                  <th className="pb-2">Paused</th>
                  <th className="pb-2">Complaints</th>
                  <th className="pb-2">Cancels(30d)</th>
                  <th className="pb-2">SlowAccept(30d)</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Onboarding</th>
                  <th className="pb-2">Controls</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100 align-top">
                    <td className="py-2">
                      <div className="font-medium">{b.name}</div>
                      <div className="text-xs text-slate-500">{b.address}</div>
                    </td>
                    <td className="py-2">{b.type}</td>
                    <td className="py-2">
                      {b.isDemo ? (
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
                          Demo
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                    <td className="py-2">
                      {b.paused ? (
                        <div className="grid gap-1">
                          <span className="inline-flex w-fit rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
                            Paused
                          </span>
                          {b.pausedReason ? <span className="text-xs text-slate-500">{b.pausedReason}</span> : null}
                        </div>
                      ) : (
                        <span className="inline-flex w-fit rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-1">
                        <input
                          className="w-16 rounded border border-slate-300 px-2 py-1"
                          value={complaintsDraft[b.id] ?? "0"}
                          onChange={(e) =>
                            setComplaintsDraft((prev) => ({ ...prev, [b.id]: e.target.value }))
                          }
                        />
                        <button
                          disabled={actionLoadingId === b.id}
                          onClick={() => setComplaints(b.id)}
                          className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                        >
                          Set
                        </button>
                      </div>
                    </td>
                    <td className="py-2">{Number(b.health?.cancelsCount30d || 0)}</td>
                    <td className="py-2">{Number(b.health?.slowAcceptCount30d || 0)}</td>
                    <td className="py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium">{b.subscription.status}</span>
                      {isAtRisk(b) ? (
                        <p className="mt-1 text-xs font-semibold text-amber-700">At risk</p>
                      ) : null}
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        disabled={pinLoadingId === b.id}
                        onClick={() => generateOnboardingPin(b.id)}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold"
                      >
                        {pinLoadingId === b.id ? "Generando..." : "Generar PIN"}
                      </button>
                    </td>
                    <td className="py-2">
                      <div className="grid gap-1">
                        <button
                          onClick={() => togglePause(b)}
                          disabled={actionLoadingId === b.id}
                          className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                        >
                          {b.paused ? "Unpause" : "Pause"}
                        </button>
                        <button
                          onClick={() => resetHealth(b.id)}
                          disabled={actionLoadingId === b.id}
                          className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                        >
                          Reset Health
                        </button>
                        <a
                          href={`/api/admin/businesses/audit?key=${encodeURIComponent(key)}&businessId=${encodeURIComponent(b.id)}&limit=50`}
                          className="rounded border border-slate-300 px-2 py-1 text-center text-xs font-semibold"
                        >
                          Audit
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredRows.length ? (
              <p className="py-3 text-sm text-slate-500">No businesses for current filter.</p>
            ) : null}
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
