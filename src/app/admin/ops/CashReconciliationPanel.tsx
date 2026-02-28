"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Row = {
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
  };
  discrepancy: {
    cashDiff: number;
    ordersDiff: number;
  };
  integrity: {
    expectedHash: string;
    computedAt: string | null;
    status?: "ok" | "mismatch";
  };
  driverCash?: {
    driverCollectedTotalRdp?: number;
    driverHandedTotalRdp?: number;
    driverDisputedTotalRdp?: number;
    merchantCashReceivedTotalRdp?: number;
    mismatchSignal?: boolean;
  };
  proofComplete?: boolean;
  missingProofFields?: string[];
  submittedAt?: string | null;
  verifiedAt?: string | null;
  updatedAt: string | null;
};

type Summary = {
  totalExpectedNet: number;
  totalReportedCash: number;
  totalCashDiff: number;
  submittedCount: number;
  verifiedCount: number;
  disputedCount: number;
  openCount: number;
  closedCount: number;
  driverCollectedTotalRdp?: number;
  driverHandedTotalRdp?: number;
  driverDisputedTotalRdp?: number;
  driverMismatchCount?: number;
};

type DriverCashStatus = "collected" | "handed_to_merchant" | "disputed" | "void";

type DriverCashRow = {
  id: string;
  orderId: string;
  orderNumber: string;
  businessId: string;
  businessName: string;
  driverId: string;
  driverName: string;
  weekKey: string;
  amountCollectedRdp: number;
  status: DriverCashStatus;
  collectedAt: string | null;
  handedToMerchantAt: string | null;
  receiptRef: string | null;
  proofUrl: string | null;
  disputeSummary: {
    openedAt: string | null;
    openedBy: "merchant" | "admin" | null;
    reason: string | null;
    resolvedAt: string | null;
    resolution: "merchant_confirmed" | "driver_confirmed" | "writeoff" | null;
  } | null;
};

type DriverCashTotals = {
  byStatus: Record<DriverCashStatus, number>;
  byDriver: Array<{ driverId: string; driverName: string; totalRdp: number; count: number }>;
  byBusiness: Array<{ businessId: string; businessName: string; totalRdp: number; count: number }>;
};

type AuditRow = {
  id: string;
  actor: {
    type: "admin" | "merchant" | "system";
    id?: string | null;
    label?: string | null;
  };
  action: string;
  note: string | null;
  meta?: {
    enforcedProof?: boolean;
    missingFields?: string[];
  } | null;
  createdAt: string | null;
};

type Props = {
  adminKey: string;
  initialWeekKey: string;
  initialRows: Row[];
  initialSummary: Summary;
  fetchError?: string;
};

type ActionType = "verify" | "dispute" | "close" | "reset_open";

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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function statusClass(status: Row["status"]) {
  if (status === "disputed") return "bg-red-100 text-red-700";
  if (status === "submitted") return "bg-amber-100 text-amber-700";
  if (status === "verified") return "bg-emerald-100 text-emerald-700";
  if (status === "closed") return "bg-blue-100 text-blue-700";
  return "bg-slate-100 text-slate-700";
}

