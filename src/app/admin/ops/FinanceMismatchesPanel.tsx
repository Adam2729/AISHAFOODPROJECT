"use client";

import { useMemo, useState } from "react";

type FinanceMismatchRow = {
  businessId: string;
  businessName: string;
  weekKey: string;
  deliveredAgg: {
    deliveredOrdersCount: number;
    deliveredGrossSubtotal: number;
    deliveredNetSubtotal: number;
    deliveredCommissionTotal: number;
  };
  settlement: {
    settlementOrdersCount: number;
    settlementGrossSubtotal: number;
    settlementFeeTotal: number;
    settlementStatus: "pending" | "collected" | "locked" | null;
  } | null;
  cash: {
    cashStatus: "open" | "submitted" | "verified" | "disputed" | "closed";
    reportedGross: number | null;
    reportedCommission: number | null;
    reportedNet: number | null;
    expectedHash: string;
    integrityStatus: "ok" | "mismatch";
    verifiedAt: string | null;
    submittedAt: string | null;
  } | null;
  diffs: {
    diffOrders: number | null;
    diffGrossSubtotal: number | null;
    diffFeeTotal: number | null;
    diffCashNetVsDeliveredNet: number | null;
    diffCashCommissionVsDeliveredCommission: number | null;
  };
  flags: {
    missingSettlement: boolean;
    missingCashCollection: boolean;
    settlementCollectedButNoCash: boolean;
    hashMismatch: boolean;
    integrityMismatch: boolean;
    diffOverThreshold: boolean;
  };
};

type FinanceSummary = {
  totalRows: number;
  returnedRows: number;
  mismatchRows: number;
  missingSettlementCount: number;
  missingCashCount: number;
  hashMismatchCount: number;
  overThresholdCount: number;
  thresholds?: {
    ordersThreshold: number;
    moneyThresholdRdp: number;
  };
};

type AnomaliesPayload = {
  countsByType?: Record<string, number>;
  latest?: Array<{
    id: string;
    type: string;
    severity: "low" | "medium" | "high" | null;
    businessId: string;
    businessName: string;
    weekKey: string;
    createdAt: string | null;
  }>;
};

type Props = {
  adminKey: string;
  defaultWeekKey: string;
  initialRows: FinanceMismatchRow[];
  initialSummary: FinanceSummary;
  initialAnomalies?: AnomaliesPayload;
  fetchError?: string;
};

