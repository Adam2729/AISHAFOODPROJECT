"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAdminLaunchMarket } from "@/app/admin/useAdminLaunchMarket";
import { formatDateTimeForProfile, formatMoneyForProfile } from "@/lib/marketFormatting";

type PromoRow = {
  _id: string;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  minSubtotal?: number;
  perPhoneLimit?: number;
  maxRedemptions?: number | null;
  expiresAt?: string | null;
  isActive: boolean;
  createdAt?: string;
};

type CreateForm = {
  code: string;
  type: "percentage" | "fixed";
  value: string;
  minSubtotal: string;
  perPhoneLimit: string;
  maxRedemptions: string;
  expiresAt: string;
};

export default function AdminPromosPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [rows, setRows] = useState<PromoRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const market = useAdminLaunchMarket(authenticated);
  const formatDate = (value?: string | null) => formatDateTimeForProfile(value || null, market);
  const formatMoney = (value: number | null | undefined) => formatMoneyForProfile(value, market);
  const [form, setForm] = useState<CreateForm>({
    code: "",
    type: "percentage",
    value: "",
    minSubtotal: "",
    perPhoneLimit: "1",
    maxRedemptions: "",
    expiresAt: "",
  });

  async function load() {
    if (!authenticated) return;
    setError("");
    const res = await fetch("/api/admin/promos?limit=100", { cache: "no-store" });
    if (res.status === 401) {
      setAuthenticated(false);
      setRows([]);
      return;
    }
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "No se pudieron cargar promociones.");
      return;
    }
    setRows(Array.isArray(json.promos) ? json.promos : []);
  }

  async function createPromo() {
    if (!authenticated || saving) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        code: form.code,
        type: form.type,
        value: Number(form.value || 0),
        minSubtotal: Number(form.minSubtotal || 0),
        perPhoneLimit: Number(form.perPhoneLimit || 1),
        maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
        expiresAt: form.expiresAt || null,
      };
      const res = await fetch("/api/admin/promos/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.error?.message || json?.error || "No se pudo crear el promo.");
        return;
      }
      setForm({
        code: "",
        type: "percentage",
        value: "",
        minSubtotal: "",
        perPhoneLimit: "1",
        maxRedemptions: "",
        expiresAt: "",
      });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function togglePromo(promoId: string, isActive: boolean) {
    if (!authenticated) return;
    setError("");
    const res = await fetch("/api/admin/promos/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promoId, isActive: !isActive }),
    });
    if (res.status === 401) {
      setAuthenticated(false);
      return;
    }
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "No se pudo actualizar el promo.");
      return;
    }
    await load();
  }

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const res = await fetch("/api/admin/session", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { authenticated?: boolean } | null;
        const allowed = Boolean(res.ok && json?.authenticated);
        if (!mounted) return;
        setAuthenticated(allowed);
        if (!allowed) return;
        await load();
      } catch {
        if (!mounted) return;
        setAuthenticated(false);
      }
    }

    bootstrap().catch(() => null);
    return () => {
      mounted = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (authenticated === null) return null;
  if (!authenticated) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Promociones</h1>
        <p className="mt-2 text-sm text-red-600">
          Admin access requires a secure browser session.
        </p>
        <Link
          href="/admin/access?next=/admin/promos"
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Promociones (platform-funded)</h1>
        <Link href="/admin" className="rounded-lg border px-3 py-2 text-sm">
          Back to Admin
        </Link>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Crear promo</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className="input"
            placeholder="Code (for example: LAUNCH10)"
            value={form.code}
            onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
          />
          <select
            className="input"
            value={form.type}
            onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value as "percentage" | "fixed" }))}
          >
            <option value="percentage">percentage</option>
            <option value="fixed">fixed</option>
          </select>
          <input
            className="input"
            placeholder="Value"
            value={form.value}
            onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
          />
          <input
            className="input"
            placeholder="Min subtotal"
            value={form.minSubtotal}
            onChange={(e) => setForm((prev) => ({ ...prev, minSubtotal: e.target.value }))}
          />
          <input
            className="input"
            placeholder="Per phone limit"
            value={form.perPhoneLimit}
            onChange={(e) => setForm((prev) => ({ ...prev, perPhoneLimit: e.target.value }))}
          />
          <input
            className="input"
            placeholder="Max redemptions (optional)"
            value={form.maxRedemptions}
            onChange={(e) => setForm((prev) => ({ ...prev, maxRedemptions: e.target.value }))}
          />
          <input
            className="input"
            type="datetime-local"
            value={form.expiresAt}
            onChange={(e) => setForm((prev) => ({ ...prev, expiresAt: e.target.value }))}
          />
        </div>
        <button
          onClick={createPromo}
          disabled={saving}
          className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
        >
          {saving ? "Creando..." : "Crear promo"}
        </button>
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </section>

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Promos</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Code</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Value</th>
                <th className="pb-2">Limits</th>
                <th className="pb-2">Expires</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row._id} className="border-t border-slate-100">
                  <td className="py-2 font-semibold">{row.code}</td>
                  <td className="py-2">{row.type}</td>
                  <td className="py-2">{row.type === "percentage" ? `${row.value}%` : formatMoney(row.value)}</td>
                  <td className="py-2">
                    min: {formatMoney(row.minSubtotal || 0)} | phone: {Number(row.perPhoneLimit || 1)}
                    {row.maxRedemptions ? ` | max: ${row.maxRedemptions}` : ""}
                  </td>
                  <td className="py-2">{formatDate(row.expiresAt || null)}</td>
                  <td className="py-2">
                    <span className={`rounded-full px-2 py-1 text-xs ${row.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                      {row.isActive ? "active" : "inactive"}
                    </span>
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => togglePromo(row._id, row.isActive)}
                      className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold"
                    >
                      {row.isActive ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-slate-500">No promos yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

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
