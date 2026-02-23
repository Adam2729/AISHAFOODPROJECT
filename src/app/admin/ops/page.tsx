import Link from "next/link";
import { headers } from "next/headers";
import { getWeekKey } from "@/lib/geo";
import { getBoolSetting, getNumberSetting, getStringSetting } from "@/lib/appSettings";
import { parseAllowlist } from "@/lib/pilot";
import MaintenanceToggle from "./MaintenanceToggle";
import AtRiskMerchantsTable from "./AtRiskMerchantsTable";
import PilotModeControls from "./PilotModeControls";
import SlaControls from "./SlaControls";

type SearchParams = Record<string, string | string[] | undefined>;

type MaintenanceResponse = {
  ok: boolean;
  maintenanceMode?: boolean;
  source?: "env" | "db" | "env+db" | string;
  error?: { message?: string } | string;
};

type MetricsResponse = {
  ok: boolean;
  weekKey?: string;
  kpis?: {
    ordersToday?: number;
    commissionToday?: number;
    ordersThisWeek?: number;
    feeThisWeek?: number;
  };
  error?: { message?: string } | string;
};

type SettlementAuditEvent = {
  _id?: string;
  action?: string;
  businessId?: string | { $oid?: string } | null;
  weekKey?: string;
  amount?: number | null;
  createdAt?: string | Date;
};

type SettlementAuditResponse = {
  ok: boolean;
  events?: SettlementAuditEvent[];
  error?: { message?: string } | string;
};

type BusinessAuditEvent = {
  _id?: string;
  action?: string;
  businessId?: string | { $oid?: string } | null;
  meta?: Record<string, unknown>;
  createdAt?: string | Date;
};

type BusinessAuditResponse = {
  ok: boolean;
  events?: BusinessAuditEvent[];
  error?: { message?: string } | string;
};

type AtRiskBusiness = {
  id: string;
  name: string;
  paused: boolean;
  pausedReason?: string;
  health?: {
    complaintsCount?: number;
    cancelsCount30d?: number;
    slowAcceptCount30d?: number;
  };
};

type AtRiskResponse = {
  ok: boolean;
  businesses?: AtRiskBusiness[];
  error?: { message?: string } | string;
};

