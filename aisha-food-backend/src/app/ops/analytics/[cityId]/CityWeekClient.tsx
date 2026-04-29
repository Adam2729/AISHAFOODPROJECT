"use client";

import { useEffect, useMemo, useState } from "react";

type SummaryResponse = {
  ok: boolean;
  city?: {
    cityId: string;
    code: string;
    name: string;
    currency: string;
  };
  weekKey?: string;
  metrics?: {
    ordersTotal: number;
    delivered: number;
    cancelled: number;
    new: number;
    acceptanceRate: number | null;
  };
  finance?: {
    grossSubtotalTotal: number;
    commissionTotal: number;
    deliveryFeeToCustomerTotal: number;
    platformDeliveryMarginTotal: number;
    riderPayoutTotal: number;
    netPlatformFromDelivery: number;
  };
  dispatch?: {
    assignedCount: number;
    unassignedCount: number;
  };
  error?: { message?: string } | string;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

function asNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function money(value: unknown) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function percent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

export default function CityWeekClient({
  adminKey,
  cityId,
  initialWeekKey,
}: {
  adminKey: string;
  cityId: string;
  initialWeekKey: string;
}) {
  const [weekKey, setWeekKey] = useState(initialWeekKey);
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("key", adminKey);
    params.set("cityId", cityId);
    params.set("weekKey", weekKey);
    return params.toString();
  }, [adminKey, cityId, weekKey]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/ops/analytics/city-week?${queryString}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as SummaryResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not load city-week analytics."));
      }
      setData(json);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not load city-week analytics."
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  const currency = data?.city?.currency || "";

  return (
    <section className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Week Key</span>
              <input
                value={weekKey}
                onChange={(event) => setWeekKey(event.target.value)}
                placeholder="YYYY-Www"
                className="w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="mt-2 rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:mt-7"
              >
                {loading ? "Loading..." : "Refresh"}
              </button>
              <a
                href={`/api/ops/analytics/city-week/export.csv?${queryString}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 rounded border border-slate-300 px-3 py-2 text-sm sm:mt-7"
              >
                Export this city-week CSV
              </a>
            </div>
          </div>
          {data?.city ? (
            <div className="text-sm text-slate-600">
              <div className="font-semibold text-slate-800">{data.city.name}</div>
              <div className="text-xs text-slate-500">{data.city.code}</div>
            </div>
          ) : null}
        </div>
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-lg font-semibold">Metrics</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Metric label="Orders" value={asNumber(data?.metrics?.ordersTotal)} />
            <Metric label="Delivered" value={asNumber(data?.metrics?.delivered)} />
            <Metric label="Cancelled" value={asNumber(data?.metrics?.cancelled)} />
            <Metric label="New" value={asNumber(data?.metrics?.new)} />
            <Metric label="Acceptance Rate" value={percent(data?.metrics?.acceptanceRate)} />
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-lg font-semibold">Finance</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Metric label="Gross Subtotal" value={money(data?.finance?.grossSubtotalTotal)} suffix={currency} />
            <Metric label="Commission" value={money(data?.finance?.commissionTotal)} suffix={currency} />
            <Metric
              label="Delivery Fee To Customer"
              value={money(data?.finance?.deliveryFeeToCustomerTotal)}
              suffix={currency}
            />
            <Metric
              label="Platform Delivery Margin"
              value={money(data?.finance?.platformDeliveryMarginTotal)}
              suffix={currency}
            />
            <Metric label="Rider Payout" value={money(data?.finance?.riderPayoutTotal)} suffix={currency} />
            <Metric
              label="Net Platform From Delivery"
              value={money(data?.finance?.netPlatformFromDelivery)}
              suffix={currency}
            />
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-lg font-semibold">Dispatch</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Metric label="Assigned" value={asNumber(data?.dispatch?.assignedCount)} />
            <Metric label="Unassigned" value={asNumber(data?.dispatch?.unassignedCount)} />
          </div>
        </article>
      </section>
    </section>
  );
}

function Metric({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string | number;
  suffix?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-base font-semibold text-slate-900">
        {value}
        {suffix ? <span className="ml-1 text-xs text-slate-500">{suffix}</span> : null}
      </p>
    </div>
  );
}
