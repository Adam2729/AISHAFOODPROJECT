"use client";

import { useEffect, useMemo, useState } from "react";

type CityRow = {
  _id: string;
  code?: string;
  slug?: string;
  name?: string;
  currency?: string;
};

type CitiesResponse = {
  ok: boolean;
  cities?: CityRow[];
  error?: { message?: string } | string;
};

type MetricsResponse = {
  ok: boolean;
  cityId?: string;
  cityCode?: string;
  weekKey?: string;
  range?: { fromIso?: string; toIso?: string; mode?: "week" | "range" };
  metrics?: {
    ordersTotal?: number;
    ordersDelivered?: number;
    ordersCancelled?: number;
    ordersNew?: number;
    uniqueBusinesses?: number;
    uniqueCustomers?: number;
    avgSubtotal?: number | null;
    avgDeliveryFee?: number | null;
    avgTotal?: number | null;
    otpVerifiedDeliveredCount?: number;
  };
  error?: { message?: string } | string;
};

type FinanceResponse = {
  ok: boolean;
  cityId?: string;
  cityCode?: string;
  weekKey?: string;
  range?: { fromIso?: string; toIso?: string; mode?: "week" | "range" };
  finance?: {
    grossSubtotal?: number;
    commissionTotal?: number;
    deliveryFeesChargedToCustomers?: number;
    riderPayoutTotal?: number;
    platformDeliveryMarginTotal?: number;
    netPlatformTakeApprox?: number;
  };
  error?: { message?: string } | string;
};

type DispatchResponse = {
  ok: boolean;
  cityId?: string;
  cityCode?: string;
  weekKey?: string;
  range?: { fromIso?: string; toIso?: string; mode?: "week" | "range" };
  dispatch?: {
    deliveredCount?: number;
    assignedCount?: number;
    unassignedCount?: number;
    otpVerifiedDeliveredCount?: number;
    avgTimeToAcceptMin?: number | null;
    avgTimeToDeliverMin?: number | null;
  };
  breakdownByStatus?: {
    new?: number;
    accepted?: number;
    preparing?: number;
    out_for_delivery?: number;
    delivered?: number;
    cancelled?: number;
  };
  error?: { message?: string } | string;
};

type TabKey = "metrics" | "finance" | "dispatch";

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

function money(value: unknown) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function asNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function formatMaybe(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toFixed(2);
}

