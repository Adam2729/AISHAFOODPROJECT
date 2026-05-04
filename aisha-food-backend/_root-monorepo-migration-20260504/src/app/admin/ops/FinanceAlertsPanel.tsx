"use client";

import { useEffect, useMemo, useState } from "react";

type FinanceAlertRow = {
  id: string;
  weekKey: string;
  dayKey: string;
  businessId: string;
  businessName: string;
  type: string;
  severity: "high" | "medium" | "low";
  status: "open" | "acknowledged" | "resolved";
  meta?: Record<string, unknown> | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  ack?: { by?: string | null; at?: string | null; note?: string | null } | null;
  resolved?: { by?: string | null; at?: string | null; note?: string | null } | null;
};

type DigestPayload = {
  counts?: { high?: number; medium?: number; low?: number; openTotal?: number };
  top?: Array<{
    id: string;
    businessId: string;
    businessName: string;
    type: string;
    severity: "high" | "medium" | "low";
    status: "open" | "acknowledged" | "resolved";
    lastSeenAt?: string | null;
    meta?: Record<string, unknown> | null;
  }>;
  messageEs?: string;
};

type AlertsPayload = {
  summary?: {
    openHigh?: number;
    openTotal?: number;
    acknowledgedTotal?: number;
    resolvedTotal?: number;
  };
  alerts?: FinanceAlertRow[];
};

type Props = {
  adminKey: string;
  defaultWeekKey: string;
  defaultDayKey: string;
  supportWhatsAppE164?: string;
};

function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function severityClass(severity: "high" | "medium" | "low") {
  if (severity === "high") return "bg-red-100 text-red-700";
  if (severity === "medium") return "bg-amber-100 text-amber-700";
  return "bg-emerald-100 text-emerald-700";
}

