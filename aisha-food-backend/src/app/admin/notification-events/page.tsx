"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type NotificationRow = {
  id: string;
  audience?: string | null;
  eventType?: string | null;
  status?: string | null;
  deliveryMode?: string | null;
  title?: string;
  body?: string;
  cityId?: string | null;
  businessId?: string | null;
  orderId?: string | null;
  driverId?: string | null;
  suggestedChannels?: string[];
  source?: string | null;
  meta?: Record<string, unknown> | null;
  processedAt?: string | null;
  cancelledAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type NotificationEventsResponse = {
  ok?: boolean;
  rows?: NotificationRow[];
  error?: { message?: string } | string;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

function formatDate(value: unknown) {
  if (!value) return "-";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function toneForStatus(status: string | null | undefined) {
  switch (String(status || "").trim()) {
    case "processed":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "cancelled":
      return "bg-rose-50 text-rose-700 ring-rose-200";
    default:
      return "bg-amber-50 text-amber-700 ring-amber-200";
  }
}

export default function AdminNotificationEventsPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [audience, setAudience] = useState("merchant");
  const [status, setStatus] = useState("");
  const [eventType, setEventType] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [limit, setLimit] = useState("50");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (audience) params.set("audience", audience);
    if (status) params.set("status", status);
    if (eventType.trim()) params.set("eventType", eventType.trim());
    if (businessId.trim()) params.set("businessId", businessId.trim());
    if (orderId.trim()) params.set("orderId", orderId.trim());
    if (limit.trim()) params.set("limit", limit.trim());
    return params.toString();
  }, [audience, status, eventType, businessId, orderId, limit]);

  async function loadRows() {
    if (!authenticated) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/notification-events?${queryString}`, {
        cache: "no-store",
      });
      if (res.status === 401) {
        setAuthenticated(false);
        setRows([]);
        return;
      }
      const json = (await res.json().catch(() => null)) as NotificationEventsResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not load notification events."));
      }
      setRows(Array.isArray(json.rows) ? json.rows : []);
    } catch (requestError: unknown) {
      setRows([]);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load notification events."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      try {
        const res = await fetch("/api/admin/session", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { authenticated?: boolean } | null;
        if (!active) return;
        setAuthenticated(Boolean(res.ok && json?.authenticated));
      } catch {
        if (!active) return;
        setAuthenticated(false);
      }
    }
    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    void loadRows();
  }, [authenticated, queryString]); // eslint-disable-line react-hooks/exhaustive-deps

  if (authenticated === null) {
    return (
      <main className="mx-auto min-h-screen max-w-7xl p-6">
        <h1 className="text-2xl font-bold">Notification Events</h1>
        <p className="mt-2 text-sm text-slate-600">Checking secure admin session...</p>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="mx-auto min-h-screen max-w-7xl p-6">
        <h1 className="text-2xl font-bold">Notification Events</h1>
        <p className="mt-2 text-sm text-red-600">
          Admin access requires a secure browser session.
        </p>
        <Link
          href="/admin/access?next=/admin/notification-events"
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Notification Events</h1>
          <p className="text-sm text-slate-600">
            Inspect merchant and customer notification events without opening raw JSON API responses.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin"
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Admin Home
          </Link>
          <Link
            href="/admin/ops"
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Ops Center
          </Link>
          <button
            type="button"
            onClick={() => void loadRows()}
            disabled={loading}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? (
        <section className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </section>
      ) : null}

      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <select
            value={audience}
            onChange={(event) => setAudience(event.target.value)}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All audiences</option>
            <option value="merchant">Merchant</option>
            <option value="customer">Customer</option>
          </select>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Any status</option>
            <option value="pending">Pending</option>
            <option value="processed">Processed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <input
            value={eventType}
            onChange={(event) => setEventType(event.target.value)}
            placeholder="Event type"
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={businessId}
            onChange={(event) => setBusinessId(event.target.value)}
            placeholder="Business ID"
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={orderId}
            onChange={(event) => setOrderId(event.target.value)}
            placeholder="Order ID"
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            placeholder="Limit"
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Event</th>
              <th className="px-4 py-3 font-semibold">Audience</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Route</th>
              <th className="px-4 py-3 font-semibold">Source</th>
              <th className="px-4 py-3 font-semibold">Created</th>
              <th className="px-4 py-3 font-semibold">IDs</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-950">{row.title || row.eventType || "-"}</div>
                    <div className="mt-1 max-w-xl text-xs leading-5 text-slate-600">{row.body || "-"}</div>
                    {row.meta ? (
                      <pre className="mt-2 max-w-xl overflow-x-auto rounded bg-slate-50 p-2 text-[11px] text-slate-500">
                        {JSON.stringify(row.meta, null, 2)}
                      </pre>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{row.audience || "-"}</div>
                    <div className="mt-1 text-xs text-slate-500">{row.eventType || "-"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ring-1 ${toneForStatus(
                        row.status
                      )}`}
                    >
                      {row.status || "-"}
                    </span>
                    <div className="mt-2 text-xs text-slate-500">
                      Processed: {formatDate(row.processedAt)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Cancelled: {formatDate(row.cancelledAt)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{row.deliveryMode || "-"}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {(row.suggestedChannels || []).join(", ") || "-"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {row.source || "-"}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <div>{formatDate(row.createdAt)}</div>
                    <div className="mt-1">{formatDate(row.updatedAt)}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <div>Business: {row.businessId || "-"}</div>
                    <div className="mt-1">Order: {row.orderId || "-"}</div>
                    <div className="mt-1">City: {row.cityId || "-"}</div>
                    <div className="mt-1">Driver: {row.driverId || "-"}</div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                  No notification events found for the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
