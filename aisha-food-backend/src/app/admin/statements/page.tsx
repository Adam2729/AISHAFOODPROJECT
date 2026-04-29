"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  formatStatementDateTime,
  formatStatementMoney,
  normalizeStatementCurrency,
} from "@/lib/statementFormats";

type StatementPack = {
  businessId: string;
  businessName: string;
  weekKey: string;
  currency?: "DOP" | "XOF";
  settlement: {
    status: string;
    grossSubtotal: number;
    feeTotal: number;
    ordersCount: number;
    collectedAt: string | null;
    receiptRef: string | null;
    receiptPhotoUrl: string | null;
    collectorName: string | null;
    collectionMethod: string | null;
    resolutionStatus: string | null;
    resolutionNote: string | null;
    resolvedAt: string | null;
    resolvedBy: string | null;
  };
  cash: {
    status: string | null;
    reportedCashTotal: number | null;
    verifiedCashTotal: number | null;
    expectedCashTotal: number;
    variance: number;
    lastSubmittedAt: string | null;
    verifiedAt: string | null;
    collectorName: string | null;
    collectionMethod: string | null;
    receiptRef: string | null;
    receiptPhotoUrl: string | null;
    driverCash: {
      driverCollectedTotal: number;
      driverHandedTotal: number;
      driverDisputedTotal: number;
      merchantCashReceivedTotal: number;
      mismatchSignal: boolean;
    };
  };
  totals: {
    ordersCount: number;
    grossSubtotal: number;
    promoDiscountTotal: number;
    netSubtotal: number;
    orderTotal: number;
    deliveryFeeTotal: number;
    commissionTotal: number;
    merchantNetAfterCommission: number;
    platformDriverOrdersCount: number;
    selfDeliveryOrdersCount: number;
    platformDriverDeliveryFeeTotal: number;
    selfDeliveryDeliveryFeeTotal: number;
    driverPayoutTotal: number;
    platformDeliveryMarginTotal: number;
    cashExpected: number;
    cashReported: number | null;
    cashVerified: number | null;
    variance: number;
    driverCashCollectedTotal: number;
    driverCashHandedTotal: number;
    driverCashDisputedTotal: number;
    merchantCashReceivedTotal: number;
  };
  anomalies?: Array<{
    id: string;
    type: string;
    severity: "high" | "medium" | "low" | null;
    meta: Record<string, unknown> | null;
    createdAt: string | null;
  }>;
  integrity: {
    settlementHash: string | null;
    cashCollectionHash: string | null;
    computedAt: string;
  };
};

type ApiResponse = {
  ok?: boolean;
  pack?: StatementPack;
  error?: { message?: string; code?: string } | string;
};

type ArchiveResponse = {
  ok?: boolean;
  archiveMeta?: {
    id: string;
    businessId: string;
    businessName: string;
    weekKey: string;
    version: number;
    packHash: string;
    generatedAt: string | null;
    generatedBy: string;
    locked: boolean;
    lockedAt: string | null;
  };
  links?: {
    pdf: string;
    json: string;
    csvOrders: string;
    csvSummary: string;
  };
  error?: { message?: string; code?: string } | string;
};

