"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type CashCollectionSheet = {
  id: string;
  businessId: string;
  businessName: string;
  weekKey: string;
  status: "open" | "submitted" | "verified" | "disputed" | "closed";
  expected: {
    ordersCount: number;
    grossSubtotal: number;
    promoDiscountTotal: number;
    netSubtotal: number;
    commissionTotal: number;
  };
  reported: {
    cashCollected: number | null;
    grossSubtotal?: number | null;
    netSubtotal?: number | null;
    commissionTotal?: number | null;
    ordersCount: number | null;
    collectorName: string | null;
    collectionMethod:
      | "in_person"
      | "bank_deposit"
      | "bank_transfer"
      | "transfer"
      | "pickup"
      | "other"
      | null;
    receiptPhotoUrl: string | null;
    receiptRef: string | null;
    reportedAt: string | null;
  } | null;
  discrepancy: {
    cashDiff: number;
    ordersDiff: number;
  };
  notes: string | null;
  canSubmit: boolean;
  updatedAt: string | null;
};

type CashCollectionResponse = {
  ok?: boolean;
  cashCollection?: CashCollectionSheet;
  error?: { message?: string; code?: string } | string;
};

function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat("es-DO", {
    style: "currency",
    currency: "DOP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function statusBadgeClass(status: CashCollectionSheet["status"]) {
  if (status === "open") return "bg-slate-100 text-slate-700";
  if (status === "submitted") return "bg-amber-100 text-amber-700";
  if (status === "verified") return "bg-emerald-100 text-emerald-700";
  if (status === "disputed") return "bg-red-100 text-red-700";
  return "bg-blue-100 text-blue-700";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export default function MerchantFinancePage() {
  const router = useRouter();
  const [sheet, setSheet] = useState<CashCollectionSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [cashCollected, setCashCollected] = useState("");
  const [ordersCount, setOrdersCount] = useState("");
  const [collectorName, setCollectorName] = useState("");
  const [collectionMethod, setCollectionMethod] = useState("in_person");
  const [receiptRef, setReceiptRef] = useState("");
  const [receiptPhotoUrl, setReceiptPhotoUrl] = useState("");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/merchant/cash-collections", { cache: "no-store" });
      const json = (await response.json().catch(() => null)) as CashCollectionResponse | null;
      if (!response.ok || !json?.ok || !json.cashCollection) {
        const message =
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          "Could not load finance sheet.";
        setError(message);
        if (response.status === 401) router.push("/merchant/login");
        if (json && typeof json.error !== "string" && json.error?.code === "PIN_CHANGE_REQUIRED") {
          router.push("/merchant/set-pin");
        }
        return;
      }

      setSheet(json.cashCollection);
      if (json.cashCollection.reported) {
        setCashCollected(
          json.cashCollection.reported.cashCollected == null
            ? ""
            : String(json.cashCollection.reported.cashCollected)
        );
        setOrdersCount(
          json.cashCollection.reported.ordersCount == null
            ? ""
            : String(json.cashCollection.reported.ordersCount)
        );
        setCollectorName(String(json.cashCollection.reported.collectorName || ""));
        setCollectionMethod(String(json.cashCollection.reported.collectionMethod || "in_person"));
        setReceiptRef(String(json.cashCollection.reported.receiptRef || ""));
        setReceiptPhotoUrl(String(json.cashCollection.reported.receiptPhotoUrl || ""));
      } else {
        setCashCollected("");
        setOrdersCount("");
        setCollectorName("");
        setCollectionMethod("in_person");
        setReceiptRef("");
        setReceiptPhotoUrl("");
      }
      setNote(String(json.cashCollection.notes || ""));
      setConfirm("");
    } catch {
      setError("Could not load finance sheet.");
    } finally {
      setLoading(false);
    }
  }

  async function submitSheet(e: React.FormEvent) {
    e.preventDefault();
    if (!sheet || saving) return;
    if (confirm.trim() !== "SUBMIT") {
      setError("Type SUBMIT to confirm.");
      return;
    }

    const cashValue = Number(cashCollected);
    const ordersValue = Number(ordersCount);
    if (!Number.isFinite(cashValue) || cashValue < 0) {
      setError("cashCollected must be a valid positive number.");
      return;
    }
    if (!Number.isFinite(ordersValue) || ordersValue < 0) {
      setError("ordersCount must be a valid positive number.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/merchant/cash-collections/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekKey: sheet.weekKey,
          cashCollected: cashValue,
          ordersCount: Math.round(ordersValue),
          collectorName: collectorName.trim(),
          collectionMethod,
          receiptRef: receiptRef.trim(),
          receiptPhotoUrl: receiptPhotoUrl.trim(),
          note: note.trim(),
          confirm: "SUBMIT",
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not submit cash collection."
        );
      }
      setSuccess("Submitted. Waiting for admin verification.");
      await load();
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : "Could not submit.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Merchant Finance</h1>
          <p className="text-sm text-slate-600">Weekly cash reconciliation sheet</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/merchant/orders" className="rounded-lg border px-3 py-2 text-sm">
            Orders
          </Link>
          <Link href="/merchant/finance/statements" className="rounded-lg border px-3 py-2 text-sm">
            Statements
          </Link>
          <Link href="/merchant/products" className="rounded-lg border px-3 py-2 text-sm">
            Products
          </Link>
          <Link href="/merchant/settings" className="rounded-lg border px-3 py-2 text-sm">
            Settings
          </Link>
        </div>
      </div>

      {loading ? <p className="text-sm text-slate-600">Loading...</p> : null}
      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mb-3 text-sm text-emerald-700">{success}</p> : null}

      {sheet ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{sheet.businessName}</h2>
                <p className="text-sm text-slate-500">Week: {sheet.weekKey}</p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${statusBadgeClass(
                  sheet.status
                )}`}
              >
                {sheet.status}
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricTile label="Expected Net Cash" value={formatMoney(sheet.expected.netSubtotal)} />
              <MetricTile label="Expected Orders" value={String(sheet.expected.ordersCount)} />
              <MetricTile label="Expected Commission" value={formatMoney(sheet.expected.commissionTotal)} />
              <MetricTile label="Last Updated" value={formatDateTime(sheet.updatedAt)} />
            </div>

            {sheet.reported ? (
              <div className="mt-4 rounded-lg border border-slate-200 p-3 text-sm">
                <p className="font-semibold">Reported Snapshot</p>
                <p className="mt-1">Reported cash: {formatMoney(sheet.reported.cashCollected)}</p>
                <p>Reported orders: {sheet.reported.ordersCount ?? "-"}</p>
                <p>Cash diff: {formatMoney(sheet.discrepancy.cashDiff)}</p>
                <p>Orders diff: {sheet.discrepancy.ordersDiff}</p>
                <p>Reported at: {formatDateTime(sheet.reported.reportedAt)}</p>
              </div>
            ) : null}
          </section>

          {sheet.canSubmit ? (
            <form onSubmit={submitSheet} className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-lg font-semibold">Submit Cash Collection</h2>
              <p className="mt-1 text-sm text-slate-600">
                Submit once per week sheet. Status changes to submitted.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  Cash collected
                  <input
                    value={cashCollected}
                    onChange={(e) => setCashCollected(e.target.value)}
                    inputMode="decimal"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                    required
                  />
                </label>
                <label className="text-sm">
                  Orders count
                  <input
                    value={ordersCount}
                    onChange={(e) => setOrdersCount(e.target.value)}
                    inputMode="numeric"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                    required
                  />
                </label>
                <label className="text-sm">
                  Collector name
                  <input
                    value={collectorName}
                    onChange={(e) => setCollectorName(e.target.value)}
                    maxLength={60}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="text-sm">
                  Collection method
                  <select
                    value={collectionMethod}
                    onChange={(e) => setCollectionMethod(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  >
                    <option value="in_person">in_person</option>
                    <option value="bank_deposit">bank_deposit</option>
                    <option value="bank_transfer">bank_transfer</option>
                    <option value="transfer">transfer</option>
                    <option value="pickup">pickup</option>
                    <option value="other">other</option>
                  </select>
                </label>
                <label className="text-sm">
                  Receipt ref
                  <input
                    value={receiptRef}
                    onChange={(e) => setReceiptRef(e.target.value)}
                    maxLength={80}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="text-sm">
                  Receipt photo URL
                  <input
                    value={receiptPhotoUrl}
                    onChange={(e) => setReceiptPhotoUrl(e.target.value)}
                    maxLength={500}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  />
                </label>
              </div>
              <label className="mt-3 block text-sm">
                Note
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  rows={3}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="mt-3 block text-sm">
                Type SUBMIT to confirm
                <input
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                />
              </label>

              <div className="mt-4">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
                >
                  {saving ? "Submitting..." : "Submit Cash Collection"}
                </button>
              </div>
            </form>
          ) : (
            <section className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              Submitted. Waiting verification or closed by admin.
            </section>
          )}
        </>
      ) : null}
    </main>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-lg border border-slate-200 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </article>
  );
}
