"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAdminLaunchMarket } from "./useAdminLaunchMarket";
import { formatMoneyForProfile } from "@/lib/marketFormatting";

type MetricsResponse = {
  ok?: boolean;
  weekKey?: string;
  kpis?: {
    businessesActive?: number;
    ordersToday?: number;
    ordersThisWeek?: number;
    commissionToday?: number;
    feeThisWeek?: number;
    ordersWeeklyGrowthPct?: number;
    commissionWeeklyGrowthPct?: number;
    activeBusinesses?: number;
    churnedBusinesses?: number;
    repeatCustomerRate?: number;
    todayUniqueCustomers?: number;
    weekUniqueCustomers?: number;
    weekRepeatCustomers?: number;
    weekRepeatRate?: number;
    weekPromoOrders?: number;
    weekPromoDiscountTotal?: number;
    weekNetSubtotal?: number;
    weekCommissionTotal?: number;
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
};

type LaunchContextResponse = {
  ok?: boolean;
  city?: {
    id?: string;
    code?: string;
    name?: string;
    country?: string;
  } | null;
  readiness?: {
    nodeEnv?: string;
    runtimeStage?: string;
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
    devLocationBypassUnsafeInProduction?: boolean;
    deliveryModesSupported?: string[];
  } | null;
  warnings?: string[];
  error?: { message?: string } | string;
};

function pickError(input: unknown, fallback: string) {
  if (typeof input === "string" && input.trim()) return input;
  if (
    input &&
    typeof input === "object" &&
    "message" in input &&
    typeof (input as { message?: unknown }).message === "string"
  ) {
    return String((input as { message: string }).message);
  }
  return fallback;
}

function formatRatioPct(value: number | null | undefined) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function formatGrowthPct(value: number | null | undefined) {
  const safe = Number(value || 0);
  return `${safe > 0 ? "+" : ""}${safe.toFixed(2)}%`;
}

function growthTone(value: number | null | undefined) {
  const safe = Number(value || 0);
  if (safe > 0) return "emerald";
  if (safe < 0) return "rose";
  return "slate";
}

export default function AdminDashboardPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [launchContext, setLaunchContext] = useState<LaunchContextResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const market = useAdminLaunchMarket(authenticated);

  async function loadDashboard() {
    setRefreshing(true);
    setError("");
    try {
      const [metricsRes, launchRes] = await Promise.all([
        fetch("/api/admin/metrics", { cache: "no-store" }),
        fetch("/api/admin/launch-context", { cache: "no-store" }),
      ]);

      if (metricsRes.status === 401 || launchRes.status === 401) {
        setAuthenticated(false);
        setMetrics(null);
        setLaunchContext(null);
        return;
      }

      const [metricsJson, launchJson] = (await Promise.all([
        metricsRes.json().catch(() => null),
        launchRes.json().catch(() => null),
      ])) as [MetricsResponse | null, LaunchContextResponse | null];

      if (!metricsRes.ok || !metricsJson?.ok) {
        throw new Error(pickError(metricsJson?.error, "Could not load admin metrics."));
      }
      if (!launchRes.ok || !launchJson?.ok) {
        throw new Error(
          pickError(launchJson?.error, "Could not load launch readiness context.")
        );
      }

      setMetrics(metricsJson);
      setLaunchContext(launchJson);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load the admin dashboard."
      );
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const res = await fetch("/api/admin/session", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as AdminSessionResponse | null;
        if (cancelled) return;

        if (!res.ok || !json?.ok || !json.authenticated) {
          setAuthenticated(false);
          setLoading(false);
          return;
        }

        setAuthenticated(true);
      } catch {
        if (cancelled) return;
        setAuthenticated(false);
        setLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    void loadDashboard();
  }, [authenticated]);

  const kpis = metrics?.kpis;
  const readiness = launchContext?.readiness;
  const warnings = launchContext?.warnings || [];
  const supportNumber =
    String(readiness?.supportWhatsApp || market.supportWhatsApp || "").trim() || "Not configured";
  const operations = useMemo(
    () => [
      {
        href: "/admin/merchant-applications",
        title: "Review Merchant Applications",
        description: "Approve or reject incoming restaurant applications.",
        tone: "emerald" as const,
      },
      {
        href: "/admin/driver-applications",
        title: "Review Driver Applications",
        description: "Approve driver signups and issue account access.",
        tone: "amber" as const,
      },
      {
        href: "/admin/drivers",
        title: "Driver Operations",
        description: "Manage approved drivers, login links, and dispatch support.",
        tone: "slate" as const,
      },
      {
        href: "/admin/onboarding",
        title: "Merchant Onboarding",
        description: "Create merchant accounts and complete onboarding setup.",
        tone: "slate" as const,
      },
      {
        href: "/admin/ops",
        title: "Ops Center",
        description: "Review incidents, operational controls, and launch blockers.",
        tone: "slate" as const,
      },
      {
        href: "/admin/promos",
        title: "Manage Promos",
        description: "Adjust budgets, campaigns, and promo behaviour.",
        tone: "slate" as const,
      },
      {
        href: "/admin/ads",
        title: "Sponsored Ads",
        description: "Monitor paid placement controls and campaign surfaces.",
        tone: "slate" as const,
      },
      {
        href: "/admin/incentives",
        title: "Driver Incentives",
        description: "Review bonus structures and incentive levers.",
        tone: "slate" as const,
      },
      {
        href: "/admin/settlements",
        title: "Weekly Settlements",
        description: "Export settlement data and review finance alignment.",
        tone: "slate" as const,
      },
      {
        href: "/api/admin/notification-events",
        title: "Notification Events",
        description: "Inspect outbound merchant, driver, and customer event traffic.",
        tone: "slate" as const,
      },
    ],
    []
  );

  if (loading && authenticated === null) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto flex min-h-screen max-w-7xl items-center px-6 py-12">
          <div className="w-full rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-500">
              AishaFood Admin
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              Loading dashboard
            </h1>
            <p className="mt-3 text-sm text-slate-600">
              Checking the current admin session and loading launch data.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="min-h-screen bg-[linear-gradient(180deg,#fffaf3_0%,#f8fafc_52%,#eef2ff_100%)]">
        <div className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-12">
          <div className="w-full rounded-[32px] border border-slate-200/80 bg-white/95 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">
              Admin Access Required
            </div>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-950">
              Secure admin session required
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
              The dashboard now relies on the secure admin session cookie. Open the access screen,
              enter the admin key once, and return here.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/admin/access?next=/admin"
                className="inline-flex items-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
              >
                Open admin access
              </Link>
              <Link
                href="/"
                className="inline-flex items-center rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
              >
                Back to home
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.16),_transparent_32%),linear-gradient(180deg,#fffaf4_0%,#f8fafc_44%,#eef2ff_100%)]">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[32px] border border-slate-200/70 bg-white/90 shadow-[0_24px_80px_rgba(15,23,42,0.10)] backdrop-blur">
          <div className="border-b border-slate-200/80 bg-[linear-gradient(135deg,#fff7ed_0%,#ffffff_48%,#eff6ff_100%)] px-6 py-7 sm:px-8">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex rounded-full border border-amber-200 bg-white/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-700">
                  Marketplace Control Panel
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                  AishaFood Admin
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                  Monitor launch readiness, commercial performance, and operational queues from one
                  place. The data flow is unchanged; this page now presents it with clearer
                  hierarchy and cleaner decision surfaces.
                </p>

                <div className="mt-5 flex flex-wrap gap-2">
                  <StatusPill
                    label={`Runtime ${String(readiness?.runtimeStage || "unknown")}`}
                    tone={
                      readiness?.runtimeStage === "production"
                        ? "slate"
                        : readiness?.runtimeStage === "preview"
                          ? "amber"
                          : "emerald"
                    }
                  />
                  <StatusPill
                    label={`Launch city ${launchContext?.city?.code || "N/A"}`}
                    tone="slate"
                  />
                  <StatusPill
                    label={`${warnings.length} launch warning${warnings.length === 1 ? "" : "s"}`}
                    tone={warnings.length ? "amber" : "emerald"}
                  />
                  <StatusPill
                    label={readiness?.supportWhatsAppConfigured ? "Support configured" : "Support missing"}
                    tone={readiness?.supportWhatsAppConfigured ? "emerald" : "amber"}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:w-[360px]">
                <div className="rounded-3xl border border-slate-200 bg-white/85 p-4 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                    Market
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">
                    {launchContext?.city?.name || "Unknown city"}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {launchContext?.city?.country || market.countryName}
                  </p>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-950 p-4 text-white shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-300">
                    Support WhatsApp
                  </p>
                  <p className="mt-2 text-2xl font-semibold">{supportNumber}</p>
                  <p className="mt-1 text-sm text-slate-300">
                    {readiness?.supportWhatsAppConfigured
                      ? "Live support contact configured."
                      : "Needs final production support contact."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadDashboard()}
                  disabled={refreshing}
                  className="inline-flex items-center justify-center rounded-2xl bg-[#ff6b00] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e85f00] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {refreshing ? "Refreshing..." : "Refresh dashboard"}
                </button>
                <Link
                  href="/restaurants"
                  className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
                >
                  Open public catalog
                </Link>
              </div>
            </div>

            {error ? (
              <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}
          </div>

          <div className="px-6 py-6 sm:px-8">
            <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <SectionHeading
                eyebrow="Launch readiness"
                title="Current production snapshot"
                description="Configuration, market alignment, and safety flags for the live operational environment."
              />

              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <DashboardStatCard
                  title="Launch city"
                  value={`${launchContext?.city?.name || "Unknown"} (${readiness?.launchCityCode || "N/A"})`}
                  support={launchContext?.city?.country || "No market country configured"}
                />
                <DashboardStatCard
                  title="Runtime"
                  value={String(readiness?.runtimeStage || "unknown")}
                  support={`Node env: ${String(readiness?.nodeEnv || "unknown")}`}
                />
                <DashboardStatCard
                  title="Support WhatsApp"
                  value={supportNumber}
                  support={
                    readiness?.supportWhatsAppConfigured
                      ? "Configured and ready for customer support."
                      : "Missing or placeholder contact."
                  }
                  tone={readiness?.supportWhatsAppConfigured ? "emerald" : "amber"}
                />
                <DashboardStatCard
                  title="Public API"
                  value={
                    readiness?.publicApiBaseUrlConfigured && !readiness?.publicApiBaseUrlLooksPlaceholder
                      ? "Configured"
                      : "Not configured"
                  }
                  support={String(readiness?.publicApiBaseUrl || "Missing or placeholder host")}
                  tone={
                    readiness?.publicApiBaseUrlConfigured && !readiness?.publicApiBaseUrlLooksPlaceholder
                      ? "emerald"
                      : "amber"
                  }
                />
                <DashboardStatCard
                  title="Delivery models"
                  value={String(readiness?.deliveryModesSupported?.join(", ") || "Not configured")}
                  support="Driver app remains platform_driver only."
                />
                <DashboardStatCard
                  title="Infra checks"
                  value={`${readiness?.googleMapsConfigured ? "Maps OK" : "Maps missing"} / ${readiness?.cronConfigured ? "Cron OK" : "Cron missing"}`}
                  support="Maps and cron secrets are required for full production readiness."
                  tone={
                    readiness?.googleMapsConfigured && readiness?.cronConfigured
                      ? "emerald"
                      : "amber"
                  }
                />
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-600">
                    Config flags
                  </h3>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <ConfigItem
                      label="Allowed origins"
                      value={
                        readiness?.publicApiAllowedOriginsConfigured
                          ? readiness?.publicApiAllowedOrigins?.join(", ") || "Configured"
                          : "Not configured"
                      }
                      tone={readiness?.publicApiAllowedOriginsConfigured ? "emerald" : "amber"}
                    />
                    <ConfigItem
                      label="Bamako enabled"
                      value={readiness?.bamakoEnabled ? "Yes" : "No"}
                      tone={readiness?.bamakoEnabled ? "emerald" : "slate"}
                    />
                    <ConfigItem
                      label="Seed mode"
                      value={readiness?.allowSeedEnabled ? "Enabled" : "Disabled"}
                      tone={readiness?.allowSeedEnabled ? "amber" : "emerald"}
                    />
                    <ConfigItem
                      label="Dev location bypass"
                      value={readiness?.devLocationBypassEnabled ? "Enabled" : "Disabled"}
                      tone={readiness?.devLocationBypassEnabled ? "amber" : "emerald"}
                    />
                  </div>
                </div>

                <div
                  className={`rounded-3xl border p-4 ${
                    warnings.length
                      ? "border-amber-300 bg-amber-50/70"
                      : "border-emerald-200 bg-emerald-50/70"
                  }`}
                >
                  <h3
                    className={`text-sm font-semibold uppercase tracking-[0.18em] ${
                      warnings.length ? "text-amber-800" : "text-emerald-800"
                    }`}
                  >
                    {warnings.length ? "Launch warnings" : "Launch status"}
                  </h3>
                  {warnings.length ? (
                    <ul className="mt-4 space-y-2 text-sm leading-6 text-amber-900">
                      {warnings.map((warning) => (
                        <li key={warning} className="flex gap-2">
                          <span className="mt-[0.45rem] h-1.5 w-1.5 rounded-full bg-amber-500" />
                          <span>{warning}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-4 text-sm leading-6 text-emerald-900">
                      No launch blockers detected in the current snapshot. Continue to monitor API
                      origin, maps, and support contact configuration before scaling traffic.
                    </p>
                  )}
                </div>
              </div>
            </section>

            {kpis ? (
              <>
                <section className="mt-6">
                  <SectionHeading
                    eyebrow="Performance"
                    title="Commercial and operational KPIs"
                    description="Daily, weekly, and retention metrics formatted for the current launch market."
                  />

                  <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <DashboardStatCard
                      title="Active businesses"
                      value={kpis.businessesActive || 0}
                      support={`${kpis.activeBusinesses || 0} transacting in the last 30 days`}
                    />
                    <DashboardStatCard
                      title="Orders today"
                      value={kpis.ordersToday || 0}
                      support={`${kpis.todayUniqueCustomers || 0} unique customers today`}
                    />
                    <DashboardStatCard
                      title="Commission today"
                      value={formatMoneyForProfile(kpis.commissionToday || 0, market)}
                      support="Live commission accumulated from delivered orders."
                    />
                    <DashboardStatCard
                      title="Fee this week"
                      value={formatMoneyForProfile(kpis.feeThisWeek || 0, market)}
                      support={`Week key ${metrics?.weekKey || "N/A"}`}
                    />
                    <DashboardStatCard
                      title="Orders this week"
                      value={kpis.ordersThisWeek || 0}
                      support={`${kpis.weekUniqueCustomers || 0} unique ordering customers`}
                    />
                    <DashboardStatCard
                      title="Weekly orders growth"
                      value={formatGrowthPct(kpis.ordersWeeklyGrowthPct)}
                      support="Delivered orders versus the previous week."
                      tone={growthTone(kpis.ordersWeeklyGrowthPct)}
                    />
                    <DashboardStatCard
                      title="Weekly fee growth"
                      value={formatGrowthPct(kpis.commissionWeeklyGrowthPct)}
                      support="Commission versus the previous week."
                      tone={growthTone(kpis.commissionWeeklyGrowthPct)}
                    />
                    <DashboardStatCard
                      title="Repeat customer rate"
                      value={formatRatioPct(kpis.repeatCustomerRate)}
                      support={`${kpis.weekRepeatCustomers || 0} repeat customers this week`}
                    />
                    <DashboardStatCard
                      title="Week repeat rate"
                      value={formatRatioPct(kpis.weekRepeatRate)}
                      support="Share of weekly unique customers who ordered at least twice."
                    />
                    <DashboardStatCard
                      title="Week promo orders"
                      value={kpis.weekPromoOrders || 0}
                      support="Delivered orders with promo-funded discounts."
                    />
                    <DashboardStatCard
                      title="Week promo discounts"
                      value={formatMoneyForProfile(kpis.weekPromoDiscountTotal || 0, market)}
                      support="Total promo discount spend this week."
                    />
                    <DashboardStatCard
                      title="Net subtotal this week"
                      value={formatMoneyForProfile(kpis.weekNetSubtotal || 0, market)}
                      support={`${kpis.churnedBusinesses || 0} churned businesses in the same window`}
                    />
                  </div>
                </section>

                <section className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                  <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                    <SectionHeading
                      eyebrow="Trend"
                      title="Weekly growth"
                      description="Quick read on week-over-week order and commission momentum."
                    />
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <GrowthBar
                        label="Orders vs last week"
                        value={Number(kpis.ordersWeeklyGrowthPct || 0)}
                      />
                      <GrowthBar
                        label="Commission vs last week"
                        value={Number(kpis.commissionWeeklyGrowthPct || 0)}
                      />
                    </div>
                  </div>
                  <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                    <SectionHeading
                      eyebrow="Promos"
                      title="Promo controls snapshot"
                      description="Budget state for the current reporting week."
                    />
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <DashboardStatCard
                        title="Promos enabled"
                        value={kpis.promosEnabled ? "ON" : "OFF"}
                        support="Global promo policy switch."
                        tone={kpis.promosEnabled ? "emerald" : "slate"}
                      />
                      <DashboardStatCard
                        title="Budget weekly"
                        value={formatMoneyForProfile(kpis.promoBudgetWeeklyRdp || 0, market)}
                        support="Configured weekly promo cap."
                      />
                      <DashboardStatCard
                        title="Spent this week"
                        value={formatMoneyForProfile(kpis.promoDiscountSpentThisWeekRdp || 0, market)}
                        support="Consumed promo budget."
                      />
                      <DashboardStatCard
                        title="Budget remaining"
                        value={formatMoneyForProfile(kpis.promoBudgetRemainingThisWeekRdp || 0, market)}
                        support="Remaining spend available."
                      />
                    </div>
                    <div className="mt-5">
                      <Link
                        href="/admin/ops"
                        className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
                      >
                        Open full ops controls
                      </Link>
                    </div>
                  </div>
                </section>
              </>
            ) : null}

            <section className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <SectionHeading
                  eyebrow="Operations"
                  title="Admin workspace"
                  description="Direct entry points for onboarding, operations, drivers, promos, finance, and event inspection."
                />
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {operations.map((action) => (
                    <ActionTile
                      key={action.href}
                      href={action.href}
                      title={action.title}
                      description={action.description}
                      tone={action.tone}
                    />
                  ))}
                  {metrics?.weekKey ? (
                    <ActionTile
                      href={`/api/admin/settlements/export?weekKey=${encodeURIComponent(metrics.weekKey)}`}
                      title={`Export CSV (${metrics.weekKey})`}
                      description="Download the settlement export for the current reporting week."
                      tone="slate"
                    />
                  ) : null}
                </div>
              </div>

              <div className="grid gap-4">
                <div className="rounded-[28px] border border-emerald-200 bg-emerald-50/80 p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">
                    Merchant approval queue
                  </p>
                  <h3 className="mt-3 text-xl font-semibold text-slate-950">
                    Clear merchant onboarding path
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-slate-700">
                    Review incoming merchant registrations in a focused approval panel before
                    creating the business account.
                  </p>
                  <Link
                    href="/admin/merchant-applications"
                    className="mt-5 inline-flex items-center rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-100"
                  >
                    Review merchant applications
                  </Link>
                </div>

                <div className="rounded-[28px] border border-amber-200 bg-amber-50/80 p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">
                    Driver operations
                  </p>
                  <h3 className="mt-3 text-xl font-semibold text-slate-950">
                    Approval and dispatch tools
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-slate-700">
                    Approve driver applications, activate accounts, and manage login links without
                    exposing raw operational tokens on the dashboard.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link
                      href="/admin/drivers"
                      className="inline-flex items-center rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-amber-800 shadow-sm transition hover:bg-amber-100"
                    >
                      Open driver operations
                    </Link>
                    <Link
                      href="/admin/driver-applications"
                      className="inline-flex items-center rounded-2xl border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
                    >
                      Review driver applications
                    </Link>
                  </div>
                </div>
              </div>
            </section>

            {metrics?.topBusinesses?.length ? (
              <section className="mt-6 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <SectionHeading
                  eyebrow="Commercial leaders"
                  title={`Top businesses${metrics.weekKey ? ` for ${metrics.weekKey}` : ""}`}
                  description="Highest-volume delivered businesses in the current reporting window."
                />
                <div className="mt-5 grid gap-3">
                  {metrics.topBusinesses.map((business, index) => (
                    <div
                      key={business.businessId}
                      className="grid gap-3 rounded-3xl border border-slate-200 bg-slate-50/60 p-4 lg:grid-cols-[auto_1fr_auto_auto_auto] lg:items-center"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-sm font-semibold text-white">
                        {index + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-slate-950">
                          {business.name}
                        </p>
                        <p className="text-sm text-slate-600">
                          Business ID {business.businessId}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                          Orders
                        </p>
                        <p className="mt-1 text-lg font-semibold text-slate-950">
                          {business.orders}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                          Subtotal
                        </p>
                        <p className="mt-1 text-lg font-semibold text-slate-950">
                          {formatMoneyForProfile(business.subtotal, market)}
                        </p>
                      </div>
                      {metrics.weekKey ? (
                        <a
                          href={`/admin/audit?businessId=${encodeURIComponent(business.businessId)}&weekKey=${encodeURIComponent(metrics.weekKey)}&limit=100`}
                          className="inline-flex items-center justify-center rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-white"
                        >
                          Audit week
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "emerald" | "amber" | "rose" | "slate";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : tone === "rose"
          ? "border-rose-200 bg-rose-50 text-rose-800"
          : "border-slate-200 bg-white text-slate-700";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${toneClass}`}
    >
      {label}
    </span>
  );
}

function DashboardStatCard({
  title,
  value,
  support,
  tone = "slate",
}: {
  title: string;
  value: string | number;
  support: string;
  tone?: "emerald" | "amber" | "rose" | "slate";
}) {
  const accentClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50/50"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50/50"
        : tone === "rose"
          ? "border-rose-200 bg-rose-50/50"
          : "border-slate-200 bg-white";

  return (
    <article className={`rounded-3xl border p-4 shadow-sm ${accentClass}`}>
      <p className="text-sm font-medium text-slate-500">{title}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{support}</p>
    </article>
  );
}

function ConfigItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "amber" | "slate";
}) {
  const toneClass =
    tone === "emerald"
      ? "bg-emerald-100 text-emerald-800"
      : tone === "amber"
        ? "bg-amber-100 text-amber-800"
        : "bg-slate-200 text-slate-700";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <div className="mt-3 flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-semibold leading-6 text-slate-900">{value}</p>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${toneClass}`}>
          {tone === "emerald" ? "OK" : tone === "amber" ? "Check" : "Info"}
        </span>
      </div>
    </div>
  );
}

function GrowthBar({ label, value }: { label: string; value: number }) {
  const tone = growthTone(value);
  const width = Math.min(Math.abs(value), 100);
  const barClass =
    tone === "emerald" ? "bg-emerald-500" : tone === "rose" ? "bg-rose-500" : "bg-slate-400";
  const textClass =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "rose"
        ? "text-rose-700"
        : "text-slate-700";

  return (
    <article className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-3 text-3xl font-semibold tracking-tight ${textClass}`}>
        {formatGrowthPct(value)}
      </p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-2 rounded-full ${barClass}`} style={{ width: `${width}%` }} />
      </div>
    </article>
  );
}

function ActionTile({
  href,
  title,
  description,
  tone,
}: {
  href: string;
  title: string;
  description: string;
  tone: "emerald" | "amber" | "slate";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/70"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50/70 hover:bg-amber-100/70"
        : "border-slate-200 bg-slate-50/70 hover:bg-slate-100/70";

  return (
    <Link
      href={href}
      className={`group rounded-3xl border p-4 shadow-sm transition ${toneClass}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-950">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
        </div>
        <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition group-hover:border-slate-400">
          Open
        </span>
      </div>
    </Link>
  );
}
