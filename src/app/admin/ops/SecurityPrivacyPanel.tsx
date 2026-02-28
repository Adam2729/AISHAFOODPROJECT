"use client";

import { useMemo, useState } from "react";

type MetricsPayload = {
  ok?: boolean;
  kpis?: {
    blockedByRateLimitToday?: Array<{
      route: string;
      count: number;
    }>;
    piiRedactionLastRunAt?: string | null;
    piiRedactionLastCounts?: {
      ordersScanned?: number;
      ordersRedacted?: number;
      complaintsScanned?: number;
      complaintsRedacted?: number;
    };
    piiRetentionDays?: number;
    topAbuseIpsHashedToday?: Array<{
      ipHash: string;
      count: number;
    }>;
  };
  error?: { message?: string } | string;
};

type PiiRevealPayload = {
  ok?: boolean;
  orderId?: string;
  orderNumber?: string;
  pii?: {
    phone?: string | null;
    customerName?: string;
    address?: string;
  };
  error?: { message?: string } | string;
};

function errorMessage(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && "message" in value) {
    const message = String((value as { message?: unknown }).message || "").trim();
    if (message) return message;
  }
  return fallback;
}

export default function SecurityPrivacyPanel({ adminKey }: { adminKey: string }) {
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [revealLoading, setRevealLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [metrics, setMetrics] = useState<MetricsPayload["kpis"] | null>(null);
  const [orderId, setOrderId] = useState("");
  const [reason, setReason] = useState("");
  const [revealed, setRevealed] = useState<PiiRevealPayload | null>(null);

  const hasData = useMemo(() => Boolean(metrics), [metrics]);

  async function loadMetrics() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/metrics?key=${encodeURIComponent(adminKey)}`,
        { cache: "no-store" }
      );
      const json = (await response.json().catch(() => null)) as MetricsPayload | null;
      if (!response.ok || !json?.ok) {
        throw new Error(errorMessage(json?.error, "Could not load security metrics."));
      }
      setMetrics(json.kpis || null);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load security metrics."
      );
    } finally {
      setLoading(false);
    }
  }

  async function runRedactionNow() {
    setRunning(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(
        `/api/admin/jobs/pii-redact?key=${encodeURIComponent(adminKey)}`,
        {
          method: "POST",
          cache: "no-store",
        }
      );
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: unknown }
        | null;
      if (!response.ok || !json?.ok) {
        throw new Error(errorMessage(json?.error, "Could not run PII redaction."));
      }
      setSuccess("PII redaction job completed.");
      await loadMetrics();
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not run PII redaction."
      );
    } finally {
      setRunning(false);
    }
  }

  async function revealOrderPii() {
    if (!orderId.trim()) {
      setError("orderId is required.");
      return;
    }
    if (reason.trim().length < 10) {
      setError("Reason must be at least 10 characters.");
      return;
    }
    setRevealLoading(true);
    setError("");
    setSuccess("");
    try {
      const query = new URLSearchParams({
        key: adminKey,
        orderId: orderId.trim(),
        confirm: "REVEAL",
        reason: reason.trim(),
      });
      const response = await fetch(`/api/admin/orders/pii?${query.toString()}`, {
        cache: "no-store",
      });
      const json = (await response.json().catch(() => null)) as PiiRevealPayload | null;
      if (!response.ok || !json?.ok) {
        throw new Error(errorMessage(json?.error, "Could not reveal order contact."));
      }
      setRevealed(json);
      setSuccess("Order contact revealed. This action is audited.");
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not reveal order contact."
      );
    } finally {
      setRevealLoading(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Security & Privacy</h3>
          <p className="text-xs text-slate-500">
            PII retention, redaction status, and abuse blocks (hashed identifiers only).
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={loadMetrics}
            disabled={loading}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
          <button
            type="button"
            onClick={runRedactionNow}
            disabled={running}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold"
          >
            {running ? "Running..." : "Run PII Redaction"}
          </button>
        </div>
      </div>

      {error ? <p className="mb-2 text-xs text-red-600">{error}</p> : null}
      {success ? <p className="mb-2 text-xs text-emerald-700">{success}</p> : null}

      {!hasData ? (
        <p className="text-xs text-slate-500">Load metrics to view security summary.</p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded border border-slate-200 p-2">
              <p className="text-[11px] uppercase text-slate-500">PII Retention</p>
              <p className="text-sm font-semibold">
                {Number(metrics?.piiRetentionDays || 0)} days
              </p>
            </div>
            <div className="rounded border border-slate-200 p-2">
              <p className="text-[11px] uppercase text-slate-500">Last Redaction</p>
              <p className="text-sm font-semibold">
                {metrics?.piiRedactionLastRunAt
                  ? new Date(metrics.piiRedactionLastRunAt).toLocaleString()
                  : "-"}
              </p>
            </div>
            <div className="rounded border border-slate-200 p-2">
              <p className="text-[11px] uppercase text-slate-500">Orders Redacted</p>
              <p className="text-sm font-semibold">
                {Number(metrics?.piiRedactionLastCounts?.ordersRedacted || 0)}
              </p>
            </div>
            <div className="rounded border border-slate-200 p-2">
              <p className="text-[11px] uppercase text-slate-500">Complaints Redacted</p>
              <p className="text-sm font-semibold">
                {Number(metrics?.piiRedactionLastCounts?.complaintsRedacted || 0)}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded border border-slate-200 p-3">
              <h4 className="text-sm font-semibold">Rate Limit Blocks (Today)</h4>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="py-1">Route</th>
                      <th className="py-1">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(metrics?.blockedByRateLimitToday || []).length ? (
                      (metrics?.blockedByRateLimitToday || []).map((row) => (
                        <tr key={row.route} className="border-t border-slate-100">
                          <td className="py-1 font-mono">{row.route}</td>
                          <td className="py-1">{row.count}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={2} className="py-2 text-slate-500">
                          No blocks today.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded border border-slate-200 p-3">
              <h4 className="text-sm font-semibold">Top Abuse IDs (Hashed IP)</h4>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="py-1">IP Hash</th>
                      <th className="py-1">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(metrics?.topAbuseIpsHashedToday || []).length ? (
                      (metrics?.topAbuseIpsHashedToday || []).map((row) => (
                        <tr key={row.ipHash} className="border-t border-slate-100">
                          <td className="py-1 font-mono text-[10px]">{row.ipHash}</td>
                          <td className="py-1">{row.count}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={2} className="py-2 text-slate-500">
                          No abuse IDs today.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="mt-4 rounded border border-slate-200 p-3">
        <h4 className="text-sm font-semibold">Reveal Order Contact (Audited)</h4>
        <p className="mt-1 text-xs text-slate-500">
          Requires explicit reason and is logged as an admin PII access event.
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <input
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="Order ID"
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (min 10 chars)"
            className="rounded border border-slate-300 px-2 py-1 text-xs sm:col-span-2"
          />
        </div>
        <div className="mt-2">
          <button
            type="button"
            onClick={revealOrderPii}
            disabled={revealLoading}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold"
          >
            {revealLoading ? "Revealing..." : "Reveal Contact"}
          </button>
        </div>
        {revealed?.pii ? (
          <div className="mt-3 rounded bg-slate-50 p-2 text-xs">
            <p>Order: {revealed.orderNumber || revealed.orderId}</p>
            <p>Phone: {revealed.pii.phone || "(redacted)"}</p>
            <p>Name: {revealed.pii.customerName || "-"}</p>
            <p>Address: {revealed.pii.address || "-"}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

