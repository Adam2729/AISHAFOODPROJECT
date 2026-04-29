"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAdminLaunchMarket } from "@/app/admin/useAdminLaunchMarket";
import { formatMoneyForProfile } from "@/lib/marketFormatting";

type MetricsResponse = {
  ok: boolean;
  weekKey?: string;
  kpis?: {
    businessesActive: number;
    ordersToday: number;
    ordersThisWeek: number;
    commissionToday: number;
    feeThisWeek: number;
    ordersWeeklyGrowthPct: number;
    commissionWeeklyGrowthPct: number;
    activeBusinesses: number;
    churnedBusinesses: number;
    repeatCustomerRate: number;
    todayUniqueCustomers: number;
    weekUniqueCustomers: number;
    weekRepeatCustomers: number;
    weekRepeatRate: number;
    weekPromoOrders: number;
    weekPromoDiscountTotal: number;
    weekNetSubtotal: number;
    weekCommissionTotal: number;
    promosEnabled?: boolean;
    promoBudgetWeeklyRdp?: number;
    promoDiscountSpentThisWeekRdp?: number;
    promoBudgetRemainingThisWeekRdp?: number;
  };
  topBusinesses?: { businessId: string; name: string; orders: number; subtotal: number }[];
  error?: { message?: string } | string;
};

type AdminSessionResponse = {
  ok?: boolean;
  authenticated?: boolean;
  error?: { message?: string } | string;
};

