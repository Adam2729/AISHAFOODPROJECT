/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Order = {
  _id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  status: string;
  total: number;
};

const statuses = ["new", "accepted", "preparing", "ready", "out_for_delivery", "delivered", "cancelled"];

export default function MerchantOrdersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Order[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");

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
    setRows(json.orders || []);
  }

  async function updateStatus(orderId: string, nextStatus: string) {
    setSaving(orderId + nextStatus);
    const res = await fetch(`/api/merchant/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
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

  useEffect(() => {
    load();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Merchant Orders</h1>
        <Link href="/merchant/products" className="rounded-lg border px-3 py-2 text-sm">
          Manage Products
        </Link>
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
          Refresh
        </button>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

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
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