export default function FinanceAlertsPanel({
  adminKey,
  defaultWeekKey,
  defaultDayKey,
  supportWhatsAppE164,
}: Props) {
  const [weekKey, setWeekKey] = useState(defaultWeekKey);
  const [dayKey, setDayKey] = useState(defaultDayKey);
  const [status, setStatus] = useState<"open" | "acknowledged" | "resolved">("open");
  const [severity, setSeverity] = useState<"" | "high" | "medium" | "low">("");
  const [limit, setLimit] = useState(100);
  const [alertsPayload, setAlertsPayload] = useState<AlertsPayload>({});
  const [digestPayload, setDigestPayload] = useState<DigestPayload>({});
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const alerts = useMemo(() => alertsPayload.alerts || [], [alertsPayload.alerts]);
  const summary = alertsPayload.summary || {
    openHigh: 0,
    openTotal: 0,
    acknowledgedTotal: 0,
    resolvedTotal: 0,
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadData() {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const digestParams = new URLSearchParams({
        key: adminKey,
        weekKey: weekKey.trim(),
        dayKey: dayKey.trim(),
      });
      const alertsParams = new URLSearchParams({
        key: adminKey,
        weekKey: weekKey.trim(),
        status,
        limit: String(Math.max(1, Math.min(200, limit))),
      });
      if (severity) alertsParams.set("severity", severity);

      const [digestRes, alertsRes] = await Promise.all([
        fetch(`/api/admin/finance/digest?${digestParams.toString()}`, { cache: "no-store" }),
        fetch(`/api/admin/finance/alerts?${alertsParams.toString()}`, { cache: "no-store" }),
      ]);
      const [digestJson, alertsJson] = await Promise.all([
        digestRes.json().catch(() => null),
        alertsRes.json().catch(() => null),
      ]);

      if (!digestRes.ok || !digestJson?.ok) {
        throw new Error(
          (typeof digestJson?.error === "string"
            ? digestJson.error
            : digestJson?.error?.message) || "Could not load digest."
        );
      }
      if (!alertsRes.ok || !alertsJson?.ok) {
        throw new Error(
          (typeof alertsJson?.error === "string"
            ? alertsJson.error
            : alertsJson?.error?.message) || "Could not load finance alerts."
        );
      }

      setDigestPayload({
        counts: digestJson.counts || {},
        top: Array.isArray(digestJson.top) ? digestJson.top : [],
        messageEs: String(digestJson.messageEs || ""),
      });
      setAlertsPayload({
        summary: alertsJson.summary || {},
        alerts: Array.isArray(alertsJson.alerts) ? alertsJson.alerts : [],
      });
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not load finance alerts.");
    } finally {
      setLoading(false);
    }
  }

  async function postAction(
    endpoint: "/api/admin/finance/alerts/ack" | "/api/admin/finance/alerts/resolve",
    payload: { alertId: string; by: string; note: string; confirm: "ACK" | "RESOLVE" }
  ) {
    setActionLoading(true);
    setError("");
    setSuccess("");
    try {
      const params = new URLSearchParams({ key: adminKey });
      const response = await fetch(`${endpoint}?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not update alert."
        );
      }
      setSuccess("Alert updated.");
      await loadData();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not update alert.");
    } finally {
      setActionLoading(false);
    }
  }

  async function copyDigest() {
    const message = String(digestPayload.messageEs || "").trim();
    if (!message) {
      setError("No digest message to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(message);
      setSuccess("Digest copied to clipboard.");
    } catch {
      setError("Could not copy digest message.");
    }
  }

  function openWhatsApp() {
    const message = String(digestPayload.messageEs || "").trim();
    if (!message) {
      setError("No digest message to send.");
      return;
    }
    const phone = String(supportWhatsAppE164 || "").replace(/[^\d]/g, "");
    if (!phone) {
      setError("Support WhatsApp number is not configured.");
      return;
    }
    const link = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(link, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Finance Alerts</h2>
          <p className="text-xs text-slate-500">Ops inbox + WhatsApp-ready daily digest</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={weekKey}
            onChange={(e) => setWeekKey(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            placeholder="YYYY-Www"
          />
          <input
            value={dayKey}
            onChange={(e) => setDayKey(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            placeholder="YYYY-MM-DD"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as "open" | "acknowledged" | "resolved")}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="open">open</option>
            <option value="acknowledged">acknowledged</option>
            <option value="resolved">resolved</option>
          </select>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as "" | "high" | "medium" | "low")}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">all severity</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
          <input
            value={String(limit)}
            onChange={(e) => setLimit(Number(e.target.value || 100))}
            className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
            placeholder="limit"
          />
          <button
            type="button"
            onClick={loadData}
            disabled={loading || actionLoading}
            className="rounded border border-slate-300 px-3 py-1 text-sm font-semibold"
          >
            {loading ? "Loading..." : "Load"}
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Open High" value={String(Number(summary.openHigh || 0))} />
        <Kpi label="Open Total" value={String(Number(summary.openTotal || 0))} />
        <Kpi label="Acknowledged" value={String(Number(summary.acknowledgedTotal || 0))} />
        <Kpi label="Resolved" value={String(Number(summary.resolvedTotal || 0))} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copyDigest}
          className="rounded border border-slate-300 px-3 py-1 text-sm font-semibold"
        >
          Copy WhatsApp Digest
        </button>
        <button
          type="button"
          onClick={openWhatsApp}
          className="rounded border border-slate-300 px-3 py-1 text-sm font-semibold"
        >
          Open WhatsApp
        </button>
      </div>

      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mt-2 text-sm text-emerald-700">{success}</p> : null}

      <pre className="mt-3 max-h-52 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs whitespace-pre-wrap">
        {String(digestPayload.messageEs || "Load digest to preview message.")}
      </pre>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-2">Business</th>
              <th className="pb-2">Type</th>
              <th className="pb-2">Severity</th>
              <th className="pb-2">Last Seen</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {alerts.length ? (
              alerts.map((alert) => (
                <tr key={alert.id} className="border-t border-slate-100 align-top">
                  <td className="py-2">
                    <div className="font-medium">{alert.businessName}</div>
                    <div className="font-mono text-xs text-slate-500">{alert.businessId}</div>
                  </td>
                  <td className="py-2">{alert.type}</td>
                  <td className="py-2">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${severityClass(alert.severity)}`}>
                      {alert.severity}
                    </span>
                  </td>
                  <td className="py-2">{formatDateTime(alert.lastSeenAt)}</td>
                  <td className="py-2">{alert.status}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={actionLoading || alert.status === "resolved"}
                        onClick={() => {
                          const by = window.prompt("Ack by", "ops") || "ops";
                          const note = window.prompt("Ack note (optional)", "") || "";
                          void postAction("/api/admin/finance/alerts/ack", {
                            alertId: alert.id,
                            by,
                            note,
                            confirm: "ACK",
                          });
                        }}
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold disabled:opacity-60"
                      >
                        Ack
                      </button>
                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={() => {
                          const by = window.prompt("Resolve by", "ops") || "ops";
                          const note = window.prompt("Resolve note (optional)", "") || "";
                          void postAction("/api/admin/finance/alerts/resolve", {
                            alertId: alert.id,
                            by,
                            note,
                            confirm: "RESOLVE",
                          });
                        }}
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold disabled:opacity-60"
                      >
                        Resolve
                      </button>
                      <a
                        href={`/api/admin/finance/mismatches?key=${encodeURIComponent(
                          adminKey
                        )}&weekKey=${encodeURIComponent(weekKey.trim())}&businessId=${encodeURIComponent(
                          alert.businessId
                        )}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                      >
                        View Mismatch
                      </a>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="py-3 text-center text-slate-500">
                  No finance alerts.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