type LaunchContextResponse = {
  ok?: boolean;
  city?: {
    code?: string;
    name?: string;
    country?: string;
  } | null;
  readiness?: {
    nodeEnv?: string;
    productionMode?: boolean;
    launchCityCode?: string;
    bamakoEnabled?: boolean;
    supportWhatsAppConfigured?: boolean;
    supportWhatsApp?: string;
    publicApiBaseUrl?: string | null;
    publicApiBaseUrlConfigured?: boolean;
    publicApiBaseUrlLooksPlaceholder?: boolean;
    publicApiAllowedOrigins?: string[];
    publicApiAllowedOriginsConfigured?: boolean;
    googleMapsConfigured?: boolean;
    cronConfigured?: boolean;
    allowSeedEnabled?: boolean;
    devLocationBypassEnabled?: boolean;
    deliveryModesSupported?: string[];
  } | null;
  warnings?: string[];
  error?: { message?: string } | string;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

export default function AdminDashboardPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [launchContext, setLaunchContext] = useState<LaunchContextResponse | null>(null);
  const [error, setError] = useState("");
  const market = useAdminLaunchMarket(authenticated);
  const formatMoney = (value: number | null | undefined) => formatMoneyForProfile(value, market);

  async function load() {
    setError("");
    const [metricsRes, launchRes] = await Promise.all([
      fetch("/api/admin/metrics", { cache: "no-store" }),
      fetch("/api/admin/launch-context", { cache: "no-store" }),
    ]);
    if (metricsRes.status === 401 || launchRes.status === 401) {
      setAuthenticated(false);
      setData(null);
      setLaunchContext(null);
      return;
    }
    const [json, launchJson] = await Promise.all([
      metricsRes.json().catch(() => null) as Promise<MetricsResponse | null>,
      launchRes.json().catch(() => null) as Promise<LaunchContextResponse | null>,
    ]);
    if (!metricsRes.ok || !json?.ok) {
      setError(pickError(json?.error, "Failed to load admin metrics."));
      return;
    }
    if (launchRes.ok && launchJson?.ok) {
      setLaunchContext(launchJson);
    }
    setData(json);
  }

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const sessionRes = await fetch("/api/admin/session", { cache: "no-store" });
        const sessionJson = (await sessionRes.json().catch(() => null)) as AdminSessionResponse | null;
        const allowed = Boolean(sessionRes.ok && sessionJson?.authenticated);
        if (!mounted) return;
        setAuthenticated(allowed);
        if (!allowed) return;
        await load();
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

  if (authenticated === null) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">AishaFood Admin</h1>
        <p className="mt-2 text-sm text-slate-600">Checking secure admin session...</p>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">AishaFood Admin</h1>
        <p className="mt-2 text-sm text-red-600">
          Admin access requires a secure browser session. Open the access page to continue.
        </p>
        <Link
          href="/admin/access?next=/admin"
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl p-6">
      <h1 className="text-2xl font-bold">AishaFood Admin</h1>
      <p className="text-sm text-slate-600">Local marketplace control panel</p>

      <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <button onClick={load} className="w-fit rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">
          Refresh
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>

      {launchContext?.readiness ? (
        <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Launch Readiness Snapshot</h2>
              <p className="mt-1 text-sm text-slate-600">
                Internal launch context for the current live market configuration.
              </p>
            </div>
            <Link href="/restaurants" className="rounded-lg border px-4 py-2 text-sm font-semibold">
              Open public catalog
            </Link>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Card
              title="Launch City"
              value={`${launchContext.city?.name || "-"} (${launchContext.city?.code || "-"})`}
            />
            <Card
              title="Runtime"
              value={launchContext.readiness.productionMode ? "Production" : String(launchContext.readiness.nodeEnv || "-")}
            />
            <Card
              title="Support WhatsApp"
              value={
                launchContext.readiness.supportWhatsAppConfigured
                  ? String(launchContext.readiness.supportWhatsApp || "configured")
                  : "Not configured"
              }
            />
            <Card
              title="Public API"
              value={String(launchContext.readiness.publicApiBaseUrl || "Not configured")}
            />
            <Card
              title="Delivery Models"
              value={(launchContext.readiness.deliveryModesSupported || []).join(", ") || "-"}
            />
            <Card
              title="Infra Checks"
              value={[
                launchContext.readiness.googleMapsConfigured ? "Maps OK" : "Maps missing",
                launchContext.readiness.cronConfigured ? "Cron OK" : "Cron missing",
              ].join(" / ")}
            />
          </div>

          <div className="mt-3 text-sm text-slate-600">
            <p>Allowed origins: {(launchContext.readiness.publicApiAllowedOrigins || []).join(", ") || "not configured"}</p>
            <p>Bamako enabled: {launchContext.readiness.bamakoEnabled ? "yes" : "no"}</p>
            <p>Seed enabled: {launchContext.readiness.allowSeedEnabled ? "yes" : "no"}</p>
            <p>
              Dev location bypass: {launchContext.readiness.devLocationBypassEnabled ? "enabled" : "off"}
            </p>
          </div>

          {(launchContext.warnings || []).length ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Launch warnings</p>
              <ul className="mt-2 list-disc pl-5">
                {(launchContext.warnings || []).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              Launch config checks look clean for the current market profile.
            </div>
          )}
        </section>
      ) : null}

      {data?.kpis ? (
        <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card title="Active Businesses" value={data.kpis.businessesActive} />
          <Card title="Orders Today" value={data.kpis.ordersToday} />
          <Card title="Commission Today" value={formatMoney(data.kpis.commissionToday)} />
          <Card title="Fee This Week" value={formatMoney(data.kpis.feeThisWeek)} />
          <Card title="Orders This Week" value={data.kpis.ordersThisWeek} />
          <Card title="Weekly Orders Growth" value={`${data.kpis.ordersWeeklyGrowthPct.toFixed(2)}%`} />
          <Card title="Weekly Fee Growth" value={`${data.kpis.commissionWeeklyGrowthPct.toFixed(2)}%`} />
          <Card title="Repeat Customer Rate" value={`${(data.kpis.repeatCustomerRate * 100).toFixed(2)}%`} />
          <Card title="Week Repeat Rate" value={`${(data.kpis.weekRepeatRate * 100).toFixed(2)}%`} />
          <Card title="Week Promo Orders" value={data.kpis.weekPromoOrders} />
          <Card title="Week Promo Discounts" value={formatMoney(data.kpis.weekPromoDiscountTotal)} />
        </section>
      ) : null}

      {data?.kpis ? (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold">Weekly Growth</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <GrowthBar label="Orders vs last week" value={data.kpis.ordersWeeklyGrowthPct} />
            <GrowthBar label="Commission vs last week" value={data.kpis.commissionWeeklyGrowthPct} />
          </div>
        </section>
      ) : null}

      <section className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/admin/merchant-applications"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 font-semibold text-emerald-800"
        >
          Review Merchant Applications
        </Link>
        <Link href="/admin/ops" className="rounded-lg border px-4 py-2">
          Ops Center
        </Link>
        <Link href="/admin/promos" className="rounded-lg border px-4 py-2">
          Manage Promos
        </Link>
        <Link href="/admin/ads" className="rounded-lg border px-4 py-2">
          Sponsored Ads
        </Link>
        <Link href="/admin/incentives" className="rounded-lg border px-4 py-2">
          Driver Incentives
        </Link>
        <Link href="/admin/onboarding" className="rounded-lg border px-4 py-2">
          Merchant Onboarding
        </Link>
        <Link href="/admin/drivers" className="rounded-lg border px-4 py-2">
          Drivers
        </Link>
        <Link href="/admin/settlements" className="rounded-lg border px-4 py-2">
          Weekly Settlements
        </Link>
        <a
          href="/api/admin/notification-events"
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border px-4 py-2"
        >
          Notification Events
        </a>
        {data?.weekKey ? (
          <a
            href={`/api/admin/settlements/export?weekKey=${encodeURIComponent(data.weekKey)}`}
            className="rounded-lg border px-4 py-2"
          >
            Export CSV ({data.weekKey})
          </a>
        ) : null}
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <Link
          href="/admin/merchant-applications"
          className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300"
        >
          <p className="text-sm font-semibold text-slate-950">Merchant approval queue</p>
          <p className="mt-1 text-sm text-slate-600">
            Review business registrations in a clearer panel before creating the merchant business.
          </p>
        </Link>
        <Link
          href="/admin/drivers"
          className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300"
        >
          <p className="text-sm font-semibold text-slate-950">Driver operations</p>
          <p className="mt-1 text-sm text-slate-600">
            Open driver links, payouts, and dispatch support tools from one place.
          </p>
        </Link>
      </section>

      {data?.kpis ? (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold">Promo Controls Snapshot</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card title="Promos Enabled" value={data.kpis.promosEnabled ? "ON" : "OFF"} />
            <Card
              title="Promo Budget Weekly"
              value={formatMoney(data.kpis.promoBudgetWeeklyRdp || 0)}
            />
            <Card
              title="Promo Spent This Week"
              value={formatMoney(data.kpis.promoDiscountSpentThisWeekRdp || 0)}
            />
            <Card
              title="Promo Remaining"
              value={formatMoney(data.kpis.promoBudgetRemainingThisWeekRdp || 0)}
            />
          </div>
          <div className="mt-3">
            <Link
              href="/admin/ops"
              className="inline-flex rounded-lg border px-4 py-2 text-sm font-semibold"
            >
              Open Full Ops Controls
            </Link>
          </div>
        </section>
      ) : null}

      {data?.topBusinesses?.length ? (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold">Top Businesses ({data.weekKey})</h2>
          <div className="mt-3 divide-y divide-slate-100">
            {data.topBusinesses.map((b) => (
              <div key={b.businessId} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                <span>{b.orders} orders</span>
                <span>{formatMoney(b.subtotal)}</span>
                {data.weekKey ? (
                  <a
                    href={`/api/admin/audit?businessId=${encodeURIComponent(
                      b.businessId
                    )}&weekKey=${encodeURIComponent(data.weekKey)}&limit=100`}
                    className="rounded border px-2 py-1 text-xs"
                  >
                    Audit week
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function Card({ title, value }: { title: string; value: string | number }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </article>
  );
}

function GrowthBar({ label, value }: { label: string; value: number }) {
  const abs = Math.min(Math.abs(value), 100);
  const positive = value >= 0;
  return (
    <article className="rounded-lg border border-slate-200 p-3">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${positive ? "text-emerald-700" : "text-red-700"}`}>
        {value.toFixed(2)}%
      </p>
      <div className="mt-2 h-2 rounded bg-slate-100">
        <div
          className={`h-2 rounded ${positive ? "bg-emerald-500" : "bg-red-500"}`}
          style={{ width: `${abs}%` }}
        />
      </div>
    </article>
  );
}
