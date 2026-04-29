import Link from "next/link";
import { getAdminPageContext, pickAdminSearchParam } from "@/lib/adminPageContext";
import { getDefaultCity } from "@/lib/city";
import {
  buildMarketFormattingProfile,
  formatDateTimeForProfile,
  formatMoneyForProfile,
} from "@/lib/marketFormatting";
import ResolutionForm from "./ResolutionForm";

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
  integrity?: {
    hasHash?: boolean;
    hashMatches?: boolean | null;
    storedHash?: string | null;
    expectedHash?: string | null;
  };
  computedAt?: string;
  error?: { message?: string } | string;
};

type SettlementListResponse = {
  ok: boolean;
  settlements?: SettlementRow[];
  error?: { message?: string } | string;
};

type ResolutionStatus = "confirmed_correct" | "adjusted" | "merchant_disputed" | "writeoff";

type SettlementRow = {
  businessId?: string;
  weekKey?: string;
  status?: "pending" | "collected" | "locked";
  resolutionStatus?: ResolutionStatus | null;
  resolutionNote?: string | null;
  resolutionAttachmentUrl?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
};

function shortHash(value: string | null | undefined) {
  if (!value) return "-";
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

async function fetchRecompute(
  baseUrl: string,
  requestHeaders: HeadersInit,
  businessId: string,
  weekKey: string
) {
  const res = await fetch(`${baseUrl}/api/admin/settlements/recompute`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...requestHeaders },
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

async function fetchSettlementRow(
  baseUrl: string,
  requestHeaders: HeadersInit,
  businessId: string,
  weekKey: string
) {
  const res = await fetch(
    `${baseUrl}/api/admin/settlements?weekKey=${encodeURIComponent(weekKey)}`,
    { cache: "no-store", headers: requestHeaders }
  );
  const json = (await res.json().catch(() => null)) as SettlementListResponse | null;
  if (!res.ok || !json?.ok) return null;
  const row = (json.settlements || []).find((item) => String(item.businessId || "") === businessId);
  return row || null;
}

export default async function AdminSettlementRecomputePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const market = buildMarketFormattingProfile(await getDefaultCity());
  const { adminRequestHeaders, baseUrl, hasAdminSession, transitionalAdminKey } =
    await getAdminPageContext(params);
  const businessId = pickAdminSearchParam(params.businessId).trim();
  const weekKey = pickAdminSearchParam(params.weekKey).trim();
  const money = (value: number | undefined | null) => formatMoneyForProfile(value, market);
  const shortDate = (value: string | undefined | null) =>
    formatDateTimeForProfile(value || null, market);

  if (!hasAdminSession && !transitionalAdminKey) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Settlement Recompute</h1>
        <p className="mt-2 text-sm text-red-600">
          Settlement recompute requires a secure admin browser session.
        </p>
        <Link
          href="/admin/access?next=/admin/settlements"
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </Link>
      </main>
    );
  }

  if (!businessId || !weekKey) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Settlement Recompute</h1>
        <p className="mt-2 text-sm text-red-600">businessId y weekKey son requeridos.</p>
        <Link href={`/admin/settlements`} className="mt-3 inline-block text-sm underline">
          Volver a settlements
        </Link>
      </main>
    );
  }

  const [report, settlementRow] = await Promise.all([
    fetchRecompute(baseUrl, adminRequestHeaders, businessId, weekKey),
    fetchSettlementRow(baseUrl, adminRequestHeaders, businessId, weekKey),
  ]);
  if (!report.ok || !report.data) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Settlement Recompute</h1>
        <p className="mt-2 text-sm text-red-600">{report.error || "Failed to recompute settlement."}</p>
        <Link href={`/admin/settlements`} className="mt-3 inline-block text-sm underline">
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
  const integrity = data.integrity || { hasHash: false, hashMatches: null, storedHash: null, expectedHash: null };
  const resolutionStatus = settlementRow?.resolutionStatus || null;
  const resolutionNote = settlementRow?.resolutionNote || "";
  const resolutionAttachmentUrl = settlementRow?.resolutionAttachmentUrl || "";
  const resolvedAt = settlementRow?.resolvedAt || null;
  const resolvedBy = settlementRow?.resolvedBy || null;

  return (
    <main className="mx-auto min-h-screen max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settlement Recompute</h1>
          <p className="text-sm text-slate-600">
            Business: <span className="font-mono">{businessId}</span> | Week: <span className="font-mono">{weekKey}</span>
          </p>
        </div>
        <Link href={`/admin/settlements`} className="rounded-lg border px-3 py-2 text-sm">
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

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Integrity</h2>
        <div className="mt-2 grid gap-1 text-sm text-slate-700">
          <span>Has hash: {integrity.hasHash ? "yes" : "no"}</span>
          <span>
            Status:{" "}
            {integrity.hashMatches === null
              ? "not available"
              : integrity.hashMatches
                ? "match"
                : "mismatch"}
          </span>
          <span>Stored hash: <span className="font-mono">{shortHash(integrity.storedHash)}</span></span>
          <span>Expected hash: <span className="font-mono">{shortHash(integrity.expectedHash)}</span></span>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Record Resolution</h2>
        {resolutionStatus ? (
          <div className="mt-3 grid gap-1 text-sm text-slate-700">
            <span className="inline-flex w-fit rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800">
              {resolutionStatus}
            </span>
            <span>Resolved at: {shortDate(resolvedAt || undefined)}</span>
            <span>Resolved by: {resolvedBy || "admin"}</span>
            {resolutionNote ? <span>Note: {resolutionNote.slice(0, 300)}</span> : null}
            {resolutionAttachmentUrl ? (
              <a
                href={resolutionAttachmentUrl}
                target="_blank"
                rel="noreferrer"
                className="text-blue-700 underline"
              >
                Resolution attachment
              </a>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-600">No resolution recorded yet.</p>
        )}

        <div className="mt-4">
          <ResolutionForm
            businessId={businessId}
            weekKey={weekKey}
            existingResolutionStatus={resolutionStatus}
            existingNote={resolutionNote}
            existingAttachmentUrl={resolutionAttachmentUrl}
            existingResolvedBy={resolvedBy || ""}
          />
        </div>
      </section>
    </main>
  );
}
