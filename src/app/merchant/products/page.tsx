/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Product = {
  _id: string;
  name: string;
  category: string;
  price: number;
  isAvailable: boolean;
};

const initialForm = {
  name: "",
  category: "",
  description: "",
  imageUrl: "",
  price: "",
  isAvailable: true,
};

export default function MerchantProductsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Product[]>([]);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/merchant/products");
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Failed to load products");
      if (res.status === 401) router.push("/merchant/login");
      if (json?.error?.code === "PIN_CHANGE_REQUIRED") router.push("/merchant/set-pin");
      return;
    }
    setRows(json.products || []);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/merchant/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        price: Number(form.price),
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Could not create product");
      if (json?.error?.code === "PIN_CHANGE_REQUIRED") router.push("/merchant/set-pin");
      return;
    }
    setForm(initialForm);
    load();
  }

  async function toggleAvailability(p: Product) {
    const res = await fetch(`/api/merchant/products/${p._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isAvailable: !p.isAvailable }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Could not update product");
      if (json?.error?.code === "PIN_CHANGE_REQUIRED") router.push("/merchant/set-pin");
      return;
    }
    load();
  }

  async function remove(productId: string) {
    const confirmed = window.confirm("Delete this product?");
    if (!confirmed) return;
    const res = await fetch(`/api/merchant/products/${productId}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Could not delete product");
      if (json?.error?.code === "PIN_CHANGE_REQUIRED") router.push("/merchant/set-pin");
      return;
    }
    load();
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Merchant Products</h1>
        <Link href="/merchant/orders" className="rounded-lg border px-3 py-2 text-sm">
          Back to Orders
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr,1.4fr]">
        <form onSubmit={create} className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Create Product</h2>
          <div className="mt-3 grid gap-2">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" />
            <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Category" />
            <textarea className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" />
            <input className="input" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="Image URL" />
            <input className="input" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Price RD$" />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isAvailable}
                onChange={(e) => setForm({ ...form, isAvailable: e.target.checked })}
              />
              Available
            </label>
            <button className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">Create</button>
          </div>
          {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        </form>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Products</h2>
          <div className="mt-3 divide-y divide-slate-100">
            {rows.map((p) => (
              <div key={p._id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-slate-500">
                    {p.category} - RD$ {Number(p.price).toFixed(2)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggleAvailability(p)} className="rounded border px-2 py-1 text-xs">
                    {p.isAvailable ? "Set unavailable" : "Set available"}
                  </button>
                  <button onClick={() => remove(p._id)} className="rounded border border-red-200 px-2 py-1 text-xs text-red-600">
                    Delete
                  </button>
                </div>
              </div>
            ))}
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
