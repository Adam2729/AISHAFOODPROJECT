import Link from "next/link";
import { getAdminPageContext, pickAdminSearchParam } from "@/lib/adminPageContext";

type SearchParams = Record<string, string | string[] | undefined>;

type SettlementAuditEvent = {
  _id?: string;
  action?: string;
  businessId?: string | { $oid?: string } | null;
  weekKey?: string;
  amount?: number | null;
  createdAt?: string | Date;
  meta?: Record<string, unknown>;
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
  createdAt?: string | Date;
  meta?: Record<string, unknown>;
};

type BusinessAuditResponse = {
  ok: boolean;
  events?: BusinessAuditEvent[];
  error?: { message?: string } | string;
};

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

function formatDateTime(value: string | Date | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat("es-DO", {
    style: "currency",
    currency: "DOP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

async function fetchJson<T>(
  url: string,
  requestHeaders?: HeadersInit
): Promise<{ ok: boolean; data: T | null; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", headers: requestHeaders });
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

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { baseUrl, adminRequestHeaders, hasAdminSession, transitionalAdminKey } =
    await getAdminPageContext(params);

  if (!hasAdminSession && !transitionalAdminKey) {
    return (
      <main className="mx-auto min-h-screen max-w-6xl p-6">
        <h1 className="text-2xl font-bold">Admin Audit</h1>
        <p className="mt-2 text-sm text-red-600">
          Admin audit access requires a secure browser session.
        </p>
        <Link
          href="/admin/access?next=/admin/audit"
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </Link>
      </main>
    );
  }

  const [settlementReq, businessReq] = await Promise.all([
    fetchJson<SettlementAuditResponse>(
      `${baseUrl}/api/admin/audit?limit=50`,
      adminRequestHeaders
    ),
    fetchJson<BusinessAuditResponse>(
      `${baseUrl}/api/admin/businesses/audit?limit=50`,
      adminRequestHeaders
    ),
  ]);

  const settlementEvents = settlementReq.data?.events || [];
  const businessEvents = businessReq.data?.events || [];

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Audit Center</h1>
          <p className="text-sm text-slate-600">Latest settlement and business events</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/ops"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Ops
          </Link>
          <Link
            href="/admin"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Dashboard
          </Link>
        </div>
      </header>

      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-lg font-semibold">Settlement Audit (latest 50)</h2>
          {settlementReq.ok ? null : <p className="mb-3 text-sm text-red-600">{settlementReq.error}</p>}
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
                {settlementEvents.length ? (
                  settlementEvents.map((event, index) => (
                    <tr key={`${String(event._id || "sa")}-${index}`} className="border-t border-slate-100">
                      <td className="py-2">{formatDateTime(event.createdAt)}</td>
                      <td className="py-2">{String(event.action || "-")}</td>
                      <td className="py-2">{shortId(normalizeId(event.businessId))}</td>
                      <td className="py-2">{String(event.weekKey || "-")}</td>
                      <td className="py-2">{event.amount == null ? "-" : formatMoney(event.amount)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-3 text-center text-slate-500">
                      No settlement audit events.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-lg font-semibold">Business Audit (latest 50)</h2>
          {businessReq.ok ? null : <p className="mb-3 text-sm text-red-600">{businessReq.error}</p>}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-2">Time</th>
                  <th className="pb-2">Action</th>
                  <th className="pb-2">Business</th>
                  <th className="pb-2">Meta</th>
                </tr>
              </thead>
              <tbody>
                {businessEvents.length ? (
                  businessEvents.map((event, index) => (
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
                      No business audit events.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </main>
  );
}