function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat("es-DO", {
    style: "currency",
    currency: "DOP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

function hasProblems(row: FinanceMismatchRow) {
  return (
    row.flags.missingSettlement ||
    row.flags.missingCashCollection ||
    row.flags.settlementCollectedButNoCash ||
    row.flags.hashMismatch ||
    row.flags.integrityMismatch ||
    row.flags.diffOverThreshold
  );
}

function flagsToBadges(row: FinanceMismatchRow) {
  const badges: Array<{ label: string; className: string }> = [];
  if (row.flags.missingSettlement) badges.push({ label: "missing settlement", className: "bg-slate-100 text-slate-700" });
  if (row.flags.missingCashCollection) badges.push({ label: "missing cash", className: "bg-slate-100 text-slate-700" });
  if (row.flags.settlementCollectedButNoCash) badges.push({ label: "collected/no cash", className: "bg-red-100 text-red-700" });
  if (row.flags.hashMismatch) badges.push({ label: "hash mismatch", className: "bg-red-100 text-red-700" });
  if (row.flags.integrityMismatch) badges.push({ label: "integrity mismatch", className: "bg-red-100 text-red-700" });
  if (row.flags.diffOverThreshold) badges.push({ label: "over threshold", className: "bg-amber-100 text-amber-700" });
  if (!badges.length) badges.push({ label: "ok", className: "bg-emerald-100 text-emerald-700" });
  return badges;
}

export default function FinanceMismatchesPanel({
  adminKey,
  defaultWeekKey,
  initialRows,
  initialSummary,
  initialAnomalies,
  fetchError,
}: Props) {
  const [weekKey, setWeekKey] = useState(defaultWeekKey);
  const [businessIdFilter, setBusinessIdFilter] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [rows, setRows] = useState<FinanceMismatchRow[]>(initialRows);
  const [summary, setSummary] = useState<FinanceSummary>(initialSummary);
  const [anomalies, setAnomalies] = useState<AnomaliesPayload>(initialAnomalies || {});
  const [loading, setLoading] = useState(false);
  const [runningJob, setRunningJob] = useState(false);
  const [error, setError] = useState(fetchError || "");
  const [success, setSuccess] = useState("");

  const visibleRows = useMemo(() => {
    let next = rows;
    if (onlyProblems) next = next.filter(hasProblems);
    return next;
  }, [rows, onlyProblems]);

  async function load() {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const query = new URLSearchParams({
        key: adminKey,
        weekKey: weekKey.trim(),
        limit: "200",
      });
      if (businessIdFilter.trim()) query.set("businessId", businessIdFilter.trim());
      const response = await fetch(`/api/admin/finance/mismatches?${query.toString()}`, {
        cache: "no-store",
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not load finance mismatches."
        );
      }
      setRows(Array.isArray(json.rows) ? json.rows : []);
      setSummary(
        json.summary || {
          totalRows: 0,
          returnedRows: 0,
          mismatchRows: 0,
          missingSettlementCount: 0,
          missingCashCount: 0,
          hashMismatchCount: 0,
          overThresholdCount: 0,
        }
      );
      setAnomalies(json.anomalies || {});
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not load mismatches.");
    } finally {
      setLoading(false);
    }
  }

  async function runAnomalyJob() {
    setRunningJob(true);
    setError("");
    setSuccess("");
    try {
      const query = new URLSearchParams({
        key: adminKey,
        weekKey: weekKey.trim(),
      });
      const response = await fetch(`/api/admin/jobs/finance-anomalies?${query.toString()}`, {
        method: "POST",
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not run finance anomalies job."
        );
      }
      setSuccess(
        `Anomalies job done. inserted=${Number(json.eventsInserted || 0)} skipped=${Number(
          json.eventsSkipped || 0
        )}`
      );
      await load();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not run anomalies job.");
    } finally {
      setRunningJob(false);
    }
  }

  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Finance Alignment</h2>
          <p className="text-xs text-slate-500">Settlement vs CashCollection vs delivered+counted orders</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={weekKey}
            onChange={(e) => setWeekKey(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            placeholder="YYYY-Www"
          />
          <input
            value={businessIdFilter}
            onChange={(e) => setBusinessIdFilter(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            placeholder="businessId (optional)"
          />
          <label className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-semibold">
            <input
              type="checkbox"
              checked={onlyProblems}
              onChange={(e) => setOnlyProblems(e.target.checked)}
            />
            onlyProblems
          </label>
          <button
            type="button"
            onClick={load}
            disabled={loading || runningJob}
            className="rounded border border-slate-300 px-3 py-1 text-sm font-semibold"
          >
            {loading ? "Loading..." : "Load"}
          </button>
          <button
            type="button"
            onClick={runAnomalyJob}
            disabled={loading || runningJob}
            className="rounded border border-slate-300 px-3 py-1 text-sm font-semibold"
          >
            {runningJob ? "Running..." : "Run Anomaly Job"}
          </button>
          <a
            href={`/api/admin/finance/export?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
              weekKey.trim()
            )}`}
            className="rounded border border-slate-300 px-3 py-1 text-sm font-semibold"
            target="_blank"
            rel="noreferrer"
          >
            Export Finance CSV (Week)
          </a>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Total Rows" value={String(Number(summary.totalRows || 0))} />
        <Kpi label="Missing Settlement" value={String(Number(summary.missingSettlementCount || 0))} />
        <Kpi label="Missing Cash" value={String(Number(summary.missingCashCount || 0))} />
        <Kpi label="Hash Mismatch" value={String(Number(summary.hashMismatchCount || 0))} />
        <Kpi label="Over Threshold" value={String(Number(summary.overThresholdCount || 0))} />
      </div>

      {summary.thresholds ? (
        <p className="mt-2 text-xs text-slate-500">
          Thresholds: orders {Number(summary.thresholds.ordersThreshold || 0)} | money{" "}
          {formatMoney(summary.thresholds.moneyThresholdRdp)}
        </p>
      ) : null}

      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mt-2 text-sm text-emerald-700">{success}</p> : null}

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-2">Business</th>
              <th className="pb-2">Delivered Orders</th>
              <th className="pb-2">Settlement Orders</th>
              <th className="pb-2">Cash Status</th>
              <th className="pb-2">Diff Fee</th>
              <th className="pb-2">Diff Net</th>
              <th className="pb-2">Flags</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length ? (
              visibleRows.map((row) => (
                <tr key={`${row.businessId}-${row.weekKey}`} className="border-t border-slate-100 align-top">
                  <td className="py-2">
                    <div className="font-medium">{row.businessName}</div>
                    <div className="font-mono text-xs text-slate-500">{row.businessId}</div>
                  </td>
                  <td className="py-2">{Number(row.deliveredAgg.deliveredOrdersCount || 0)}</td>
                  <td className="py-2">
                    {row.settlement ? Number(row.settlement.settlementOrdersCount || 0) : "-"}
                  </td>
                  <td className="py-2">{row.cash?.cashStatus || "-"}</td>
                  <td className="py-2">{formatMoney(row.diffs.diffFeeTotal)}</td>
                  <td className="py-2">{formatMoney(row.diffs.diffCashNetVsDeliveredNet)}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {flagsToBadges(row).map((badge) => (
                        <span
                          key={`${row.businessId}-${badge.label}`}
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      <a
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                        href={`/admin/businesses?key=${encodeURIComponent(adminKey)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Business
                      </a>
                      <a
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                        href={`/api/admin/audit?key=${encodeURIComponent(adminKey)}&businessId=${encodeURIComponent(
                          row.businessId
                        )}&weekKey=${encodeURIComponent(weekKey)}&limit=50`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Settlement Audit
                      </a>
                      <a
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                        href={`/api/admin/cash-collections?key=${encodeURIComponent(
                          adminKey
                        )}&weekKey=${encodeURIComponent(weekKey)}&q=${encodeURIComponent(row.businessName)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Cash Sheet
                      </a>
                      <a
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                        href={`/admin/statements?key=${encodeURIComponent(adminKey)}&businessId=${encodeURIComponent(
                          row.businessId
                        )}&weekKey=${encodeURIComponent(weekKey)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Weekly Statement
                      </a>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="py-3 text-center text-slate-500">
                  No finance alignment rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 p-3">
        <h3 className="text-sm font-semibold">Latest Finance Anomalies</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.entries(anomalies.countsByType || {}).map(([type, count]) => (
            <span key={type} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
              {type}: {Number(count || 0)}
            </span>
          ))}
          {!Object.keys(anomalies.countsByType || {}).length ? (
            <span className="text-xs text-slate-500">No anomaly counts yet.</span>
          ) : null}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Time</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Severity</th>
                <th className="pb-2">Business</th>
              </tr>
            </thead>
            <tbody>
              {(anomalies.latest || []).length ? (
                (anomalies.latest || []).map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="py-1">{formatDateTime(row.createdAt)}</td>
                    <td className="py-1">{row.type}</td>
                    <td className="py-1">{row.severity || "-"}</td>
                    <td className="py-1">{row.businessName}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="py-2 text-center text-slate-500">
                    No recent finance anomalies.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-lg border border-slate-200 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </article>
  );
}