function getWeekKey(dateInput = new Date()) {
  const date = new Date(Date.UTC(dateInput.getUTCFullYear(), dateInput.getUTCMonth(), dateInput.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const SESSION_ADMIN_KEY = "__session__";

export default function AdminStatementsPage() {
  const [key, setKey] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [weekKey, setWeekKey] = useState(getWeekKey(new Date()));
  const [businessId, setBusinessId] = useState("");
  const [pack, setPack] = useState<StatementPack | null>(null);
  const [archive, setArchive] = useState<ArchiveResponse["archiveMeta"] | null>(null);
  const [links, setLinks] = useState<ArchiveResponse["links"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const statementCurrency = normalizeStatementCurrency(pack?.currency);
  const formatMoney = (value: number | null | undefined) =>
    formatStatementMoney(value, statementCurrency);
  const formatDateTime = (value: string | null | undefined) =>
    formatStatementDateTime(value, statementCurrency);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlBusinessId = String(params.get("businessId") || "").trim();
    const urlWeekKey = String(params.get("weekKey") || "").trim();
    if (urlBusinessId) setBusinessId(urlBusinessId);
    if (urlWeekKey) setWeekKey(urlWeekKey);

    let mounted = true;
    async function bootstrap() {
      try {
        const res = await fetch("/api/admin/session", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { authenticated?: boolean } | null;
        const allowed = Boolean(res.ok && json?.authenticated);
        if (!mounted) return;
        setAuthenticated(allowed);
        if (allowed) {
          setKey(SESSION_ADMIN_KEY);
        }
      } catch {
        if (!mounted) return;
        setAuthenticated(false);
      }
    }

    bootstrap().catch(() => null);
    return () => {
      mounted = false;
    };
  }, []);

  const summaryText = useMemo(() => {
    if (!pack) return "";
    return [
      `Statement ${pack.weekKey} - ${pack.businessName}`,
      `Orders: ${pack.totals.ordersCount}`,
      `Gross: ${formatStatementMoney(pack.totals.grossSubtotal, statementCurrency)}`,
      `Promo discount: ${formatStatementMoney(pack.totals.promoDiscountTotal, statementCurrency)}`,
      `Net subtotal: ${formatStatementMoney(pack.totals.netSubtotal, statementCurrency)}`,
      `Order total: ${formatStatementMoney(pack.totals.orderTotal, statementCurrency)}`,
      `Delivery fees: ${formatStatementMoney(pack.totals.deliveryFeeTotal, statementCurrency)}`,
      `Commission: ${formatStatementMoney(pack.totals.commissionTotal, statementCurrency)}`,
      `Merchant net: ${formatStatementMoney(pack.totals.merchantNetAfterCommission, statementCurrency)}`,
      `Driver payouts: ${formatStatementMoney(pack.totals.driverPayoutTotal, statementCurrency)}`,
      `Platform delivery margin: ${formatStatementMoney(
        pack.totals.platformDeliveryMarginTotal,
        statementCurrency
      )}`,
      `Expected cash: ${formatStatementMoney(pack.totals.cashExpected, statementCurrency)}`,
      `Verified cash: ${formatStatementMoney(pack.totals.cashVerified, statementCurrency)}`,
      `Variance: ${formatStatementMoney(pack.totals.variance, statementCurrency)}`,
    ].join("\n");
  }, [pack, statementCurrency]);

  async function load() {
    if (!key || !businessId || !weekKey) {
      setError("businessId and weekKey are required.");
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const query = new URLSearchParams({
        key,
        businessId,
        weekKey,
        includeAnomalies: "true",
      });
      const response = await fetch(`/api/admin/statements/weekly?${query.toString()}`, {
        cache: "no-store",
      });
      const json = (await response.json().catch(() => null)) as ApiResponse | null;
      if (!response.ok || !json?.ok || !json.pack) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not load statement pack."
        );
      }
      setPack(json.pack);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not load statement.");
    } finally {
      setLoading(false);
    }
  }

  async function copySummary() {
    if (!summaryText) return;
    try {
      await navigator.clipboard.writeText(summaryText);
      setSuccess("Statement summary copied.");
    } catch {
      setError("Could not copy summary.");
    }
  }

  async function archivePack(options?: { lock?: boolean }) {
    if (!key || !businessId || !weekKey) {
      setError("businessId and weekKey are required.");
      return;
    }
    setArchiving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/admin/statements/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          weekKey,
          lock: Boolean(options?.lock),
          generatedBy: "admin",
        }),
      });
      const json = (await response.json().catch(() => null)) as ArchiveResponse | null;
      if (!response.ok || !json?.ok || !json.archiveMeta || !json.links) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not archive statement pack."
        );
      }
      setArchive(json.archiveMeta);
      setLinks(json.links);
      setSuccess(options?.lock ? "Statement locked." : "Statement archived.");
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not archive statement.");
    } finally {
      setArchiving(false);
    }
  }

  if (authenticated === null) return null;

  if (authenticated === false || !key) {
    return (
      <main className="mx-auto min-h-screen max-w-6xl p-6">
        <h1 className="text-2xl font-bold">Admin Statements</h1>
        <p className="mt-2 text-sm text-red-600">
          Statement access requires a secure admin browser session.
        </p>
        <Link
          href="/admin/access?next=/admin/statements"
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Weekly Statement Pack (Admin)</h1>
          <p className="text-sm text-slate-600">Finance summary + orders + anomalies</p>
        </div>
        <Link href={`/admin/ops`} className="rounded-lg border px-3 py-2 text-sm">
          Back to Ops
        </Link>
      </div>

      <div className="mb-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4">
        <input
          value={businessId}
          onChange={(e) => setBusinessId(e.target.value)}
          placeholder="businessId"
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          value={weekKey}
          onChange={(e) => setWeekKey(e.target.value)}
          placeholder="YYYY-Www"
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
        >
          {loading ? "Loading..." : "Load Pack"}
        </button>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => archivePack()}
            disabled={archiving}
            className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold"
          >
            {archiving ? "Working..." : "Archive Pack"}
          </button>
          <button
            type="button"
            onClick={() => archivePack({ lock: true })}
            disabled={archiving}
            className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold"
          >
            {archiving ? "Working..." : "Lock Statement"}
          </button>
          <button
            type="button"
            onClick={copySummary}
            className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold"
          >
            Copy Summary
          </button>
          {links?.pdf ? (
            <a
              href={links.pdf}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold"
            >
              Download PDF
            </a>
          ) : null}
          {links?.csvOrders ? (
            <a
              href={links.csvOrders}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold"
            >
              Orders CSV
            </a>
          ) : null}
          {links?.csvSummary ? (
            <a
              href={links.csvSummary}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold"
            >
              Summary CSV
            </a>
          ) : null}
          {links?.json ? (
            <a
              href={links.json}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold"
            >
              JSON Pack
            </a>
          ) : null}
        </div>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mb-3 text-sm text-emerald-700">{success}</p> : null}

      {pack ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-semibold">{pack.businessName}</h2>
            <p className="text-xs text-slate-500">
              Week {pack.weekKey} | Computed {formatDateTime(pack.integrity.computedAt)}
            </p>
            {archive ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">
                  Archive v{archive.version}
                </span>
                <span className="text-slate-600">Generated: {formatDateTime(archive.generatedAt)}</span>
                {archive.locked ? (
                  <span className="rounded-full bg-blue-100 px-2 py-1 font-semibold text-blue-700">
                    Locked
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricTile label="Orders" value={String(pack.totals.ordersCount)} />
              <MetricTile label="Gross" value={formatMoney(pack.totals.grossSubtotal)} />
              <MetricTile label="Promo Discount" value={formatMoney(pack.totals.promoDiscountTotal)} />
              <MetricTile label="Net Subtotal" value={formatMoney(pack.totals.netSubtotal)} />
              <MetricTile label="Order Total" value={formatMoney(pack.totals.orderTotal)} />
              <MetricTile label="Delivery Fees" value={formatMoney(pack.totals.deliveryFeeTotal)} />
              <MetricTile label="Commission" value={formatMoney(pack.totals.commissionTotal)} />
              <MetricTile label="Merchant Net" value={formatMoney(pack.totals.merchantNetAfterCommission)} />
              <MetricTile label="Driver Payouts" value={formatMoney(pack.totals.driverPayoutTotal)} />
              <MetricTile
                label="Platform Delivery Margin"
                value={formatMoney(pack.totals.platformDeliveryMarginTotal)}
              />
              <MetricTile label="Expected Cash" value={formatMoney(pack.totals.cashExpected)} />
              <MetricTile label="Reported Cash" value={formatMoney(pack.totals.cashReported)} />
              <MetricTile label="Variance" value={formatMoney(pack.totals.variance)} />
              <MetricTile
                label="Platform-driver / Self-delivery"
                value={`${pack.totals.platformDriverOrdersCount} / ${pack.totals.selfDeliveryOrdersCount}`}
              />
            </div>
          </section>

          <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-base font-semibold">Proof + Resolution</h3>
            <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
              <p>Settlement status: {pack.settlement.status}</p>
              <p>Cash status: {pack.cash.status || "-"}</p>
              <p>Collector: {pack.cash.collectorName || pack.settlement.collectorName || "-"}</p>
              <p>Method: {pack.cash.collectionMethod || pack.settlement.collectionMethod || "-"}</p>
              <p>Receipt ref: {pack.cash.receiptRef || pack.settlement.receiptRef || "-"}</p>
              <p>Resolution status: {pack.settlement.resolutionStatus || "-"}</p>
              <p>Resolution note: {pack.settlement.resolutionNote || "-"}</p>
              <p>Resolved at: {formatDateTime(pack.settlement.resolvedAt)}</p>
              <p>Driver cash collected: {formatMoney(pack.cash.driverCash.driverCollectedTotal)}</p>
              <p>Driver cash handed: {formatMoney(pack.cash.driverCash.driverHandedTotal)}</p>
              <p>Driver cash disputed: {formatMoney(pack.cash.driverCash.driverDisputedTotal)}</p>
              <p>Merchant cash received: {formatMoney(pack.cash.driverCash.merchantCashReceivedTotal)}</p>
            </div>
          </section>

          <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-base font-semibold">Finance Anomalies</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pb-2">Time</th>
                    <th className="pb-2">Type</th>
                    <th className="pb-2">Severity</th>
                    <th className="pb-2">Meta</th>
                  </tr>
                </thead>
                <tbody>
                  {(pack.anomalies || []).length ? (
                    (pack.anomalies || []).map((row) => (
                      <tr key={row.id} className="border-t border-slate-100">
                        <td className="py-2">{formatDateTime(row.createdAt)}</td>
                        <td className="py-2">{row.type}</td>
                        <td className="py-2">{row.severity || "-"}</td>
                        <td className="py-2 text-xs text-slate-600">{JSON.stringify(row.meta || {})}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-3 text-center text-slate-500">
                        No anomalies for this business/week.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-lg border border-slate-200 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </article>
  );
}
