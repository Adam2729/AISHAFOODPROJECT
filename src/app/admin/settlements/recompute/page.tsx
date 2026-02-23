import Link from "next/link";
import { headers } from "next/headers";

type SearchParams = Record<string, string | string[] | undefined>;

type RecomputeResponse = {
  ok: boolean;
  businessId?: string;
  weekKey?: string;
  locked?: boolean;
  storedExists?: boolean;
  expected?: {
    ordersCount: number;
    grossSubtotal: number;
    feeTotal: number;
  };
  stored?: {
    ordersCount: number;
    grossSubtotal: number;
    feeTotal: number;
  } | null;
  diff?: {
    ordersCount: number;
    grossSubtotal: number;
    feeTotal: number;
  };
  mismatch?: boolean;
  computedAt?: string;
  error?: { message?: string } | string;
};

function normalizeSingle(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function money(value: number | undefined | null) {
  return new Intl.NumberFormat("es-DO", {
    style: "currency",
    currency: "DOP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function shortDate(value: string | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "short", timeStyle: "short" }).format(d);
}

async function fetchRecompute(baseUrl: string, key: string, businessId: string, weekKey: string) {
  const res = await fetch(`${baseUrl}/api/admin/settlements/recompute?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ businessId, weekKey }),
  });
  const json = (await res.json().catch(() => null)) as RecomputeResponse | null;
  if (!res.ok || !json?.ok) {
    const message =
      (typeof json?.error === "string" ? json.error : json?.error?.message) || `HTTP ${res.status}`;
    return { ok: false, error: message, data: null as RecomputeResponse | null };
  }
  return { ok: true, error: "", data: json };
}

export default async function AdminSettlementRecomputePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const key = normalizeSingle(params.key).trim();
  const businessId = normalizeSingle(params.businessId).trim();
  const weekKey = normalizeSingle(params.weekKey).trim();

  if (!key) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Settlement Recompute</h1>
        <p className="mt-2 text-sm text-red-600">
          Unauthorized. Usa la URL con <code>?key=ADMIN_KEY</code>.
        </p>
      </main>
    );
  }

  if (!businessId || !weekKey) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Settlement Recompute</h1>
        <p className="mt-2 text-sm text-red-600">businessId y weekKey son requeridos.</p>
        <Link href={`/admin/settlements?key=${encodeURIComponent(key)}`} className="mt-3 inline-block text-sm underline">
          Volver a settlements
        </Link>
      </main>
    );
  }

  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") || hdrs.get("host") || "localhost:3000";
  const forwardedProto = hdrs.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol =
    forwardedProto || (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");
  const baseUrl = `${protocol}://${host}`;

  const report = await fetchRecompute(baseUrl, key, businessId, weekKey);
  if (!report.ok || !report.data) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Settlement Recompute</h1>
        <p className="mt-2 text-sm text-red-600">{report.error || "Failed to recompute settlement."}</p>
        <Link href={`/admin/settlements?key=${encodeURIComponent(key)}`} className="mt-3 inline-block text-sm underline">
          Volver a settlements
        </Link>
      </main>
    );
  }

  const data = report.data;
  const expected = data.expected || { ordersCount: 0, grossSubtotal: 0, feeTotal: 0 };
  const stored = data.stored;
  const diff = data.diff || { ordersCount: 0, grossSubtotal: 0, feeTotal: 0 };
  const mismatch = Boolean(data.mismatch);
  const locked = Boolean(data.locked);

  return (
    <main className="mx-auto min-h-screen max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settlement Recompute</h1>
          <p className="text-sm text-slate-600">
            Business: <span className="font-mono">{businessId}</span> | Week: <span className="font-mono">{weekKey}</span>
          </p>
        </div>
        <Link href={`/admin/settlements?key=${encodeURIComponent(key)}`} className="rounded-lg border px-3 py-2 text-sm">
          Back to Settlements
        </Link>
      </div>

      {locked ? (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Settlement is locked. Recompute is read-only.
        </div>
      ) : null}
      {mismatch ? (
        <div className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          Mismatch detected between stored and expected totals.
        </div>
      ) : (
        <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          No mismatch detected.
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-2">Metric</th>
              <th className="pb-2">Expected</th>
              <th className="pb-2">Stored</th>
              <th className="pb-2">Diff</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-100">
              <td className="py-2">Orders Count</td>
              <td className="py-2">{expected.ordersCount}</td>
              <td className="py-2">{stored ? stored.ordersCount : "-"}</td>
              <td className="py-2">{diff.ordersCount}</td>
            </tr>
            <tr className="border-t border-slate-100">
              <td className="py-2">Gross Subtotal</td>
              <td className="py-2">{money(expected.grossSubtotal)}</td>
              <td className="py-2">{stored ? money(stored.grossSubtotal) : "-"}</td>
              <td className="py-2">{money(diff.grossSubtotal)}</td>
            </tr>
            <tr className="border-t border-slate-100">
              <td className="py-2">Fee Total</td>
              <td className="py-2">{money(expected.feeTotal)}</td>
              <td className="py-2">{stored ? money(stored.feeTotal) : "-"}</td>
              <td className="py-2">{money(diff.feeTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Stored exists: {data.storedExists ? "yes" : "no"} | Computed at: {shortDate(data.computedAt)}
      </p>
    </main>
  );
}
