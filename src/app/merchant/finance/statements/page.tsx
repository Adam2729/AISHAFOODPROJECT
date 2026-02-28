"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type StatementPack = {
  businessId: string;
  businessName: string;
  weekKey: string;
  settlement: {
    status: string;
    grossSubtotal: number;
    feeTotal: number;
    ordersCount: number;
    collectedAt: string | null;
    receiptRef: string | null;
    receiptPhotoUrl: string | null;
    collectorName: string | null;
    collectionMethod: string | null;
    lockedAt: string | null;
    lockedBy: string | null;
    resolutionStatus: string | null;
    resolutionNote: string | null;
    resolutionAttachmentUrl: string | null;
    resolvedAt: string | null;
    resolvedBy: string | null;
  };
  cash: {
    status: string | null;
    reportedCashTotal: number | null;
    verifiedCashTotal: number | null;
    expectedCashTotal: number;
    variance: number;
    lastSubmittedAt: string | null;
    verifiedAt: string | null;
    collectorName: string | null;
    collectionMethod: string | null;
    receiptRef: string | null;
    receiptPhotoUrl: string | null;
  };
  promos: {
    promoOrdersCount: number;
    promoDiscountTotal: number;
  };
  totals: {
    ordersCount: number;
    grossSubtotal: number;
    promoDiscountTotal: number;
    netSubtotal: number;
    commissionTotal: number;
    cashExpected: number;
    cashReported: number | null;
    cashVerified: number | null;
    variance: number;
  };
  integrity: {
    settlementHash: string | null;
    cashCollectionHash: string | null;
    computedAt: string;
  };
};

type ApiResponse = {
  ok?: boolean;
  pack?: StatementPack;
  error?: { message?: string; code?: string } | string;
};

type PdfLinksResponse = {
  ok?: boolean;
  archive?: {
    id: string;
    businessId: string;
    businessName: string;
    weekKey: string;
    version: number;
    generatedAt: string | null;
    generatedBy: string;
    locked: boolean;
    lockedAt: string | null;
    packHash: string;
  };
  links?: {
    pdf: string;
    json: string;
    csvOrders: string;
    csvSummary: string;
  };
  url?: string;
  error?: { message?: string; code?: string } | string;
};