export default function CashReconciliationPanel({
  adminKey,
  initialWeekKey,
  initialRows,
  initialSummary,
  fetchError,
}: Props) {
  const router = useRouter();
  const [weekKey, setWeekKey] = useState(initialWeekKey);
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [summary, setSummary] = useState<Summary>(initialSummary);
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState("");
  const [error, setError] = useState(fetchError || "");
  const [success, setSuccess] = useState("");
  const [driverCashRows, setDriverCashRows] = useState<DriverCashRow[]>([]);
  const [driverCashStatusFilter, setDriverCashStatusFilter] = useState<"all" | DriverCashStatus>("all");
  const [driverCashTotals, setDriverCashTotals] = useState<DriverCashTotals>({
    byStatus: {
      collected: 0,
      handed_to_merchant: 0,
      disputed: 0,
      void: 0,
    },
    byDriver: [],
    byBusiness: [],
  });
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditTitle, setAuditTitle] = useState("");
  const [auditOpen, setAuditOpen] = useState(false);

  const statusCounts = useMemo(
    () => ({
      submitted: Number(summary.submittedCount || 0),
      verified: Number(summary.verifiedCount || 0),
      disputed: Number(summary.disputedCount || 0),
    }),
    [summary]
  );

  async function loadDriverCash(nextWeekKey: string, nextStatus = driverCashStatusFilter) {
    try {
      const params = new URLSearchParams({
        key: adminKey,
        weekKey: nextWeekKey,
      });
      if (nextStatus !== "all") params.set("status", nextStatus);
      const response = await fetch(`/api/admin/driver-cash?${params.toString()}`, {
        cache: "no-store",
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not load driver cash."
        );
      }
      setDriverCashRows(Array.isArray(json.rows) ? json.rows : []);
      setDriverCashTotals(
        json.totals || {
          byStatus: {
            collected: 0,
            handed_to_merchant: 0,
            disputed: 0,
            void: 0,
          },
          byDriver: [],
          byBusiness: [],
        }
      );
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not load driver cash.");
    }
  }

  async function loadForWeek(nextWeekKey: string) {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(
        `/api/admin/cash-collections?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(nextWeekKey)}&limit=200`,
        { cache: "no-store" }
      );
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not load cash collections."
        );
      }
      setRows(Array.isArray(json.rows) ? json.rows : []);
      setSummary(
        json.summary || {
          totalExpectedNet: 0,
          totalReportedCash: 0,
          totalCashDiff: 0,
          submittedCount: 0,
          verifiedCount: 0,
          disputedCount: 0,
          openCount: 0,
          closedCount: 0,
          driverCollectedTotalRdp: 0,
          driverHandedTotalRdp: 0,
          driverDisputedTotalRdp: 0,
          driverMismatchCount: 0,
        }
      );
      setWeekKey(String(json.weekKey || nextWeekKey));
      await loadDriverCash(String(json.weekKey || nextWeekKey));
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not load rows.");
    } finally {
      setLoading(false);
    }
  }

  async function markDriverCashHanded(row: DriverCashRow) {
    if (loadingAction) return;
    const handedToMerchantBy = window.prompt("Handed to merchant by (required):", "ops-admin")?.trim() || "";
    if (!handedToMerchantBy) {
      setError("handedToMerchantBy is required.");
      return;
    }
    const receiptRef = window.prompt("Receipt ref (optional):", row.receiptRef || "")?.trim() || "";
    const proofUrl = window.prompt("Proof URL (optional):", row.proofUrl || "")?.trim() || "";
    setLoadingAction(`driverCash:handed:${row.id}`);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(
        `/api/admin/driver-cash/mark-handed?key=${encodeURIComponent(adminKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: row.orderId,
            handedToMerchantBy,
            receiptRef,
            proofUrl,
            confirm: "HANDOFF",
          }),
        }
      );
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not mark handoff as handed."
        );
      }
      setSuccess("Driver cash marked as handed.");
      await loadForWeek(weekKey);
      router.refresh();
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not mark handoff as handed."
      );
    } finally {
      setLoadingAction("");
    }
  }

  async function openDriverCashDispute(row: DriverCashRow) {
    if (loadingAction) return;
    const reason = window.prompt("Dispute reason (required):", row.disputeSummary?.reason || "")?.trim() || "";
    if (!reason) {
      setError("Dispute reason is required.");
      return;
    }
    setLoadingAction(`driverCash:disputeOpen:${row.id}`);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(
        `/api/admin/driver-cash/dispute/open?key=${encodeURIComponent(adminKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: row.orderId,
            reason,
            confirm: "DISPUTE",
          }),
        }
      );
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not open dispute."
        );
      }
      setSuccess("Driver cash dispute opened.");
      await loadForWeek(weekKey);
      router.refresh();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not open dispute.");
    } finally {
      setLoadingAction("");
    }
  }

  async function resolveDriverCashDispute(
    row: DriverCashRow,
    resolution: "merchant_confirmed" | "driver_confirmed" | "writeoff"
  ) {
    if (loadingAction) return;
    const note = window.prompt("Resolution note (optional):", "")?.trim() || "";
    setLoadingAction(`driverCash:resolve:${row.id}:${resolution}`);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(
        `/api/admin/driver-cash/dispute/resolve?key=${encodeURIComponent(adminKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: row.orderId,
            resolution,
            note,
            confirm: "RESOLVE",
          }),
        }
      );
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not resolve dispute."
        );
      }
      setSuccess(`Dispute resolved: ${resolution}.`);
      await loadForWeek(weekKey);
      router.refresh();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not resolve dispute.");
    } finally {
      setLoadingAction("");
    }
  }

  async function runAction(row: Row, action: ActionType) {
    if (loadingAction) return;
    let note = "";
    if (action === "dispute") {
      note = window.prompt("Dispute note (required):", "")?.trim() || "";
      if (!note) {
        setError("Dispute requires a note.");
        return;
      }
    }
    if (action === "close" || action === "reset_open") {
      note = window.prompt("Optional admin note:", "")?.trim() || "";
    }

    setLoadingAction(`${row.businessId}:${action}`);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(
        `/api/admin/cash-collections/verify?key=${encodeURIComponent(adminKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessId: row.businessId,
            weekKey,
            action,
            note,
            confirm: "VERIFY",
          }),
        }
      );
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not update status."
        );
      }
      setSuccess(`Action ${action} completed.`);
      await loadForWeek(weekKey);
      router.refresh();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not update status.");
    } finally {
      setLoadingAction("");
    }
  }

  async function openAudits(row: Row) {
    if (loadingAction) return;
    setLoadingAction(`audits:${row.businessId}`);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/cash-collections/audits?key=${encodeURIComponent(
          adminKey
        )}&businessId=${encodeURIComponent(row.businessId)}&weekKey=${encodeURIComponent(weekKey)}&limit=20`,
        { cache: "no-store" }
      );
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not load audits."
        );
      }
      setAuditRows(Array.isArray(json.audits) ? json.audits : []);
      setAuditTitle(`${row.businessName} - ${weekKey}`);
      setAuditOpen(true);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not load audits.");
    } finally {
      setLoadingAction("");
    }
  }

  async function recomputeNow() {
    if (loadingAction) return;
    setLoadingAction("recompute");
    setError("");
    setSuccess("");
    try {
      const response = await fetch(
        `/api/admin/jobs/cash-collections-compute?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
          weekKey
        )}`,
        {
          method: "POST",
        }
      );
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not run recompute."
        );
      }
      setSuccess("Cash collections recomputed.");
      await loadForWeek(weekKey);
      router.refresh();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not run recompute.");
    } finally {
      setLoadingAction("");
    }
  }

  useEffect(() => {
    loadDriverCash(weekKey, driverCashStatusFilter).catch(() => null);
  }, [weekKey, driverCashStatusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Cash Reconciliation</h2>
            {Number(summary.driverMismatchCount || 0) > 0 ? (
              <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
                Driver cash mismatch
              </span>
            ) : null}
          </div>
          <p className="text-xs text-slate-500">Week-level merchant cash reconciliation sheet</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={weekKey}
            onChange={(e) => setWeekKey(e.target.value)}
            placeholder="YYYY-Www"
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <button
            type="button"
            disabled={loading || Boolean(loadingAction)}
            onClick={() => loadForWeek(weekKey)}
            className="rounded border border-slate-300 px-3 py-1 text-sm font-semibold"
          >
            {loading ? "Loading..." : "Load Week"}
          </button>
          <button
            type="button"
            disabled={loading || Boolean(loadingAction)}
            onClick={recomputeNow}
            className="rounded border border-slate-300 px-3 py-1 text-sm font-semibold"
          >
            {loadingAction === "recompute" ? "Running..." : "Recompute Now"}
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile label="Expected Net" value={formatMoney(summary.totalExpectedNet)} />
        <MetricTile label="Reported Cash" value={formatMoney(summary.totalReportedCash)} />
        <MetricTile label="Cash Diff" value={formatMoney(summary.totalCashDiff)} />
        <MetricTile label="Submitted" value={String(statusCounts.submitted)} />
        <MetricTile label="Verified" value={String(statusCounts.verified)} />
        <MetricTile label="Disputed" value={String(statusCounts.disputed)} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="Driver Collected"
          value={formatMoney(summary.driverCollectedTotalRdp)}
        />
        <MetricTile label="Driver Handed" value={formatMoney(summary.driverHandedTotalRdp)} />
        <MetricTile
          label="Driver Disputed"
          value={formatMoney(summary.driverDisputedTotalRdp)}
        />
        <MetricTile
          label="Driver Mismatch Rows"
          value={String(Number(summary.driverMismatchCount || 0))}
        />
      </div>

      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mt-2 text-sm text-emerald-700">{success}</p> : null}

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-2">Business</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Expected Net</th>
              <th className="pb-2">Reported Cash</th>
              <th className="pb-2">Cash Diff</th>
              <th className="pb-2">Driver Cash</th>
              <th className="pb-2">Orders Diff</th>
              <th className="pb-2">Proof</th>
              <th className="pb-2">Updated</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 align-top">
                  <td className="py-2">
                    <div className="font-medium">{row.businessName}</div>
                    <div className="font-mono text-xs text-slate-500">
                      hash: {row.integrity.expectedHash ? `${row.integrity.expectedHash.slice(0, 10)}...` : "-"}
                    </div>
                  </td>
                  <td className="py-2">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(row.status)}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="py-2">{formatMoney(row.expected.netSubtotal)}</td>
                  <td className="py-2">{formatMoney(row.reported.cashCollected)}</td>
                  <td className="py-2">{formatMoney(row.discrepancy.cashDiff)}</td>
                  <td className="py-2">
                    <div className="text-xs">
                      <div>C: {formatMoney(row.driverCash?.driverCollectedTotalRdp)}</div>
                      <div>H: {formatMoney(row.driverCash?.driverHandedTotalRdp)}</div>
                      <div>D: {formatMoney(row.driverCash?.driverDisputedTotalRdp)}</div>
                      {row.driverCash?.mismatchSignal ? (
                        <span className="mt-1 inline-block rounded-full bg-red-100 px-2 py-1 text-[10px] font-semibold text-red-700">
                          mismatch
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="py-2">{row.discrepancy.ordersDiff}</td>
                  <td className="py-2">
                    {row.proofComplete ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                        Complete
                      </span>
                    ) : (
                      <div className="grid gap-1">
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
                          Incomplete
                        </span>
                        {Array.isArray(row.missingProofFields) && row.missingProofFields.length ? (
                          <span className="text-xs text-amber-700">
                            {row.missingProofFields.join(", ")}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td className="py-2">{formatDateTime(row.updatedAt)}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={Boolean(loadingAction)}
                        onClick={() => runAction(row, "verify")}
                        className="rounded border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700"
                      >
                        {loadingAction === `${row.businessId}:verify` ? "..." : "Verify"}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(loadingAction)}
                        onClick={() => runAction(row, "dispute")}
                        className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700"
                      >
                        {loadingAction === `${row.businessId}:dispute` ? "..." : "Dispute"}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(loadingAction)}
                        onClick={() => runAction(row, "close")}
                        className="rounded border border-blue-300 px-2 py-1 text-xs font-semibold text-blue-700"
                      >
                        {loadingAction === `${row.businessId}:close` ? "..." : "Close"}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(loadingAction)}
                        onClick={() => runAction(row, "reset_open")}
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                      >
                        {loadingAction === `${row.businessId}:reset_open` ? "..." : "Reset Open"}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(loadingAction)}
                        onClick={() => openAudits(row)}
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                      >
                        {loadingAction === `audits:${row.businessId}` ? "..." : "Audits"}
                      </button>
                      <a
                        href={`/admin/statements?key=${encodeURIComponent(adminKey)}&businessId=${encodeURIComponent(
                          row.businessId
                        )}&weekKey=${encodeURIComponent(weekKey)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                      >
                        Statement
                      </a>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={10} className="py-3 text-center text-slate-500">
                  No cash collection rows for this week.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="mt-5 rounded-lg border border-slate-200 p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Driver Cash</h3>
            <p className="text-xs text-slate-500">
              Track collected/handed/disputed cash events for driver handoff proof.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={driverCashStatusFilter}
              onChange={(event) =>
                setDriverCashStatusFilter(
                  event.target.value as "all" | "collected" | "handed_to_merchant" | "disputed" | "void"
                )
              }
              className="rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="all">all statuses</option>
              <option value="collected">collected</option>
              <option value="handed_to_merchant">handed_to_merchant</option>
              <option value="disputed">disputed</option>
              <option value="void">void</option>
            </select>
            <button
              type="button"
              disabled={Boolean(loadingAction)}
              onClick={() => loadDriverCash(weekKey, driverCashStatusFilter)}
              className="rounded border border-slate-300 px-2 py-1 text-sm font-semibold"
            >
              Refresh Driver Cash
            </button>
          </div>
        </div>

        <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile label="Collected" value={formatMoney(driverCashTotals.byStatus.collected)} />
          <MetricTile
            label="Handed"
            value={formatMoney(driverCashTotals.byStatus.handed_to_merchant)}
          />
          <MetricTile label="Disputed" value={formatMoney(driverCashTotals.byStatus.disputed)} />
          <MetricTile label="Void" value={formatMoney(driverCashTotals.byStatus.void)} />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Order</th>
                <th className="pb-2">Business</th>
                <th className="pb-2">Driver</th>
                <th className="pb-2">Amount</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Collected</th>
                <th className="pb-2">Handed</th>
                <th className="pb-2">Proof</th>
                <th className="pb-2">Dispute</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {driverCashRows.length ? (
                driverCashRows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 align-top">
                    <td className="py-2 font-mono text-xs">{row.orderNumber || row.orderId}</td>
                    <td className="py-2">{row.businessName}</td>
                    <td className="py-2">{row.driverName}</td>
                    <td className="py-2">{formatMoney(row.amountCollectedRdp)}</td>
                    <td className="py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">
                        {row.status}
                      </span>
                    </td>
                    <td className="py-2">{formatDateTime(row.collectedAt)}</td>
                    <td className="py-2">{formatDateTime(row.handedToMerchantAt)}</td>
                    <td className="py-2 text-xs">
                      <div>{row.receiptRef || "-"}</div>
                      {row.proofUrl ? (
                        <a
                          href={row.proofUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-700 underline"
                        >
                          proof
                        </a>
                      ) : null}
                    </td>
                    <td className="py-2 text-xs">
                      {row.disputeSummary ? (
                        <div className="space-y-1">
                          <div>{row.disputeSummary.reason || "-"}</div>
                          <div>
                            {row.disputeSummary.openedBy || "-"} /{" "}
                            {formatDateTime(row.disputeSummary.openedAt)}
                          </div>
                          <div>
                            {row.disputeSummary.resolution || "-"} /{" "}
                            {formatDateTime(row.disputeSummary.resolvedAt)}
                          </div>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {(row.status === "collected" || row.status === "disputed") ? (
                          <button
                            type="button"
                            disabled={Boolean(loadingAction)}
                            onClick={() => markDriverCashHanded(row)}
                            className="rounded border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700"
                          >
                            {loadingAction === `driverCash:handed:${row.id}` ? "..." : "Mark Handed"}
                          </button>
                        ) : null}
                        {row.status !== "disputed" && row.status !== "void" ? (
                          <button
                            type="button"
                            disabled={Boolean(loadingAction)}
                            onClick={() => openDriverCashDispute(row)}
                            className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700"
                          >
                            {loadingAction === `driverCash:disputeOpen:${row.id}` ? "..." : "Open Dispute"}
                          </button>
                        ) : null}
                        {row.status === "disputed" ? (
                          <>
                            <button
                              type="button"
                              disabled={Boolean(loadingAction)}
                              onClick={() => resolveDriverCashDispute(row, "merchant_confirmed")}
                              className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                            >
                              Merchant Confirmed
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(loadingAction)}
                              onClick={() => resolveDriverCashDispute(row, "driver_confirmed")}
                              className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                            >
                              Driver Confirmed
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(loadingAction)}
                              onClick={() => resolveDriverCashDispute(row, "writeoff")}
                              className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                            >
                              Writeoff
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="py-3 text-center text-slate-500">
                    No driver cash rows for this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {auditOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="font-semibold">Cash Audits - {auditTitle}</h3>
              <button
                type="button"
                onClick={() => setAuditOpen(false)}
                className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
              >
                Close
              </button>
            </div>
            <div className="max-h-[65vh] overflow-auto p-4">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pb-2">Time</th>
                    <th className="pb-2">Action</th>
                    <th className="pb-2">Actor</th>
                    <th className="pb-2">Note</th>
                    <th className="pb-2">Proof Check</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRows.length ? (
                    auditRows.map((row) => (
                      <tr key={row.id} className="border-t border-slate-100">
                        <td className="py-2">{formatDateTime(row.createdAt)}</td>
                        <td className="py-2">{row.action}</td>
                        <td className="py-2">{row.actor?.type || "-"}</td>
                        <td className="py-2">{row.note || "-"}</td>
                        <td className="py-2">
                          {row.meta?.enforcedProof ? (
                            Array.isArray(row.meta?.missingFields) && row.meta?.missingFields.length ? (
                              <span className="text-amber-700">
                                missing: {row.meta.missingFields.join(", ")}
                              </span>
                            ) : (
                              <span className="text-emerald-700">enforced ok</span>
                            )
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-3 text-center text-slate-500">
                        No audits found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </section>
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
