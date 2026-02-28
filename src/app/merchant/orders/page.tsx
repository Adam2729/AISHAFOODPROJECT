"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Order = {
  _id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  status: string;
  createdAt?: string;
  total: number;
  merchantDelivery?: {
    riderName?: string | null;
    riderPhone?: string | null;
    assignedAt?: string | null;
  };
  deliveryProof?: {
    required?: boolean;
    otpLast4?: string | null;
    verifiedAt?: string | null;
    verifiedBy?: "customer_code" | "admin_override" | null;
  };
};
type DigestOrder = {
  orderId: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  subtotal: number;
  total: number;
};

const statuses = ["new", "accepted", "preparing", "ready", "out_for_delivery", "delivered", "cancelled"];

export default function MerchantOrdersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Order[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  const [savingRider, setSavingRider] = useState("");
  const [savingCash, setSavingCash] = useState("");
  const [editingRiderOrderId, setEditingRiderOrderId] = useState("");
  const [riderNameDraft, setRiderNameDraft] = useState("");
  const [riderPhoneDraft, setRiderPhoneDraft] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const lastSeenCreatedAtRef = useRef("");
  const pollingRef = useRef(false);

  function toIso(value: unknown) {
    const date = new Date(String(value || ""));
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString();
  }

  function setLastSeen(value: unknown) {
    const next = toIso(value);
    if (!next) return;
    if (!lastSeenCreatedAtRef.current || next > lastSeenCreatedAtRef.current) {
      lastSeenCreatedAtRef.current = next;
    }
  }

  function playBeep() {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof window.AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.value = 0.03;
      oscillator.start();
      setTimeout(() => {
        oscillator.stop();
        ctx.close().catch(() => null);
      }, 140);
    } catch {
      // no-op
    }
  }

  async function load() {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    const res = await fetch(`/api/merchant/orders${qs}`);
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Failed to load orders");
      if (res.status === 401) router.push("/merchant/login");
      if (json?.error?.code === "PIN_CHANGE_REQUIRED") router.push("/merchant/set-pin");
      return;
    }
    const nextRows = Array.isArray(json.orders) ? (json.orders as Order[]) : [];
    setRows(nextRows);
    for (const row of nextRows) {
      knownOrderIdsRef.current.add(String(row._id));
      setLastSeen(row.createdAt);
    }
    setLastUpdatedAt(new Date().toLocaleTimeString());
  }

  async function pollDigest() {
    if (pollingRef.current) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    pollingRef.current = true;
    try {
      const params = new URLSearchParams();
      if (lastSeenCreatedAtRef.current) params.set("since", lastSeenCreatedAtRef.current);
      params.set("limit", "20");
      const qs = params.toString();
      const res = await fetch(`/api/merchant/orders/digest${qs ? `?${qs}` : ""}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        if (res.status === 401) router.push("/merchant/login");
        return;
      }
      const digestRows = Array.isArray(json.orders) ? (json.orders as DigestOrder[]) : [];
      if (!digestRows.length) {
        setLastUpdatedAt(new Date().toLocaleTimeString());
        return;
      }

      let newCount = 0;
      for (const row of digestRows) {
        const id = String(row.orderId || "");
        if (!id) continue;
        setLastSeen(row.createdAt);
        if (!knownOrderIdsRef.current.has(id)) {
          knownOrderIdsRef.current.add(id);
          newCount += 1;
        }
      }

      if (newCount > 0) {
        setNewOrdersCount((prev) => prev + newCount);
        playBeep();
        await load();
      } else {
        setLastUpdatedAt(new Date().toLocaleTimeString());
      }
    } finally {
      pollingRef.current = false;
    }
  }

  async function updateStatus(orderId: string, nextStatus: string) {
    const payload: Record<string, unknown> = { status: nextStatus };
    if (nextStatus === "delivered") {
      const otp = window.prompt("Codigo de entrega (6 digitos):", "") ?? "";
      const normalizedOtp = String(otp || "").trim();
      if (!normalizedOtp) return;
      payload.deliveryOtp = normalizedOtp;
    }

    setSaving(orderId + nextStatus);
    const res = await fetch(`/api/merchant/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    setSaving("");
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Update failed");
      if (json?.error?.code === "PIN_CHANGE_REQUIRED") router.push("/merchant/set-pin");
      return;
    }
    load();
  }

  function startRiderEditor(order: Order) {
    setEditingRiderOrderId(order._id);
    setRiderNameDraft(String(order.merchantDelivery?.riderName || ""));
    setRiderPhoneDraft(String(order.merchantDelivery?.riderPhone || ""));
  }

  function closeRiderEditor() {
    setEditingRiderOrderId("");
    setRiderNameDraft("");
    setRiderPhoneDraft("");
  }

  async function saveRider(orderId: string) {
    if (savingRider) return;
    setSavingRider(orderId);
    const res = await fetch(`/api/merchant/orders/${orderId}/assign-rider`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        riderName: String(riderNameDraft || "").slice(0, 60),
        riderPhone: String(riderPhoneDraft || "").slice(0, 30),
      }),
    });
    const json = await res.json().catch(() => null);
    setSavingRider("");
    if (!res.ok || !json?.ok) {
      setError(
        (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          "Could not save rider assignment."
      );
      return;
    }
    closeRiderEditor();
    load();
  }

  async function markCashReceived(orderId: string) {
    if (savingCash) return;
    const note = window.prompt("Optional note for cash received:", "") ?? "";
    setSavingCash(orderId);
    const res = await fetch(`/api/merchant/orders/${orderId}/cash-received`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirm: "RECEIVED",
        note: String(note || "").slice(0, 280),
      }),
    });
    const json = await res.json().catch(() => null);
    setSavingCash("");
    if (!res.ok || !json?.ok) {
      setError(
        (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          "Could not mark cash received."
      );
      return;
    }
    load();
  }

  useEffect(() => {
    load();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const interval = window.setInterval(() => {
      pollDigest().catch(() => null);
    }, 12000);
    return () => window.clearInterval(interval);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Merchant Orders</h1>
        <div className="flex gap-2">
          <Link href="/merchant/finance" className="rounded-lg border px-3 py-2 text-sm">
            Finance
          </Link>
          <Link href="/merchant/finance/statements" className="rounded-lg border px-3 py-2 text-sm">
            Statements
          </Link>
          <Link href="/merchant/products" className="rounded-lg border px-3 py-2 text-sm">
            Manage Products
          </Link>
          <Link href="/merchant/settings" className="rounded-lg border px-3 py-2 text-sm">
            Settings
          </Link>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <select className="rounded-lg border px-3 py-2" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button onClick={load} className="rounded-lg bg-slate-900 px-4 py-2 text-white">
          Refresh now
        </button>
        <span className="self-center text-xs text-slate-500">
          Last updated: {lastUpdatedAt || "-"}
        </span>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {newOrdersCount > 0 ? (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <span>New order received ({newOrdersCount})</span>
          <button
            type="button"
            onClick={() => setNewOrdersCount(0)}
            className="rounded border border-emerald-300 px-2 py-1 text-xs font-semibold"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-2">Order</th>
              <th className="pb-2">Customer</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Total</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o._id} className="border-t border-slate-100 align-top">
                <td className="py-2">
                  <div className="font-medium">{o.orderNumber}</div>
                  <div className="text-xs text-slate-500">{o.address}</div>
                </td>
                <td className="py-2">
                  <div>{o.customerName}</div>
                  <div className="text-xs text-slate-500">{o.phone}</div>
                </td>
                <td className="py-2">
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{o.status}</span>
                  <div className="mt-2 text-xs text-slate-600">
                    Mensajero: {String(o.merchantDelivery?.riderName || "").trim() || "-"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Telefono: {String(o.merchantDelivery?.riderPhone || "").trim() || "-"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Asignado:{" "}
                    {o.merchantDelivery?.assignedAt
                      ? new Date(o.merchantDelivery.assignedAt).toLocaleString("es-DO")
                      : "-"}
                  </div>
                  <div className="mt-2 text-xs text-slate-600">
                    Prueba OTP:{" "}
                    {o.deliveryProof?.verifiedAt
                      ? "Verificada"
                      : o.deliveryProof?.required === false
                      ? "No requerida"
                      : "Pendiente"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    OTP ultimos 4: {String(o.deliveryProof?.otpLast4 || "").trim() || "-"}
                  </div>
                </td>
                <td className="py-2">RD$ {Number(o.total).toFixed(2)}</td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1">
                    {statuses
                      .filter((s) => s !== o.status)
                      .map((s) => (
                        <button
                          key={s}
                          disabled={saving === o._id + s}
                          onClick={() => updateStatus(o._id, s)}
                          className="rounded border px-2 py-1 text-xs"
                        >
                          {s}
                        </button>
                      ))}
                    <button
                      type="button"
                      onClick={() => startRiderEditor(o)}
                      className="rounded border px-2 py-1 text-xs"
                    >
                      Asignar mensajero
                    </button>
                    <button
                      type="button"
                      disabled={savingCash === o._id}
                      onClick={() => markCashReceived(o._id)}
                      className="rounded border px-2 py-1 text-xs"
                    >
                      {savingCash === o._id ? "Saving..." : "Cash received"}
                    </button>
                  </div>
                  {editingRiderOrderId === o._id ? (
                    <div className="mt-2 grid gap-2 rounded border border-slate-200 p-2">
                      <div className="text-xs font-semibold text-slate-700">
                        Asignar mensajero (opcional)
                      </div>
                      <input
                        value={riderNameDraft}
                        onChange={(e) => setRiderNameDraft(e.target.value)}
                        placeholder="Nombre"
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                      <input
                        value={riderPhoneDraft}
                        onChange={(e) => setRiderPhoneDraft(e.target.value)}
                        placeholder="Telefono"
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={savingRider === o._id}
                          onClick={() => saveRider(o._id)}
                          className="rounded border px-2 py-1 text-xs"
                        >
                          {savingRider === o._id ? "Guardando..." : "Guardar"}
                        </button>
                        <button
                          type="button"
                          onClick={closeRiderEditor}
                          className="rounded border px-2 py-1 text-xs"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