function getWeekKey(dateInput = new Date()) {
  const date = new Date(Date.UTC(dateInput.getUTCFullYear(), dateInput.getUTCMonth(), dateInput.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat("es-DO", {
    style: "currency",
    currency: "DOP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export default function MerchantFinanceStatementsPage() {
  const router = useRouter();
  const [weekKey, setWeekKey] = useState(getWeekKey(new Date()));
  const [pack, setPack] = useState<StatementPack | null>(null);
  const [archive, setArchive] = useState<PdfLinksResponse["archive"] | null>(null);
  const [downloadLinks, setDownloadLinks] = useState<PdfLinksResponse["links"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const statementText = useMemo(() => {
    if (!pack) return "";
    return [
      `Resumen semanal ${pack.weekKey} - ${pack.businessName}`,
      `Pedidos: ${pack.totals.ordersCount}`,
      `Subtotal bruto: ${formatMoney(pack.totals.grossSubtotal)}`,
      `Descuento promo: ${formatMoney(pack.totals.promoDiscountTotal)}`,
      `Subtotal neto: ${formatMoney(pack.totals.netSubtotal)}`,
      `Comision: ${formatMoney(pack.totals.commissionTotal)}`,
      `Efectivo esperado: ${formatMoney(pack.totals.cashExpected)}`,
      `Efectivo verificado: ${formatMoney(pack.totals.cashVerified)}`,
      `Varianza: ${formatMoney(pack.totals.variance)}`,
      `Estado settlement: ${pack.settlement.status}`,
      `Estado cash: ${pack.cash.status || "-"}`,
    ].join("\n");
  }, [pack]);

  async function load(nextWeekKey: string) {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(
        `/api/merchant/statements/weekly?weekKey=${encodeURIComponent(nextWeekKey)}`,
        { cache: "no-store" }
      );
      const json = (await response.json().catch(() => null)) as ApiResponse | null;
      if (!response.ok || !json?.ok || !json.pack) {
        const message =
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          "Could not load weekly statement.";
        setError(message);
        if (response.status === 401) router.push("/merchant/login");
        if (json && typeof json.error !== "string" && json.error?.code === "PIN_CHANGE_REQUIRED") {
          router.push("/merchant/set-pin");
        }
        return;
      }
      setPack(json.pack);
      setWeekKey(json.pack.weekKey || nextWeekKey);
    } catch {
      setError("Could not load weekly statement.");
    } finally {
      setLoading(false);
    }
  }

  async function copySummary() {
    if (!statementText) return;
    try {
      await navigator.clipboard.writeText(statementText);
      setSuccess("Statement summary copied.");
    } catch {
      setError("Could not copy statement summary.");
    }
  }

  async function fetchPdfLinks(action: "link" | "generate") {
    setPdfLoading(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(
        `/api/merchant/statements/pdf?weekKey=${encodeURIComponent(weekKey)}&action=${action}`,
        { cache: "no-store" }
      );
      const json = (await response.json().catch(() => null)) as PdfLinksResponse | null;
      if (!response.ok || !json?.ok || !json.links) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not create statement PDF link."
        );
      }
      setArchive(json.archive || null);
      setDownloadLinks(json.links || null);
      return json.links;
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not create statement PDF link."
      );
      return null;
    } finally {
      setPdfLoading(false);
    }
  }

  async function copyPdfLink() {
    const links = downloadLinks || (await fetchPdfLinks("link"));
    if (!links?.pdf) return;
    try {
      const absolute = links.pdf.startsWith("http")
        ? links.pdf
        : `${window.location.origin}${links.pdf}`;
      await navigator.clipboard.writeText(absolute);
      setSuccess("Signed PDF link copied.");
    } catch {
      setError("Could not copy signed link.");
    }
  }

  useEffect(() => {
    load(weekKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pack) return;
    void fetchPdfLinks("link");
  }, [pack?.weekKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Weekly Statements</h1>
          <p className="text-sm text-slate-600">Merchant statement pack (cash-world accounting)</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/merchant/orders" className="rounded-lg border px-3 py-2 text-sm">
            Orders
          </Link>
          <Link href="/merchant/finance" className="rounded-lg border px-3 py-2 text-sm">
            Finance
          </Link>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-4">
        <input
          value={weekKey}
          onChange={(e) => setWeekKey(e.target.value)}
          placeholder="YYYY-Www"
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => load(weekKey)}
          disabled={loading}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
        >
          {loading ? "Loading..." : "Load"}
        </button>
        <a
          href={`/api/merchant/statements/weekly?weekKey=${encodeURIComponent(weekKey)}&format=csv_orders`}
          className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold"
          target="_blank"
          rel="noreferrer"
        >
          Download Orders CSV
        </a>
        <a
          href={`/api/merchant/statements/weekly?weekKey=${encodeURIComponent(weekKey)}&format=csv_summary`}
          className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold"
          target="_blank"
          rel="noreferrer"
        >
          Download Summary CSV
        </a>
        <button
          type="button"
          onClick={copySummary}
          className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold"
        >
          Copy Statement Summary
        </button>
        <button
          type="button"
          onClick={() => fetchPdfLinks("generate")}
          disabled={pdfLoading}
          className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold"
        >
          {pdfLoading ? "Generating..." : "Generate PDF"}
        </button>
        <button
          type="button"
          onClick={copyPdfLink}
          disabled={pdfLoading}
          className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold"
        >
          Share Link
        </button>
        {downloadLinks?.pdf ? (
          <a
            href={downloadLinks.pdf}
            className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold"
            target="_blank"
            rel="noreferrer"
          >
            Download PDF
          </a>
        ) : null}
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mb-3 text-sm text-emerald-700">{success}</p> : null}

      {pack ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-semibold">{pack.businessName}</h2>
            <p className="text-xs text-slate-500">
              Week {pack.weekKey} | Computed {formatDateTime(pack.integrity.computedAt)}
            </p>
            {archive ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">
                  Archive v{archive.version}
                </span>
                <span className="text-slate-600">Generated: {formatDateTime(archive.generatedAt)}</span>
                {archive.locked ? (
                  <span className="rounded-full bg-blue-100 px-2 py-1 font-semibold text-blue-700">
                    Locked
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricTile label="Orders" value={String(pack.totals.ordersCount)} />
              <MetricTile label="Gross" value={formatMoney(pack.totals.grossSubtotal)} />
              <MetricTile label="Promo Discount" value={formatMoney(pack.totals.promoDiscountTotal)} />
              <MetricTile label="Net Subtotal" value={formatMoney(pack.totals.netSubtotal)} />
              <MetricTile label="Commission" value={formatMoney(pack.totals.commissionTotal)} />
              <MetricTile label="Expected Cash" value={formatMoney(pack.totals.cashExpected)} />
              <MetricTile label="Verified Cash" value={formatMoney(pack.totals.cashVerified)} />
              <MetricTile label="Variance" value={formatMoney(pack.totals.variance)} />
            </div>
          </section>

          <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-base font-semibold">Proof + Resolution</h3>
            <div className="mt-2 grid gap-1 text-sm text-slate-700 sm:grid-cols-2">
              <p>Settlement status: {pack.settlement.status}</p>
              <p>Cash status: {pack.cash.status || "-"}</p>
              <p>Collector: {pack.cash.collectorName || pack.settlement.collectorName || "-"}</p>
              <p>Method: {pack.cash.collectionMethod || pack.settlement.collectionMethod || "-"}</p>
              <p>Receipt ref: {pack.cash.receiptRef || pack.settlement.receiptRef || "-"}</p>
              <p>Resolution status: {pack.settlement.resolutionStatus || "-"}</p>
              <p>Resolution note: {pack.settlement.resolutionNote || "-"}</p>
              <p>Resolved at: {formatDateTime(pack.settlement.resolvedAt)}</p>
              <p>Submitted at: {formatDateTime(pack.cash.lastSubmittedAt)}</p>
              <p>Verified at: {formatDateTime(pack.cash.verifiedAt)}</p>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {pack.cash.receiptPhotoUrl || pack.settlement.receiptPhotoUrl ? (
                <a
                  href={pack.cash.receiptPhotoUrl || pack.settlement.receiptPhotoUrl || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                >
                  Open Receipt Photo
                </a>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-lg border border-slate-200 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </article>
  );
}