function normalizeSingle(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat("es-DO", {
    style: "currency",
    currency: "DOP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatDateTime(value: string | Date | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function normalizeId(value: string | { $oid?: string } | null | undefined) {
  if (!value) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "object" && typeof value.$oid === "string") return value.$oid;
  return String(value);
}

function shortId(value: string) {
  if (!value || value === "-") return "-";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

async function fetchJson<T>(url: string): Promise<{ ok: boolean; data: T | null; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const json = (await res.json().catch(() => null)) as
      | (T & { ok?: boolean; error?: { message?: string } | string })
      | null;
    if (!res.ok || !json?.ok) {
      const message =
        (typeof json?.error === "string" ? json.error : json?.error?.message) || `HTTP ${res.status}`;
      return { ok: false, data: null, error: message };
    }
    return { ok: true, data: json, error: "" };
  } catch (error: unknown) {
    return {
      ok: false,
      data: null,
      error: error instanceof Error ? error.message : "Request failed",
    };
  }
}

export default async function AdminOpsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const key = normalizeSingle(params.key).trim();

  if (!key) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Ops Center</h1>
        <p className="mt-2 text-sm text-red-600">
          Unauthorized. Usa la URL con <code>?key=ADMIN_KEY</code>.
        </p>
      </main>
    );
  }

  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") || hdrs.get("host") || "localhost:3000";
  const forwardedProto = hdrs.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol =
    forwardedProto || (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");
  const baseUrl = `${protocol}://${host}`;
  const now = new Date();

  const [maintenanceReq, metricsReq, settlementAuditReq, businessAuditReq, atRiskReq] =
    await Promise.all([
      fetchJson<MaintenanceResponse>(
        `${baseUrl}/api/admin/maintenance?key=${encodeURIComponent(key)}`
      ),
      fetchJson<MetricsResponse>(`${baseUrl}/api/admin/metrics?key=${encodeURIComponent(key)}`),
      fetchJson<SettlementAuditResponse>(
        `${baseUrl}/api/admin/audit?key=${encodeURIComponent(key)}&limit=5`
      ),
      fetchJson<BusinessAuditResponse>(
        `${baseUrl}/api/admin/businesses/audit?key=${encodeURIComponent(key)}&limit=5`
      ),
      fetchJson<AtRiskResponse>(
        `${baseUrl}/api/admin/businesses/at-risk?key=${encodeURIComponent(key)}&limit=10`
      ),
    ]);

  const maintenanceMode = Boolean(maintenanceReq.data?.maintenanceMode);
  const source = String(maintenanceReq.data?.source || "db");
  const kpis = metricsReq.data?.kpis;
  const weekKey = String(metricsReq.data?.weekKey || getWeekKey(now));
  const settlementAudits = settlementAuditReq.data?.events || [];
  const businessAudits = businessAuditReq.data?.events || [];
  const atRiskBusinesses = atRiskReq.data?.businesses || [];
  const [pilotMode, pilotAllowlistEnabled, pilotAllowlistRaw] = await Promise.all([
    getBoolSetting("pilot_mode", false),
    getBoolSetting("pilot_allowlist_enabled", true),
    getStringSetting("pilot_allowlist_phones", ""),
  ]);
  const [slaAutoPauseEnabled, slaSlowAcceptThreshold, slaCancelThreshold] = await Promise.all([
    getBoolSetting("sla_auto_pause_enabled", false),
    getNumberSetting("sla_slow_accept_threshold", 10),
    getNumberSetting("sla_cancel_threshold", 10),
  ]);
  const pilotAllowlistSize = parseAllowlist(pilotAllowlistRaw).size;

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Ops Center</h1>
          <p className="text-sm text-slate-600">Production controls</p>
          <p className="mt-1 text-xs text-slate-500">Server time: {formatDateTime(now)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/api/health"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Health
          </a>
          <Link
            href={`/admin/settlements?key=${encodeURIComponent(key)}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Settlements
          </Link>
          <Link
            href={`/admin?key=${encodeURIComponent(key)}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Dashboard
          </Link>
        </div>
      </header>

      <section className="mt-5 grid gap-4 lg:grid-cols-4">
        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Maintenance Mode</p>
          <p className={`mt-1 text-xl font-bold ${maintenanceMode ? "text-red-700" : "text-emerald-700"}`}>
            {maintenanceMode ? "ON" : "OFF"}
          </p>
          <p className="mt-1 text-sm text-slate-600">Source: {source}</p>
          <MaintenanceToggle adminKey={key} maintenanceMode={maintenanceMode} source={source} />
          {source === "env" || source === "env+db" ? (
            <p className="mt-2 text-xs text-amber-700">Env forces maintenance ON</p>
          ) : null}
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Pilot Mode</p>
          <p className={`mt-1 text-xl font-bold ${pilotMode ? "text-amber-700" : "text-emerald-700"}`}>
            {pilotMode ? "ON" : "OFF"}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Allowlist enforcement: {pilotAllowlistEnabled ? "ON" : "OFF"}
          </p>
          <p className="text-sm text-slate-600">Allowlist size: {pilotAllowlistSize}</p>
          <PilotModeControls
            adminKey={key}
            pilotMode={pilotMode}
            allowlistEnabled={pilotAllowlistEnabled}
            allowlistSize={pilotAllowlistSize}
            allowlistRaw={pilotAllowlistRaw}
          />
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Quick Exports</p>
          <p className="mt-1 text-sm text-slate-700">Week: {weekKey}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={`/api/admin/settlements/export?key=${encodeURIComponent(key)}&weekKey=${encodeURIComponent(
                weekKey
              )}`}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            >
              Export This Week CSV
            </a>
            <a
              href={`/api/admin/audit?key=${encodeURIComponent(key)}&limit=50`}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
            >
              Settlement audit API
            </a>
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">SLA Auto-Pause</p>
          <p className={`mt-1 text-xl font-bold ${slaAutoPauseEnabled ? "text-amber-700" : "text-emerald-700"}`}>
            {slaAutoPauseEnabled ? "ON" : "OFF"}
          </p>
          <p className="mt-1 text-sm text-slate-600">Slow accept threshold: {slaSlowAcceptThreshold}</p>
          <p className="text-sm text-slate-600">Cancel threshold: {slaCancelThreshold}</p>
          <SlaControls
            adminKey={key}
            autoPauseEnabled={slaAutoPauseEnabled}
            slowAcceptThreshold={slaSlowAcceptThreshold}
            cancelThreshold={slaCancelThreshold}
          />
        </article>
      </section>

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Observability</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`/api/admin/indexes?key=${encodeURIComponent(key)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
          >
            Verify Required Indexes
          </a>
          <a
            href="https://vercel.com/docs/observability/runtime-logs"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
          >
            Request Logs (last 50 in Vercel)
          </a>
          <a
            href="https://vercel.com/docs/cron-jobs/manage-cron-jobs#viewing-logs"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
          >
            Cron Logs
          </a>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Error spikes and Mongo failures are monitored via Vercel runtime logs and alerts.
        </p>
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Orders Today" value={String(Number(kpis?.ordersToday || 0))} />
        <MetricCard label="Commission Today" value={formatMoney(kpis?.commissionToday)} />
        <MetricCard label="Orders This Week" value={String(Number(kpis?.ordersThisWeek || 0))} />
        <MetricCard label="Commission This Week" value={formatMoney(kpis?.feeThisWeek)} />
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-lg font-semibold">Latest Settlement Audits</h2>
          {settlementAuditReq.ok ? null : (
            <p className="mb-3 text-sm text-red-600">{settlementAuditReq.error}</p>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-2">Time</th>
                  <th className="pb-2">Action</th>
                  <th className="pb-2">Business</th>
                  <th className="pb-2">Week</th>
                  <th className="pb-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {settlementAudits.length ? (
                  settlementAudits.map((event, index) => (
                    <tr key={`${String(event._id || "sa")}-${index}`} className="border-t border-slate-100">
                      <td className="py-2">{formatDateTime(event.createdAt)}</td>
                      <td className="py-2">{String(event.action || "-")}</td>
                      <td className="py-2">{shortId(normalizeId(event.businessId))}</td>
                      <td className="py-2">{String(event.weekKey || "-")}</td>
                      <td className="py-2">
                        {event.amount == null ? "-" : formatMoney(event.amount)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-3 text-center text-slate-500">
                      No settlement audits found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-lg font-semibold">Latest Business Audits</h2>
          {businessAuditReq.ok ? null : (
            <p className="mb-3 text-sm text-red-600">{businessAuditReq.error}</p>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-2">Time</th>
                  <th className="pb-2">Action</th>
                  <th className="pb-2">Business</th>
                  <th className="pb-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {businessAudits.length ? (
                  businessAudits.map((event, index) => (
                    <tr key={`${String(event._id || "ba")}-${index}`} className="border-t border-slate-100">
                      <td className="py-2">{formatDateTime(event.createdAt)}</td>
                      <td className="py-2">{String(event.action || "-")}</td>
                      <td className="py-2">{shortId(normalizeId(event.businessId))}</td>
                      <td className="py-2 text-xs text-slate-600">
                        {Object.keys(event.meta || {}).length ? "meta" : "-"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-3 text-center text-slate-500">
                      No business audits found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      {atRiskReq.ok ? null : <p className="mt-4 text-sm text-red-600">{atRiskReq.error}</p>}
      <AtRiskMerchantsTable adminKey={key} businesses={atRiskBusinesses} />
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </article>
  );
}
