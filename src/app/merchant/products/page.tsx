/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type AvailabilityReason = "out_of_stock" | "busy" | "closed";

type Product = {
  _id: string;
  name: string;
  category: string;
  price: number;
  isAvailable: boolean;
  unavailableReason?: AvailabilityReason | null;
  unavailableUpdatedAt?: string | null;
};

type MenuQualityPayload = {
  menuQuality: {
    productsTotalCount: number;
    productsActiveCount: number;
    productsWithImageCount: number;
    categoriesCount: number;
    hasMinProducts: boolean;
    menuQualityScore: number;
    updatedAt?: string | null;
  };
  targets: {
    minProductsRequired: number;
    minScore: number;
  };
  checklist: {
    addProducts: boolean;
    addImages: boolean;
    addCategories: boolean;
    missingProducts: number;
    missingImages: number;
    missingCategories: number;
  };
  paused?: boolean;
  pausedReason?: string;
};

type BulkMode = "all" | "category" | "selected";

const REASONS: AvailabilityReason[] = ["out_of_stock", "busy", "closed"];
const REASON_LABEL: Record<AvailabilityReason, string> = {
  out_of_stock: "Out of stock",
  busy: "Busy",
  closed: "Closed",
};

const initialForm = {
  name: "",
  category: "",
  description: "",
  imageUrl: "",
  price: "",
  isAvailable: true,
};

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export default function MerchantProductsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Product[]>([]);
  const [menuQuality, setMenuQuality] = useState<MenuQualityPayload | null>(null);
  const [form, setForm] = useState(initialForm);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rowReasonMap, setRowReasonMap] = useState<Record<string, AvailabilityReason>>({});
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkReason, setBulkReason] = useState<AvailabilityReason>("out_of_stock");
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState("");

  const categories = useMemo(() => {
    const values = new Set<string>();
    for (const row of rows) {
      const category = String(row.category || "").trim();
      if (category) values.add(category);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, "es"));
  }, [rows]);

  function isSelected(id: string) {
    return selectedIds.includes(id);
  }

  async function load() {
    const [productsRes, menuQualityRes] = await Promise.all([
      fetch("/api/merchant/products", { cache: "no-store" }),
      fetch("/api/merchant/menu-quality", { cache: "no-store" }),
    ]);
    const productsJson = await productsRes.json().catch(() => null);
    if (!productsRes.ok || !productsJson?.ok) {
      setError(productsJson?.error?.message || productsJson?.error || "Failed to load products");
      if (productsRes.status === 401) router.push("/merchant/login");
      if (productsJson?.error?.code === "PIN_CHANGE_REQUIRED") router.push("/merchant/set-pin");
      return;
    }
    const menuQualityJson = await menuQualityRes.json().catch(() => null);
    if (menuQualityRes.ok && menuQualityJson?.ok) {
      setMenuQuality(menuQualityJson as MenuQualityPayload);
    }

    const nextRows = Array.isArray(productsJson.products) ? (productsJson.products as Product[]) : [];
    setRows(nextRows);
    setSelectedIds((prev) => prev.filter((id) => nextRows.some((row) => row._id === id)));
    setRowReasonMap((prev) => {
      const next = { ...prev };
      for (const row of nextRows) {
        if (!next[row._id]) {
          const reason = row.unavailableReason || "out_of_stock";
          next[row._id] = (REASONS.includes(reason as AvailabilityReason)
            ? reason
            : "out_of_stock") as AvailabilityReason;
        }
      }
      return next;
    });
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusyAction("create");
    const res = await fetch("/api/merchant/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        price: Number(form.price),
      }),
    });
    const json = await res.json();
    setBusyAction("");
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Could not create product");
      if (json?.error?.code === "PIN_CHANGE_REQUIRED") router.push("/merchant/set-pin");
      return;
    }
    setForm(initialForm);
    await load();
  }

  async function updateAvailability(product: Product, nextIsAvailable: boolean) {
    setError("");
    setBusyAction(`row:${product._id}`);
    const reason = rowReasonMap[product._id] || "out_of_stock";
    const res = await fetch(`/api/merchant/products/${product._id}/availability`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isAvailable: nextIsAvailable,
        reason,
      }),
    });
    const json = await res.json();
    setBusyAction("");
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Could not update product availability");
      if (json?.error?.code === "PIN_CHANGE_REQUIRED") router.push("/merchant/set-pin");
      return;
    }
    await load();
  }

  async function runBulk(mode: BulkMode, isAvailable: boolean) {
    setError("");
    setBusyAction(`bulk:${mode}:${isAvailable ? "on" : "off"}`);
    const payload: Record<string, unknown> = {
      mode,
      isAvailable,
      reason: bulkReason,
    };
    if (mode === "category") {
      payload.category = bulkCategory;
    }
    if (mode === "selected") {
      payload.productIds = selectedIds;
    }

    const res = await fetch("/api/merchant/products/bulk-availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => null);
    setBusyAction("");
    if (!res.ok || !json?.ok) {
      setError(
        (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          "Bulk update failed"
      );
      return;
    }
    await load();
  }

  async function remove(productId: string) {
    const confirmed = window.confirm("Delete this product?");
    if (!confirmed) return;
    setError("");
    setBusyAction(`delete:${productId}`);
    const res = await fetch(`/api/merchant/products/${productId}`, { method: "DELETE" });
    const json = await res.json();
    setBusyAction("");
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Could not delete product");
      if (json?.error?.code === "PIN_CHANGE_REQUIRED") router.push("/merchant/set-pin");
      return;
    }
    await load();
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Merchant Products</h1>
        <div className="flex gap-2">
          <Link href="/merchant/orders" className="rounded-lg border px-3 py-2 text-sm">
            Orders
          </Link>
          <Link href="/merchant/settings" className="rounded-lg border px-3 py-2 text-sm">
            Settings
          </Link>
        </div>
      </div>

      {menuQuality ? (
        <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                Calidad del menu: {Number(menuQuality.menuQuality.menuQualityScore || 0)}/100
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Objetivo minimo: {menuQuality.targets.minScore} puntos
              </p>
              {menuQuality.paused && menuQuality.pausedReason ? (
                <p className="mt-1 text-sm font-semibold text-red-700">
                  Tu negocio esta pausado: {menuQuality.pausedReason}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={load}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold"
            >
              Refresh quality
            </button>
          </div>
          <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-3">
            <div>
              {menuQuality.checklist.addProducts
                ? `Agrega ${menuQuality.checklist.missingProducts} producto(s) para llegar a ${menuQuality.targets.minProductsRequired}.`
                : "Meta de productos cumplida."}
            </div>
            <div>
              {menuQuality.checklist.addImages
                ? `Faltan imagenes en ${menuQuality.checklist.missingImages} producto(s).`
                : "Cobertura de imagenes en buen estado."}
            </div>
            <div>
              {menuQuality.checklist.addCategories
                ? `Agrega ${menuQuality.checklist.missingCategories} categoria(s) para mejorar descubrimiento.`
                : "Diversidad de categorias suficiente."}
            </div>
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr,1.5fr]">
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
            <button disabled={busyAction === "create"} className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">
              {busyAction === "create" ? "Creating..." : "Create"}
            </button>
          </div>
          {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        </form>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Products</h2>
            <button onClick={load} className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold">
              Refresh
            </button>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Bulk actions</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                className="input text-sm"
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value as AvailabilityReason)}
              >
                {REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    Reason: {REASON_LABEL[reason]}
                  </option>
                ))}
              </select>
              <select
                className="input text-sm"
                value={bulkCategory}
                onChange={(e) => setBulkCategory(e.target.value)}
              >
                <option value="">Select category</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => runBulk("selected", false)}
                disabled={!selectedIds.length || busyAction.startsWith("bulk:")}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold"
              >
                Selected Unavailable
              </button>
              <button
                type="button"
                onClick={() => runBulk("selected", true)}
                disabled={!selectedIds.length || busyAction.startsWith("bulk:")}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold"
              >
                Selected Available
              </button>
              <button
                type="button"
                onClick={() => runBulk("category", false)}
                disabled={!bulkCategory || busyAction.startsWith("bulk:")}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold"
              >
                Category Unavailable
              </button>
              <button
                type="button"
                onClick={() => runBulk("category", true)}
                disabled={!bulkCategory || busyAction.startsWith("bulk:")}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold"
              >
                Category Available
              </button>
              <button
                type="button"
                onClick={() => runBulk("all", false)}
                disabled={busyAction.startsWith("bulk:")}
                className="rounded border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700"
              >
                All Unavailable
              </button>
              <button
                type="button"
                onClick={() => runBulk("all", true)}
                disabled={busyAction.startsWith("bulk:")}
                className="rounded border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-700"
              >
                All Available
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">Selected: {selectedIds.length}</p>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-2">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && selectedIds.length === rows.length}
                      onChange={(e) =>
                        setSelectedIds(e.target.checked ? rows.map((row) => row._id) : [])
                      }
                    />
                  </th>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Category</th>
                  <th className="pb-2">Price</th>
                  <th className="pb-2">Availability</th>
                  <th className="pb-2">Reason</th>
                  <th className="pb-2">Updated</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((product) => {
                    const rowBusy = busyAction === `row:${product._id}`;
                    const rowDeleteBusy = busyAction === `delete:${product._id}`;
                    const reason = rowReasonMap[product._id] || "out_of_stock";
                    return (
                      <tr key={product._id} className="border-t border-slate-100 align-top">
                        <td className="py-2">
                          <input
                            type="checkbox"
                            checked={isSelected(product._id)}
                            onChange={(e) =>
                              setSelectedIds((prev) =>
                                e.target.checked
                                  ? [...prev, product._id]
                                  : prev.filter((id) => id !== product._id)
                              )
                            }
                          />
                        </td>
                        <td className="py-2 font-medium">{product.name}</td>
                        <td className="py-2">{product.category || "-"}</td>
                        <td className="py-2">RD$ {Number(product.price || 0).toFixed(2)}</td>
                        <td className="py-2">
                          {product.isAvailable ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                              Available
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
                              Unavailable
                            </span>
                          )}
                        </td>
                        <td className="py-2">
                          <select
                            className="input text-xs"
                            value={reason}
                            onChange={(e) =>
                              setRowReasonMap((prev) => ({
                                ...prev,
                                [product._id]: e.target.value as AvailabilityReason,
                              }))
                            }
                          >
                            {REASONS.map((entry) => (
                              <option key={entry} value={entry}>
                                {REASON_LABEL[entry]}
                              </option>
                            ))}
                          </select>
                          {!product.isAvailable && product.unavailableReason ? (
                            <p className="mt-1 text-xs text-slate-500">Current: {REASON_LABEL[product.unavailableReason]}</p>
                          ) : null}
                        </td>
                        <td className="py-2 text-xs text-slate-500">{formatDate(product.unavailableUpdatedAt)}</td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={rowBusy || rowDeleteBusy}
                              onClick={() => updateAvailability(product, !product.isAvailable)}
                              className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                            >
                              {rowBusy
                                ? "Saving..."
                                : product.isAvailable
                                ? "Set unavailable"
                                : "Set available"}
                            </button>
                            <button
                              type="button"
                              disabled={rowBusy || rowDeleteBusy}
                              onClick={() => remove(product._id)}
                              className="rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-700"
                            >
                              {rowDeleteBusy ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="py-3 text-center text-slate-500">
                      No products yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <style jsx>{`
        .input {
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          padding: 0.5rem 0.65rem;
        }
      `}</style>
    </main>
  );
}