export default function OpsAnalyticsClient({
  adminKey,
  initialCityId,
  initialWeekKey,
  initialFrom,
  initialTo,
}: {
  adminKey: string;
  initialCityId: string;
  initialWeekKey: string;
  initialFrom: string;
  initialTo: string;
}) {
  const [tab, setTab] = useState<TabKey>("metrics");
  const [cities, setCities] = useState<CityRow[]>([]);
  const [cityId, setCityId] = useState(initialCityId);
  const [weekKey, setWeekKey] = useState(initialWeekKey);
  const [fromDate, setFromDate] = useState(initialFrom);
  const [toDate, setToDate] = useState(initialTo);
  const [useRange, setUseRange] = useState(Boolean(initialFrom && initialTo));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [finance, setFinance] = useState<FinanceResponse | null>(null);
  const [dispatch, setDispatch] = useState<DispatchResponse | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("key", adminKey);
    if (cityId) params.set("cityId", cityId);
    if (useRange && fromDate && toDate) {
      params.set("from", fromDate);
      params.set("to", toDate);
    } else {
      params.set("weekKey", weekKey);
    }
    return params.toString();
  }, [adminKey, cityId, useRange, fromDate, toDate, weekKey]);

  async function loadCities() {
    const res = await fetch(`/api/admin/cities`, {
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as CitiesResponse | null;
    if (!res.ok || !json?.ok) {
      throw new Error(pickError(json?.error, "Could not load cities."));
    }
    const rows = Array.isArray(json.cities) ? json.cities : [];
    setCities(rows);
    if (!cityId && rows.length) {
      const preferred =
        rows.find((row) => String(row.code || "").toUpperCase() === "BKO") || rows[0];
      setCityId(String(preferred._id || ""));
    }
  }

  async function loadAll() {
    if (!cityId) return;
    setLoading(true);
    setError("");
    try {
      const [metricsRes, financeRes, dispatchRes] = await Promise.all([
        fetch(`/api/ops/analytics/metrics?${queryString}`, { cache: "no-store" }),
        fetch(`/api/ops/analytics/finance?${queryString}`, { cache: "no-store" }),
        fetch(`/api/ops/analytics/dispatch?${queryString}`, { cache: "no-store" }),
      ]);

      const metricsJson = (await metricsRes.json().catch(() => null)) as MetricsResponse | null;
      const financeJson = (await financeRes.json().catch(() => null)) as FinanceResponse | null;
      const dispatchJson = (await dispatchRes.json().catch(() => null)) as DispatchResponse | null;

      if (!metricsRes.ok || !metricsJson?.ok) {
        throw new Error(pickError(metricsJson?.error, "Could not load metrics analytics."));
      }
      if (!financeRes.ok || !financeJson?.ok) {
        throw new Error(pickError(financeJson?.error, "Could not load finance analytics."));
      }
      if (!dispatchRes.ok || !dispatchJson?.ok) {
        throw new Error(pickError(dispatchJson?.error, "Could not load dispatch analytics."));
      }

      setMetrics(metricsJson);
      setFinance(financeJson);
      setDispatch(dispatchJson);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load analytics data."
      );
      setMetrics(null);
      setFinance(null);
      setDispatch(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCities().catch((requestError: unknown) => {
      setError(
        requestError instanceof Error ? requestError.message : "Could not load cities."
      );
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!cityId) return;
    loadAll();
  }, [cityId, weekKey, fromDate, toDate, useRange]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCity = useMemo(
    () => cities.find((city) => String(city._id) === String(cityId)) || null,
    [cities, cityId]
  );

  const dispatchBreakdown = dispatch?.breakdownByStatus || {};

  return (
    <section className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">City</span>
            <select
              value={cityId}
              onChange={(event) => setCityId(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2"
            >
              {cities.map((city) => (
                <option key={city._id} value={city._id}>
                  {String(city.name || "City")} ({String(city.code || city.slug || "CITY").toUpperCase()})
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Week Key</span>
            <input
              value={weekKey}
              onChange={(event) => setWeekKey(event.target.value)}
              placeholder="YYYY-Www"
              disabled={useRange}
              className="w-full rounded border border-slate-300 px-3 py-2 disabled:bg-slate-100"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-slate-600">From</span>
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              disabled={!useRange}
              className="w-full rounded border border-slate-300 px-3 py-2 disabled:bg-slate-100"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-slate-600">To</span>
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              disabled={!useRange}
              className="w-full rounded border border-slate-300 px-3 py-2 disabled:bg-slate-100"
            />
          </label>

          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useRange}
                onChange={(event) => setUseRange(event.target.checked)}
              />
              Use date range
            </label>
            <button
              type="button"
              onClick={loadAll}
              disabled={loading || !cityId}
              className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <TabButton active={tab === "metrics"} onClick={() => setTab("metrics")}>
            Metrics
          </TabButton>
          <TabButton active={tab === "finance"} onClick={() => setTab("finance")}>
            Finance
          </TabButton>
          <TabButton active={tab === "dispatch"} onClick={() => setTab("dispatch")}>
            Dispatch
          </TabButton>
          <a
            href={`/api/ops/analytics/${tab}?${queryString}`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto rounded border border-slate-300 px-3 py-1.5 text-sm"
          >
            Export JSON
          </a>
        </div>
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {tab === "metrics" ? (
        <section className="space-y-4">
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard label="Orders Total" value={String(asNumber(metrics?.metrics?.ordersTotal))} />
            <MetricCard
              label="Delivered"
              value={String(asNumber(metrics?.metrics?.ordersDelivered))}
            />
            <MetricCard
              label="Cancelled"
              value={String(asNumber(metrics?.metrics?.ordersCancelled))}
            />
            <MetricCard label="New" value={String(asNumber(metrics?.metrics?.ordersNew))} />
            <MetricCard
              label="OTP Verified Delivered"
              value={String(asNumber(metrics?.metrics?.otpVerifiedDeliveredCount))}
            />
          </section>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard
              label="Unique Businesses"
              value={String(asNumber(metrics?.metrics?.uniqueBusinesses))}
            />
            <MetricCard
              label="Unique Customers"
              value={String(asNumber(metrics?.metrics?.uniqueCustomers))}
            />
            <MetricCard
              label="Avg Subtotal"
              value={formatMaybe(metrics?.metrics?.avgSubtotal)}
            />
            <MetricCard
              label="Avg Delivery Fee"
              value={formatMaybe(metrics?.metrics?.avgDeliveryFee)}
            />
            <MetricCard label="Avg Total" value={formatMaybe(metrics?.metrics?.avgTotal)} />
          </section>
        </section>
      ) : null}

      {tab === "finance" ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            label="Gross Subtotal"
            value={money(finance?.finance?.grossSubtotal)}
            footer={selectedCity?.currency || "-"}
          />
          <MetricCard
            label="Commission Total"
            value={money(finance?.finance?.commissionTotal)}
            footer={selectedCity?.currency || "-"}
          />
          <MetricCard
            label="Delivery Fees Charged"
            value={money(finance?.finance?.deliveryFeesChargedToCustomers)}
            footer={selectedCity?.currency || "-"}
          />
          <MetricCard
            label="Rider Payout Total"
            value={money(finance?.finance?.riderPayoutTotal)}
            footer={selectedCity?.currency || "-"}
          />
          <MetricCard
            label="Platform Delivery Margin"
            value={money(finance?.finance?.platformDeliveryMarginTotal)}
            footer={selectedCity?.currency || "-"}
          />
          <MetricCard
            label="Net Platform Take Approx"
            value={money(finance?.finance?.netPlatformTakeApprox)}
            footer={selectedCity?.currency || "-"}
          />
        </section>
      ) : null}

      {tab === "dispatch" ? (
        <section className="space-y-4">
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              label="Delivered"
              value={String(asNumber(dispatch?.dispatch?.deliveredCount))}
            />
            <MetricCard
              label="Assigned"
              value={String(asNumber(dispatch?.dispatch?.assignedCount))}
            />
            <MetricCard
              label="Unassigned"
              value={String(asNumber(dispatch?.dispatch?.unassignedCount))}
            />
            <MetricCard
              label="OTP Verified Delivered"
              value={String(asNumber(dispatch?.dispatch?.otpVerifiedDeliveredCount))}
            />
            <MetricCard
              label="Avg Time To Accept (min)"
              value={formatMaybe(dispatch?.dispatch?.avgTimeToAcceptMin)}
            />
            <MetricCard
              label="Avg Time To Deliver (min)"
              value={formatMaybe(dispatch?.dispatch?.avgTimeToDeliverMin)}
            />
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-lg font-semibold">Status Breakdown</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-600">
                  <tr>
                    <th className="border-b py-2">Status</th>
                    <th className="border-b py-2">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["new", dispatchBreakdown.new],
                    ["accepted", dispatchBreakdown.accepted],
                    ["preparing", dispatchBreakdown.preparing],
                    ["out_for_delivery", dispatchBreakdown.out_for_delivery],
                    ["delivered", dispatchBreakdown.delivered],
                    ["cancelled", dispatchBreakdown.cancelled],
                  ].map(([status, count]) => (
                    <tr key={status} className="border-b last:border-b-0">
                      <td className="py-2">{status}</td>
                      <td className="py-2">{asNumber(count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      ) : null}
    </section>
  );
}

function MetricCard({
  label,
  value,
  footer,
}: {
  label: string;
  value: string;
  footer?: string;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      {footer ? <p className="mt-1 text-xs text-slate-400">{footer}</p> : null}
    </article>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1.5 text-sm font-semibold ${
        active ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-800"
      }`}
    >
      {children}
    </button>
  );
}
