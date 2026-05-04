import Link from "next/link";
import { headers } from "next/headers";
import { getWeekKey } from "@/lib/geo";
import { ENV_SUPPORT_WHATSAPP_E164 } from "@/lib/env";
import { getBoolSetting, getNumberSetting, getStringSetting } from "@/lib/appSettings";
import { parseAllowlist } from "@/lib/pilot";
import MaintenanceToggle from "./MaintenanceToggle";
import AtRiskMerchantsTable from "./AtRiskMerchantsTable";
import PilotModeControls from "./PilotModeControls";
import SlaControls from "./SlaControls";
import RunSettlementPreviewsButton from "./RunSettlementPreviewsButton";
import PromoBudgetControls from "./PromoBudgetControls";
import RunPromoBudgetReconcileButton from "./RunPromoBudgetReconcileButton";
import ComplaintsPanel from "./ComplaintsPanel";
import EtaControlsPanel from "./EtaControlsPanel";
import MenuQualityControlsPanel from "./MenuQualityControlsPanel";
import SearchTelemetryPanel from "./SearchTelemetryPanel";
import FunnelPanel from "./FunnelPanel";
import ReputationPanel from "./ReputationPanel";
import CashReconciliationPanel from "./CashReconciliationPanel";
import FinanceMismatchesPanel from "./FinanceMismatchesPanel";
import FinanceAlertsPanel from "./FinanceAlertsPanel";
import SecurityPrivacyPanel from "./SecurityPrivacyPanel";
import DispatchPanel from "./DispatchPanel";

type SearchParams = Record<string, string | string[] | undefined>;

type MaintenanceResponse = {
  ok: boolean;
  maintenanceMode?: boolean;
  source?: "env" | "db" | "env+db" | string;
  error?: { message?: string } | string;
};

type BackupRunResponse = {
  ok: boolean;
  runs?: Array<{
    _id?: string;
    kind?: "orders" | "settlements" | "cashCollections" | "all";
    status?: "running" | "success" | "failed";
    startedAt?: string | Date;
    finishedAt?: string | Date | null;
    counts?: {
      orders?: number;
      settlements?: number;
      cashCollections?: number;
    };
    fileMeta?: {
      filename?: string;
      sizeBytes?: number;
    };
    errorMessage?: string | null;
  }>;
  error?: { message?: string } | string;
};

type StatusResponse = {
  ok: boolean;
  env?: string;
  timestamp?: string;
  maintenance?: boolean;
  promosEnabled?: boolean;
  pilotModeEnabled?: boolean;
  version?: string | null;
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
    promosEnabled?: boolean;
    promoBudgetWeeklyRdp?: number;
    promoDiscountSpentThisWeekRdp?: number;
    promoBudgetRemainingThisWeekRdp?: number;
    ordersTodayBySource?: SourceMetricMap;
    deliveredTodayBySource?: SourceMetricMap;
    deliveredWeekBySource?: SourceMetricMap;
    commissionWeekBySource?: SourceMetricMap;
    promoDiscountWeekBySource?: SourceMetricMap;
    netSubtotalWeekBySource?: SourceMetricMap;
    repeatRateLast7d?: number;
    customersLast7d?: number;
    repeatCustomersLast7d?: number;
    weekDeliveredCount?: number;
    weekDeliveredVerifiedCount?: number;
    weekDeliveredOverrideCount?: number;
    weekDeliveredUnverifiedCount?: number;
    repeatRateLast7dBySource?: Array<{
      source: SourceMetricKey;
      customers: number;
      repeatCustomers: number;
      repeatRate: number;
    }>;
    weekOrderBlockedCounts?: {
      closed?: number;
      busy?: number;
      manual_pause?: number;
      total?: number;
    };
    weekAvgFirstActionMinutes?: number;
    weekAvgTotalMinutes?: number;
    menuQuality?: {
      avgScore?: number;
      businessesBelowMinScore?: number;
      businessesBelowPauseThreshold?: number;
    };
    menuQualityCounts?: {
      top?: number;
      ok?: number;
      low?: number;
      bad?: number;
    };
  };
  topCampaignsWeek?: TopCampaignRow[];
  topBlockedBusinessesWeek?: Array<{
    businessId: string;
    businessName: string;
    blockedCount: number;
  }>;
  topRepeatBusinessesLast7d?: Array<{
    businessId: string;
    businessName: string;
    customers: number;
    repeatCustomers: number;
    repeatRate: number;
  }>;
  topBusinessesByOverridesWeek?: Array<{
    businessId: string;
    businessName: string;
    overridesCount: number;
  }>;
  slowestBusinessesWeek?: Array<{
    businessId: string;
    businessName: string;
    avgTotalMinutes: number;
    deliveredCount: number;
  }>;
  error?: { message?: string } | string;
};

type SourceMetricKey = "organic" | "whatsapp" | "flyer" | "merchant_referral";
type SourceMetricMap = Partial<Record<SourceMetricKey, number>>;
type TopCampaignRow = {
  campaignId: string;
  deliveredCount: number;
  commissionTotal: number;
  promoDiscountTotal: number;
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

type SettlementPreviewItem = {
  businessId?: string | { $oid?: string } | null;
  businessName?: string;
  weekKey?: string;
  mismatch?: boolean;
  expectedOrdersCount?: number;
  expectedGrossSubtotal?: number;
  expectedFeeTotal?: number;
  storedExists?: boolean;
  storedOrdersCount?: number | null;
  storedGrossSubtotal?: number | null;
  storedFeeTotal?: number | null;
  integrityHasHash?: boolean;
  integrityHashMatches?: boolean | null;
  diffOrdersCount?: number | null;
  diffGrossSubtotal?: number | null;
  diffFeeTotal?: number | null;
  generatedAt?: string | Date;
};

type SettlementPreviewResponse = {
  ok: boolean;
  weekKey?: string;
  previews?: SettlementPreviewItem[];
  error?: { message?: string } | string;
};

type PromoSpendResponse = {
  ok: boolean;
  weekKey?: string;
  summary?: {
    promosEnabled?: boolean;
    weeklyBudgetRdp?: number;
    spentRdp?: number;
    remainingRdp?: number;
    overBudgetRdp?: number;
    burnRatePerDayRdp?: number;
    elapsedDays?: number;
  };
  dailySpend?: Array<{
    date: string;
    amount: number;
  }>;
  topPromos?: Array<{
    code: string;
    spendRdp: number;
    orders: number;
  }>;
  topBusinesses?: Array<{
    businessId: string;
    businessName: string;
    spendRdp: number;
    orders: number;
  }>;
  error?: { message?: string } | string;
};

type ComplaintRow = {
  complaintId: string;
  orderNumber: string;
  businessId: string;
  businessName: string;
  type: "late" | "wrong_item" | "no_response" | "other";
  message: string;
  status: "open" | "resolved";
  createdAt?: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  resolutionNote?: string | null;
};

type ComplaintsResponse = {
  ok: boolean;
  complaints?: ComplaintRow[];
  error?: { message?: string } | string;
};

type OpenStatusResponse = {
  ok: boolean;
  counts?: {
    open?: number;
    closed?: number;
    busy?: number;
    paused?: number;
  };
  listClosedNow?: Array<{
    businessId: string;
    businessName: string;
    reason: "closed" | "busy" | "manual_pause";
    nextOpenText?: string | null;
    busyUntil?: string | null;
  }>;
  error?: { message?: string } | string;
};

type TrustOverviewResponse = {
  ok: boolean;
  badgeCounts?: {
    top?: number;
    good?: number;
    new?: number;
    at_risk?: number;
  };
  atRiskList?: Array<{
    businessId: string;
    businessName: string;
    trust: {
      badge: "top" | "good" | "new" | "at_risk";
      delivered30d: number;
      acceptanceWithin7mRate30d: number;
      complaints30d: number;
      staleNewOrdersCount24h: number;
    };
    etaText: string;
    isManuallyPaused: boolean;
    busyUntil?: string | null;
    isOpenNow: boolean;
  }>;
  error?: { message?: string } | string;
};

type AdminBusinessesResponse = {
  ok: boolean;
  businesses?: Array<{
    id: string;
    name: string;
    eta?: {
      minMins?: number;
      maxMins?: number;
      prepMins?: number;
    };
  }>;
  error?: { message?: string } | string;
};

type MenuQualityResponse = {
  ok: boolean;
  minProductsRequired?: number;
  minScore?: number;
  pauseEnabled?: boolean;
  pauseThreshold?: number;
  autoHide?: {
    enabled?: boolean;
    days?: number;
    neverSoldEnabled?: boolean;
    lastRunAt?: string | null;
    lastScanned?: number;
    lastHidden?: number;
  };
  summary?: {
    businessesCount?: number;
    avgScore?: number;
    belowMinScoreCount?: number;
    belowPauseThresholdCount?: number;
  };
  listAtRisk?: Array<{
    businessId: string;
    businessName: string;
    type: string;
    isPaused: boolean;
    pausedReason: string;
    menuQuality: {
      menuQualityScore: number;
      productsActiveCount: number;
      productsWithImageCount: number;
      categoriesCount: number;
    };
  }>;
  error?: { message?: string } | string;
};

type SearchTelemetryResponse = {
  ok: boolean;
  counts?: {
    searches?: number;
    zeroResults?: number;
    noResultRate?: number;
  };
  topSource?: {
    source?: string;
    count?: number;
    noResultRate?: number;
  };
  topQueries?: Array<{
    queryHash: string;
    count: number;
  }>;
  bySource?: Array<{
    source: string;
    count: number;
    noResultRate: number;
  }>;
  opportunities?: Array<{
    businessId: string;
    businessName: string;
    impressions: number;
    menuQualityScore: number;
    paused: boolean;
    pausedReason: string;
  }>;
  error?: { message?: string } | string;
};

type FunnelResponse = {
  ok: boolean;
  totals?: {
    business_view?: number;
    add_to_cart?: number;
    checkout_start?: number;
    order_success?: number;
    order_fail?: number;
  };
  rates?: {
    viewToAddRate?: number;
    addToCheckoutRate?: number;
    checkoutToOrderRate?: number;
  };
  bySource?: Array<{
    source: string;
    business_view: number;
    add_to_cart: number;
    checkout_start: number;
    order_success: number;
    order_fail: number;
    viewToAddRate: number;
    addToCheckoutRate: number;
    checkoutToOrderRate: number;
  }>;
  topDropoffBusinesses?: Array<{
    businessId: string;
    businessName: string;
    businessType: string;
    menuQualityScore: number;
    trustBadge: string;
    paused: boolean;
    pausedReason: string;
    business_view: number;
    add_to_cart: number;
    checkout_start: number;
    order_success: number;
    order_fail: number;
    viewToAddRate: number;
    addToCheckoutRate: number;
    checkoutToOrderRate: number;
  }>;
  topFailCodes?: Array<{
    failCode: string;
    count: number;
  }>;
  error?: { message?: string } | string;
};

type ReputationResponse = {
  ok: boolean;
  summary?: {
    totalReviews?: number;
    avgRating?: number;
    ratingCounts?: {
      1?: number;
      2?: number;
      3?: number;
      4?: number;
      5?: number;
    };
    tagsTop?: Array<{
      tag: string;
      count: number;
    }>;
  };
  worstBusinesses?: Array<{
    businessId: string;
    businessName: string;
    avgRating: number;
    reviewsCount: number;
    complaints30d?: number;
    acceptanceRate30d?: number;
  }>;
  latest?: Array<{
    reviewId: string;
    businessId: string;
    businessName: string;
    rating: number;
    tags: string[];
    comment: string;
    source: string;
    createdAt?: string;
    isHidden: boolean;
  }>;
  error?: { message?: string } | string;
};

type CashCollectionResponse = {
  ok: boolean;
  weekKey?: string;
  rows?: Array<{
    id: string;
    businessId: string;
    businessName: string;
    weekKey: string;
    status: "open" | "submitted" | "verified" | "disputed" | "closed";
    expected: {
      ordersCount: number;
      grossSubtotal: number;
      promoDiscountTotal: number;
      netSubtotal: number;
      commissionTotal: number;
    };
    reported: {
      cashCollected: number | null;
      grossSubtotal?: number | null;
      netSubtotal?: number | null;
      commissionTotal?: number | null;
      ordersCount: number | null;
      collectorName: string | null;
      collectionMethod:
        | "in_person"
        | "bank_deposit"
        | "bank_transfer"
        | "transfer"
        | "pickup"
        | "other"
        | null;
      receiptPhotoUrl: string | null;
      receiptRef: string | null;
      reportedAt: string | null;
    };
    discrepancy: {
      cashDiff: number;
      ordersDiff: number;
    };
    integrity: {
      expectedHash: string;
      computedAt: string | null;
      status?: "ok" | "mismatch";
    };
    proofComplete?: boolean;
    missingProofFields?: string[];
    submittedAt?: string | null;
    verifiedAt?: string | null;
    updatedAt: string | null;
  }>;
  summary?: {
    totalExpectedNet: number;
    totalReportedCash: number;
    totalCashDiff: number;
    submittedCount: number;
    verifiedCount: number;
    disputedCount: number;
    openCount: number;
    closedCount: number;
  };
  error?: { message?: string } | string;
};

type FinanceMismatchResponse = {
  ok: boolean;
  weekKey?: string;
  summary?: {
    totalRows?: number;
    returnedRows?: number;
    mismatchRows?: number;
    missingSettlementCount?: number;
    missingCashCount?: number;
    hashMismatchCount?: number;
    overThresholdCount?: number;
    thresholds?: {
      ordersThreshold?: number;
      moneyThresholdRdp?: number;
    };
  };
  rows?: Array<{
    businessId: string;
    businessName: string;
    weekKey: string;
    deliveredAgg: {
      deliveredOrdersCount: number;
      deliveredGrossSubtotal: number;
      deliveredNetSubtotal: number;
      deliveredCommissionTotal: number;
    };
    settlement: {
      settlementOrdersCount: number;
      settlementGrossSubtotal: number;
      settlementFeeTotal: number;
      settlementStatus: "pending" | "collected" | "locked" | null;
    } | null;
    cash: {
      cashStatus: "open" | "submitted" | "verified" | "disputed" | "closed";
      reportedGross: number | null;
      reportedCommission: number | null;
      reportedNet: number | null;
      expectedHash: string;
      integrityStatus: "ok" | "mismatch";
      verifiedAt: string | null;
      submittedAt: string | null;
    } | null;
    diffs: {
      diffOrders: number | null;
      diffGrossSubtotal: number | null;
      diffFeeTotal: number | null;
      diffCashNetVsDeliveredNet: number | null;
      diffCashCommissionVsDeliveredCommission: number | null;
    };
    flags: {
      missingSettlement: boolean;
      missingCashCollection: boolean;
      settlementCollectedButNoCash: boolean;
      hashMismatch: boolean;
      integrityMismatch: boolean;
      diffOverThreshold: boolean;
    };
  }>;
  anomalies?: {
    countsByType?: Record<string, number>;
    latest?: Array<{
      id: string;
      type: string;
      severity: "low" | "medium" | "high" | null;
      businessId: string;
      businessName: string;
      weekKey: string;
      createdAt: string | null;
    }>;
  };
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

function sourceMetricValue(map: SourceMetricMap | undefined, key: SourceMetricKey) {
  return Number(map?.[key] || 0);
}

const SOURCE_ROWS: Array<{ key: SourceMetricKey; label: string }> = [
  { key: "organic", label: "Organic" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "flyer", label: "Flyer" },
  { key: "merchant_referral", label: "Merchant Referral" },
];

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
  const currentWeekKey = getWeekKey(now);
  const currentDayKey = now.toISOString().slice(0, 10);

  const [
    maintenanceReq,
    metricsReq,
    settlementAuditReq,
    businessAuditReq,
    atRiskReq,
    settlementPreviewReq,
    promoSpendReq,
    complaintsReq,
    openStatusReq,
    trustOverviewReq,
    adminBusinessesReq,
    menuQualityReq,
    searchTelemetryReq,
    funnelReq,
    reputationReq,
    backupRunsReq,
    statusReq,
  ] =
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
      fetchJson<SettlementPreviewResponse>(
        `${baseUrl}/api/admin/settlement-previews?key=${encodeURIComponent(
          key
        )}&weekKey=${encodeURIComponent(currentWeekKey)}&mismatchOnly=true&limit=10`
      ),
      fetchJson<PromoSpendResponse>(
        `${baseUrl}/api/admin/promo-spend?key=${encodeURIComponent(
          key
        )}&weekKey=${encodeURIComponent(currentWeekKey)}&limit=10`
      ),
      fetchJson<ComplaintsResponse>(
        `${baseUrl}/api/admin/complaints?key=${encodeURIComponent(key)}&status=open&limit=20`
      ),
      fetchJson<OpenStatusResponse>(
        `${baseUrl}/api/admin/ops/open-status?key=${encodeURIComponent(key)}`
      ),
      fetchJson<TrustOverviewResponse>(
        `${baseUrl}/api/admin/ops/trust?key=${encodeURIComponent(key)}`
      ),
      fetchJson<AdminBusinessesResponse>(
        `${baseUrl}/api/admin/businesses?key=${encodeURIComponent(key)}`
      ),
      fetchJson<MenuQualityResponse>(
        `${baseUrl}/api/admin/ops/menu-quality?key=${encodeURIComponent(key)}`
      ),
      fetchJson<SearchTelemetryResponse>(
        `${baseUrl}/api/admin/ops/search-telemetry?key=${encodeURIComponent(key)}`
      ),
      fetchJson<FunnelResponse>(
        `${baseUrl}/api/admin/ops/funnel?key=${encodeURIComponent(key)}&days=7`
      ),
      fetchJson<ReputationResponse>(
        `${baseUrl}/api/admin/ops/reviews?key=${encodeURIComponent(key)}&days=30&limit=100`
      ),
      fetchJson<BackupRunResponse>(
        `${baseUrl}/api/admin/backup-runs?key=${encodeURIComponent(key)}`
      ),
      fetchJson<StatusResponse>(`${baseUrl}/api/status`),
    ]);
  const cashCollectionsReq = await fetchJson<CashCollectionResponse>(
    `${baseUrl}/api/admin/cash-collections?key=${encodeURIComponent(
      key
    )}&weekKey=${encodeURIComponent(currentWeekKey)}&limit=200`
  );
  const financeMismatchesReq = await fetchJson<FinanceMismatchResponse>(
    `${baseUrl}/api/admin/finance/mismatches?key=${encodeURIComponent(
      key
    )}&weekKey=${encodeURIComponent(currentWeekKey)}&limit=200`
  );

  const maintenanceMode = Boolean(maintenanceReq.data?.maintenanceMode);
  const source = String(maintenanceReq.data?.source || "db");
  const kpis = metricsReq.data?.kpis;
  const weekKey = String(metricsReq.data?.weekKey || currentWeekKey);
  const settlementAudits = settlementAuditReq.data?.events || [];
  const businessAudits = businessAuditReq.data?.events || [];
  const atRiskBusinesses = atRiskReq.data?.businesses || [];
  const settlementPreviews = settlementPreviewReq.data?.previews || [];
  const previewGeneratedAt = settlementPreviews[0]?.generatedAt;
  const integrityFailCount = settlementPreviews.filter((preview) => preview.integrityHashMatches === false).length;
  const promoSpendSummary = promoSpendReq.data?.summary;
  const promoDailySpend = promoSpendReq.data?.dailySpend || [];
  const topPromos = promoSpendReq.data?.topPromos || [];
  const topPromoBusinesses = promoSpendReq.data?.topBusinesses || [];
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
  const deliveredWeekBySource = kpis?.deliveredWeekBySource;
  const commissionWeekBySource = kpis?.commissionWeekBySource;
  const promoDiscountWeekBySource = kpis?.promoDiscountWeekBySource;
  const netSubtotalWeekBySource = kpis?.netSubtotalWeekBySource;
  const topCampaignsWeek = (metricsReq.data?.topCampaignsWeek || []).slice(0, 5);
  const topRepeatBusinessesLast7d = (metricsReq.data?.topRepeatBusinessesLast7d || []).slice(0, 10);
  const topBusinessesByOverridesWeek = (metricsReq.data?.topBusinessesByOverridesWeek || []).slice(
    0,
    10
  );
  const slowestBusinessesWeek = (metricsReq.data?.slowestBusinessesWeek || []).slice(0, 10);
  const complaints = complaintsReq.data?.complaints || [];
  const openStatusCounts = openStatusReq.data?.counts || {
    open: 0,
    closed: 0,
    busy: 0,
    paused: 0,
  };
  const openStatusList = (openStatusReq.data?.listClosedNow || []).slice(0, 30);
  const trustBadgeCounts = trustOverviewReq.data?.badgeCounts || {
    top: 0,
    good: 0,
    new: 0,
    at_risk: 0,
  };
  const trustAtRiskList = (trustOverviewReq.data?.atRiskList || []).slice(0, 25);
  const menuQualitySummary = menuQualityReq.data?.summary || {
    businessesCount: 0,
    avgScore: 0,
    belowMinScoreCount: 0,
    belowPauseThresholdCount: 0,
  };
  const menuQualityAtRisk = (menuQualityReq.data?.listAtRisk || []).slice(0, 25);
  const menuQualityAutoHide = menuQualityReq.data?.autoHide || {
    enabled: true,
    days: 30,
    neverSoldEnabled: true,
    lastRunAt: null,
    lastScanned: 0,
    lastHidden: 0,
  };
  const etaRows = (adminBusinessesReq.data?.businesses || [])
    .map((row) => {
      const minMins = Number(row.eta?.minMins ?? 25);
      const maxMins = Number(row.eta?.maxMins ?? 40);
      const prepMins = Number(row.eta?.prepMins ?? 15);
      const safeMin = Number.isFinite(minMins) ? minMins : 25;
      const safeMax = Number.isFinite(maxMins) ? maxMins : 40;
      const safePrep = Number.isFinite(prepMins) ? prepMins : 15;
      const etaText = safeMin === safeMax ? `${safeMin} min` : `${safeMin}-${safeMax} min`;
      return {
        businessId: String(row.id),
        name: String(row.name || "Business"),
        eta: {
          minMins: safeMin,
          maxMins: safeMax,
          prepMins: safePrep,
          text: etaText,
        },
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  const searchTelemetryCounts = searchTelemetryReq.data?.counts || {
    searches: 0,
    zeroResults: 0,
    noResultRate: 0,
  };
  const searchTelemetryTopSource = searchTelemetryReq.data?.topSource || {
    source: "unknown",
    count: 0,
    noResultRate: 0,
  };
  const searchTelemetryTopQueries = (searchTelemetryReq.data?.topQueries || []).slice(0, 20);
  const searchTelemetryBySource = (searchTelemetryReq.data?.bySource || []).slice(0, 20);
  const searchTelemetryOpportunities = (searchTelemetryReq.data?.opportunities || []).slice(0, 20);
  const funnelTotals = funnelReq.data?.totals || {
    business_view: 0,
    add_to_cart: 0,
    checkout_start: 0,
    order_success: 0,
    order_fail: 0,
  };
  const funnelRates = funnelReq.data?.rates || {
    viewToAddRate: 0,
    addToCheckoutRate: 0,
    checkoutToOrderRate: 0,
  };
  const funnelBySource = (funnelReq.data?.bySource || []).slice(0, 20);
  const funnelTopDropoffBusinesses = (funnelReq.data?.topDropoffBusinesses || []).slice(0, 20);
  const funnelTopFailCodes = (funnelReq.data?.topFailCodes || []).slice(0, 20);
  const reputationSummary = reputationReq.data?.summary || {
    totalReviews: 0,
    avgRating: 0,
    ratingCounts: {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    },
    tagsTop: [],
  };
  const reputationWorstBusinesses = (reputationReq.data?.worstBusinesses || []).slice(0, 25);
  const reputationLatest = (reputationReq.data?.latest || []).slice(0, 100);
  const weekOrderBlockedCounts = kpis?.weekOrderBlockedCounts || {
    closed: 0,
    busy: 0,
    manual_pause: 0,
    total: 0,
  };
  const topBlockedBusinessesWeek = (metricsReq.data?.topBlockedBusinessesWeek || []).slice(0, 10);
  const cashCollectionRows = cashCollectionsReq.data?.rows || [];
  const cashCollectionSummary = cashCollectionsReq.data?.summary || {
    totalExpectedNet: 0,
    totalReportedCash: 0,
    totalCashDiff: 0,
    submittedCount: 0,
    verifiedCount: 0,
    disputedCount: 0,
    openCount: 0,
    closedCount: 0,
  };
  const financeMismatchRows = financeMismatchesReq.data?.rows || [];
  const financeMismatchSummary = {
    totalRows: Number(financeMismatchesReq.data?.summary?.totalRows || 0),
    returnedRows: Number(financeMismatchesReq.data?.summary?.returnedRows || 0),
    mismatchRows: Number(financeMismatchesReq.data?.summary?.mismatchRows || 0),
    missingSettlementCount: Number(financeMismatchesReq.data?.summary?.missingSettlementCount || 0),
    missingCashCount: Number(financeMismatchesReq.data?.summary?.missingCashCount || 0),
    hashMismatchCount: Number(financeMismatchesReq.data?.summary?.hashMismatchCount || 0),
    overThresholdCount: Number(financeMismatchesReq.data?.summary?.overThresholdCount || 0),
    thresholds: {
      ordersThreshold: Number(financeMismatchesReq.data?.summary?.thresholds?.ordersThreshold || 0),
      moneyThresholdRdp: Number(financeMismatchesReq.data?.summary?.thresholds?.moneyThresholdRdp || 50),
    },
  };
  const financeMismatchAnomalies = financeMismatchesReq.data?.anomalies || {
    countsByType: {},
    latest: [],
  };
  const backupRuns = (backupRunsReq.data?.runs || []).slice(0, 20);
  const statusSnapshot = statusReq.data || {
    env: "unknown",
    maintenance: false,
    promosEnabled: false,
    pilotModeEnabled: false,
    version: null,
    timestamp: null,
  };

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
          <a
            href="/api/status"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Status
          </a>
          <Link
            href={`/admin/settlements?key=${encodeURIComponent(key)}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Settlements
          </Link>
          <Link
            href={`/admin/promos?key=${encodeURIComponent(key)}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Promos
          </Link>
          <Link
            href={`/admin/onboarding?key=${encodeURIComponent(key)}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Onboarding
          </Link>
          <Link
            href={`/admin/audit?key=${encodeURIComponent(key)}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Audit
          </Link>
          <Link
            href={`/admin/drivers?key=${encodeURIComponent(key)}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Drivers
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

        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Promos</p>
          <p
            className={`mt-1 text-xl font-bold ${
              kpis?.promosEnabled ? "text-emerald-700" : "text-amber-700"
            }`}
          >
            {kpis?.promosEnabled ? "ON" : "OFF"}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Weekly budget: {formatMoney(kpis?.promoBudgetWeeklyRdp)}
          </p>
          <p className="text-sm text-slate-600">
            Spent: {formatMoney(kpis?.promoDiscountSpentThisWeekRdp)}
          </p>
          <p className="text-sm text-slate-600">
            Remaining: {formatMoney(kpis?.promoBudgetRemainingThisWeekRdp)}
          </p>
          <PromoBudgetControls
            adminKey={key}
            promosEnabled={Boolean(kpis?.promosEnabled)}
            weeklyBudgetRdp={Number(kpis?.promoBudgetWeeklyRdp || 0)}
            spentRdp={Number(kpis?.promoDiscountSpentThisWeekRdp || 0)}
            remainingRdp={Number(kpis?.promoBudgetRemainingThisWeekRdp || 0)}
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
            href={`/api/admin/finance/export?key=${encodeURIComponent(
              key
            )}&weekKey=${encodeURIComponent(currentWeekKey)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
          >
            Export Finance CSV (Week)
          </a>
          <a
            href={`/admin/statements?key=${encodeURIComponent(
              key
            )}&weekKey=${encodeURIComponent(currentWeekKey)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
          >
            Open Weekly Statement
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

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Reliability</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <MetricCard label="Env" value={String(statusSnapshot.env || "-")} />
          <MetricCard
            label="Maintenance"
            value={statusSnapshot.maintenance ? "ON" : "OFF"}
          />
          <MetricCard
            label="Promos Enabled"
            value={statusSnapshot.promosEnabled ? "ON" : "OFF"}
          />
          <MetricCard
            label="Pilot Enabled"
            value={statusSnapshot.pilotModeEnabled ? "ON" : "OFF"}
          />
          <MetricCard label="Version" value={String(statusSnapshot.version || "-")} />
          <MetricCard label="Status Time" value={formatDateTime(statusSnapshot.timestamp || undefined)} />
        </div>
        <p className="mt-3 text-xs text-slate-600">
          Usa <code>x-request-id</code> en clientes y logs para rastrear incidencias extremo a
          extremo.
        </p>
        {backupRunsReq.ok ? null : <p className="mt-2 text-sm text-red-600">{backupRunsReq.error}</p>}
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Started</th>
                <th className="pb-2">Kind</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Counts</th>
                <th className="pb-2">File</th>
                <th className="pb-2">Finished</th>
              </tr>
            </thead>
            <tbody>
              {backupRuns.length ? (
                backupRuns.map((run) => (
                  <tr key={String(run._id || `${run.kind}-${run.startedAt}`)} className="border-t border-slate-100">
                    <td className="py-2">{formatDateTime(run.startedAt || undefined)}</td>
                    <td className="py-2">{String(run.kind || "-")}</td>
                    <td className="py-2">{String(run.status || "-")}</td>
                    <td className="py-2">
                      o:{Number(run.counts?.orders || 0)} | s:
                      {Number(run.counts?.settlements || 0)} | c:
                      {Number(run.counts?.cashCollections || 0)}
                    </td>
                    <td className="py-2">
                      {String(run.fileMeta?.filename || "-")} ({Number(run.fileMeta?.sizeBytes || 0)})
                    </td>
                    <td className="py-2">{formatDateTime(run.finishedAt || undefined)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-3 text-center text-slate-500">
                    No backup runs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold">Open/Closed/Busy/Paused Now</h2>
          {openStatusReq.ok ? null : (
            <p className="mt-2 text-sm text-red-600">{openStatusReq.error}</p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label="Open" value={String(Number(openStatusCounts.open || 0))} />
            <MetricCard label="Closed" value={String(Number(openStatusCounts.closed || 0))} />
            <MetricCard label="Busy" value={String(Number(openStatusCounts.busy || 0))} />
            <MetricCard label="Paused" value={String(Number(openStatusCounts.paused || 0))} />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-2">Business</th>
                  <th className="pb-2">Reason</th>
                  <th className="pb-2">Next Open</th>
                  <th className="pb-2">Busy Until</th>
                </tr>
              </thead>
              <tbody>
                {openStatusList.length ? (
                  openStatusList.map((row) => (
                    <tr key={row.businessId} className="border-t border-slate-100">
                      <td className="py-2">{row.businessName}</td>
                      <td className="py-2">{row.reason}</td>
                      <td className="py-2">{row.nextOpenText || "-"}</td>
                      <td className="py-2">{formatDateTime(row.busyUntil || undefined)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-3 text-center text-slate-500">
                      No closed/busy/paused businesses right now.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold">Blocked Orders (This Week)</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard
              label="Total"
              value={String(Number(weekOrderBlockedCounts.total || 0))}
            />
            <MetricCard
              label="Closed"
              value={String(Number(weekOrderBlockedCounts.closed || 0))}
            />
            <MetricCard
              label="Busy"
              value={String(Number(weekOrderBlockedCounts.busy || 0))}
            />
            <MetricCard
              label="Manual Pause"
              value={String(Number(weekOrderBlockedCounts.manual_pause || 0))}
            />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-2">Business</th>
                  <th className="pb-2">Blocked</th>
                </tr>
              </thead>
              <tbody>
                {topBlockedBusinessesWeek.length ? (
                  topBlockedBusinessesWeek.map((row) => (
                    <tr key={row.businessId} className="border-t border-slate-100">
                      <td className="py-2">{row.businessName}</td>
                      <td className="py-2">{Number(row.blockedCount || 0)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={2} className="py-3 text-center text-slate-500">
                      No blocked attempts this week.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Trust Overview</h2>
        {trustOverviewReq.ok ? null : (
          <p className="mt-2 text-sm text-red-600">{trustOverviewReq.error}</p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard label="Top" value={String(Number(trustBadgeCounts.top || 0))} />
          <MetricCard label="Good" value={String(Number(trustBadgeCounts.good || 0))} />
          <MetricCard label="New" value={String(Number(trustBadgeCounts.new || 0))} />
          <MetricCard label="At Risk" value={String(Number(trustBadgeCounts.at_risk || 0))} />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Business</th>
                <th className="pb-2">Badge</th>
                <th className="pb-2">Complaints 30d</th>
                <th className="pb-2">Accept {"<="}7m</th>
                <th className="pb-2">Delivered 30d</th>
                <th className="pb-2">ETA</th>
                <th className="pb-2">Open</th>
              </tr>
            </thead>
            <tbody>
              {trustAtRiskList.length ? (
                trustAtRiskList.map((row) => (
                  <tr key={row.businessId} className="border-t border-slate-100">
                    <td className="py-2">{row.businessName}</td>
                    <td className="py-2">{row.trust.badge}</td>
                    <td className="py-2">{Number(row.trust.complaints30d || 0)}</td>
                    <td className="py-2">
                      {(Number(row.trust.acceptanceWithin7mRate30d || 0) * 100).toFixed(2)}%
                    </td>
                    <td className="py-2">{Number(row.trust.delivered30d || 0)}</td>
                    <td className="py-2">{row.etaText || "-"}</td>
                    <td className="py-2">{row.isOpenNow ? "Open" : "Closed"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-3 text-center text-slate-500">
                    No at-risk trust rows right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <EtaControlsPanel adminKey={key} rows={etaRows} />
      <MenuQualityControlsPanel
        adminKey={key}
        minProductsRequired={Number(menuQualityReq.data?.minProductsRequired || 10)}
        minScore={Number(menuQualityReq.data?.minScore || 60)}
        pauseEnabled={Boolean(menuQualityReq.data?.pauseEnabled)}
        pauseThreshold={Number(menuQualityReq.data?.pauseThreshold || 40)}
        autoHideEnabled={Boolean(menuQualityAutoHide.enabled)}
        autoHideDays={Number(menuQualityAutoHide.days || 30)}
        autoHideNeverSoldEnabled={Boolean(menuQualityAutoHide.neverSoldEnabled)}
        autoHideLastRunAt={menuQualityAutoHide.lastRunAt || null}
        autoHideLastScanned={Number(menuQualityAutoHide.lastScanned || 0)}
        autoHideLastHidden={Number(menuQualityAutoHide.lastHidden || 0)}
        avgScore={Number(menuQualitySummary.avgScore || kpis?.menuQuality?.avgScore || 0)}
        belowMinScoreCount={Number(
          menuQualitySummary.belowMinScoreCount || kpis?.menuQuality?.businessesBelowMinScore || 0
        )}
        belowPauseThresholdCount={Number(
          menuQualitySummary.belowPauseThresholdCount ||
            kpis?.menuQuality?.businessesBelowPauseThreshold ||
            0
        )}
        listAtRisk={menuQualityAtRisk}
      />
      <SearchTelemetryPanel
        adminKey={key}
        searches={Number(searchTelemetryCounts.searches || 0)}
        zeroResults={Number(searchTelemetryCounts.zeroResults || 0)}
        noResultRate={Number(searchTelemetryCounts.noResultRate || 0)}
        topSource={{
          source: String(searchTelemetryTopSource.source || "unknown"),
          count: Number(searchTelemetryTopSource.count || 0),
          noResultRate: Number(searchTelemetryTopSource.noResultRate || 0),
        }}
        topQueries={searchTelemetryTopQueries}
        bySource={searchTelemetryBySource}
        opportunities={searchTelemetryOpportunities}
      />
      <FunnelPanel
        adminKey={key}
        totals={{
          business_view: Number(funnelTotals.business_view || 0),
          add_to_cart: Number(funnelTotals.add_to_cart || 0),
          checkout_start: Number(funnelTotals.checkout_start || 0),
          order_success: Number(funnelTotals.order_success || 0),
          order_fail: Number(funnelTotals.order_fail || 0),
        }}
        rates={{
          viewToAddRate: Number(funnelRates.viewToAddRate || 0),
          addToCheckoutRate: Number(funnelRates.addToCheckoutRate || 0),
          checkoutToOrderRate: Number(funnelRates.checkoutToOrderRate || 0),
        }}
        bySource={funnelBySource}
        topDropoffBusinesses={funnelTopDropoffBusinesses}
        topFailCodes={funnelTopFailCodes}
      />
      <ReputationPanel
        adminKey={key}
        fetchError={reputationReq.ok ? "" : reputationReq.error}
        summary={{
          totalReviews: Number(reputationSummary.totalReviews || 0),
          avgRating: Number(reputationSummary.avgRating || 0),
          ratingCounts: {
            1: Number(reputationSummary.ratingCounts?.[1] || 0),
            2: Number(reputationSummary.ratingCounts?.[2] || 0),
            3: Number(reputationSummary.ratingCounts?.[3] || 0),
            4: Number(reputationSummary.ratingCounts?.[4] || 0),
            5: Number(reputationSummary.ratingCounts?.[5] || 0),
          },
          tagsTop: (reputationSummary.tagsTop || []).map((row) => ({
            tag: String(row.tag || ""),
            count: Number(row.count || 0),
          })),
        }}
        worstBusinesses={reputationWorstBusinesses.map((row) => ({
          businessId: String(row.businessId || ""),
          businessName: String(row.businessName || "Business"),
          avgRating: Number(row.avgRating || 0),
          reviewsCount: Number(row.reviewsCount || 0),
          complaints30d: Number(row.complaints30d || 0),
          acceptanceRate30d: Number(row.acceptanceRate30d || 0),
        }))}
        latest={reputationLatest.map((row) => ({
          reviewId: String(row.reviewId || ""),
          businessId: String(row.businessId || ""),
          businessName: String(row.businessName || "Business"),
          rating: Number(row.rating || 0),
          tags: Array.isArray(row.tags) ? row.tags : [],
          comment: String(row.comment || ""),
          source: String(row.source || "unknown"),
          createdAt: row.createdAt,
          isHidden: Boolean(row.isHidden),
        }))}
      />
      <CashReconciliationPanel
        adminKey={key}
        initialWeekKey={currentWeekKey}
        initialRows={cashCollectionRows}
        initialSummary={cashCollectionSummary}
        fetchError={cashCollectionsReq.ok ? "" : cashCollectionsReq.error}
      />
      <FinanceMismatchesPanel
        adminKey={key}
        defaultWeekKey={currentWeekKey}
        initialRows={financeMismatchRows}
        initialSummary={financeMismatchSummary}
        initialAnomalies={financeMismatchAnomalies}
        fetchError={financeMismatchesReq.ok ? "" : financeMismatchesReq.error}
      />
      <FinanceAlertsPanel
        adminKey={key}
        defaultWeekKey={currentWeekKey}
        defaultDayKey={currentDayKey}
        supportWhatsAppE164={ENV_SUPPORT_WHATSAPP_E164}
      />
      <DispatchPanel adminKey={key} />
      <SecurityPrivacyPanel adminKey={key} />

      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Orders Today" value={String(Number(kpis?.ordersToday || 0))} />
        <MetricCard label="Commission Today" value={formatMoney(kpis?.commissionToday)} />
        <MetricCard label="Orders This Week" value={String(Number(kpis?.ordersThisWeek || 0))} />
        <MetricCard label="Commission This Week" value={formatMoney(kpis?.feeThisWeek)} />
      </section>

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold">Delivery Proof</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard
            label="Verified Rate"
            value={`${
              Number(kpis?.weekDeliveredCount || 0) > 0
                ? (
                    (Number(kpis?.weekDeliveredVerifiedCount || 0) /
                      Number(kpis?.weekDeliveredCount || 1)) *
                    100
                  ).toFixed(2)
                : "0.00"
            }%`}
          />
          <MetricCard
            label="Overrides"
            value={String(Number(kpis?.weekDeliveredOverrideCount || 0))}
          />
          <MetricCard
            label="Unverified"
            value={String(Number(kpis?.weekDeliveredUnverifiedCount || 0))}
          />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Business</th>
                <th className="pb-2">Overrides (Week)</th>
                <th className="pb-2">Audit</th>
              </tr>
            </thead>
            <tbody>
              {topBusinessesByOverridesWeek.length ? (
                topBusinessesByOverridesWeek.map((row) => (
                  <tr key={row.businessId} className="border-t border-slate-100">
                    <td className="py-2">{row.businessName}</td>
                    <td className="py-2">{Number(row.overridesCount || 0)}</td>
                    <td className="py-2">
                      <a
                        href={`/api/admin/businesses/audit?key=${encodeURIComponent(
                          key
                        )}&businessId=${encodeURIComponent(String(row.businessId || ""))}&limit=50`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                      >
                        Business Audit
                      </a>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="py-3 text-center text-slate-500">
                    No delivery overrides this week.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold">Repeat (Last 7 Days)</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard
            label="Repeat Rate"
            value={`${(Number(kpis?.repeatRateLast7d || 0) * 100).toFixed(2)}%`}
          />
          <MetricCard
            label="Customers"
            value={String(Number(kpis?.customersLast7d || 0))}
          />
          <MetricCard
            label="Repeat Customers"
            value={String(Number(kpis?.repeatCustomersLast7d || 0))}
          />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <article className="rounded-lg border border-slate-200 p-3">
            <h3 className="text-sm font-semibold">Repeat By Source</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pb-2">Source</th>
                    <th className="pb-2">Customers</th>
                    <th className="pb-2">Repeat</th>
                    <th className="pb-2">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {(kpis?.repeatRateLast7dBySource || []).length ? (
                    (kpis?.repeatRateLast7dBySource || []).map((row) => (
                      <tr key={row.source} className="border-t border-slate-100">
                        <td className="py-2">{row.source}</td>
                        <td className="py-2">{Number(row.customers || 0)}</td>
                        <td className="py-2">{Number(row.repeatCustomers || 0)}</td>
                        <td className="py-2">{(Number(row.repeatRate || 0) * 100).toFixed(2)}%</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-3 text-center text-slate-500">
                        No repeat-source data.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
          <article className="rounded-lg border border-slate-200 p-3">
            <h3 className="text-sm font-semibold">Top Repeat Businesses</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pb-2">Business</th>
                    <th className="pb-2">Customers</th>
                    <th className="pb-2">Repeat</th>
                    <th className="pb-2">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {topRepeatBusinessesLast7d.length ? (
                    topRepeatBusinessesLast7d.map((row) => (
                      <tr key={row.businessId} className="border-t border-slate-100">
                        <td className="py-2">{row.businessName}</td>
                        <td className="py-2">{Number(row.customers || 0)}</td>
                        <td className="py-2">{Number(row.repeatCustomers || 0)}</td>
                        <td className="py-2">{(Number(row.repeatRate || 0) * 100).toFixed(2)}%</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-3 text-center text-slate-500">
                        No repeat-business data.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      </section>

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold">SLA (This Week)</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricCard
            label="Avg First Action (min)"
            value={String(Number(kpis?.weekAvgFirstActionMinutes || 0).toFixed(2))}
          />
          <MetricCard
            label="Avg Delivered (min)"
            value={String(Number(kpis?.weekAvgTotalMinutes || 0).toFixed(2))}
          />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Business</th>
                <th className="pb-2">Avg Delivered (min)</th>
                <th className="pb-2">Delivered Count</th>
              </tr>
            </thead>
            <tbody>
              {slowestBusinessesWeek.length ? (
                slowestBusinessesWeek.map((row) => (
                  <tr key={row.businessId} className="border-t border-slate-100">
                    <td className="py-2">{row.businessName}</td>
                    <td className="py-2">{Number(row.avgTotalMinutes || 0).toFixed(2)}</td>
                    <td className="py-2">{Number(row.deliveredCount || 0)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="py-3 text-center text-slate-500">
                    No SLA data this week.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold">Attribution (This Week)</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Source</th>
                <th className="pb-2">Delivered</th>
                <th className="pb-2">Commission</th>
                <th className="pb-2">Promo Spend</th>
                <th className="pb-2">Net Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {SOURCE_ROWS.map((row) => (
                <tr key={row.key} className="border-t border-slate-100">
                  <td className="py-2">{row.label}</td>
                  <td className="py-2">{sourceMetricValue(deliveredWeekBySource, row.key)}</td>
                  <td className="py-2">{formatMoney(sourceMetricValue(commissionWeekBySource, row.key))}</td>
                  <td className="py-2">{formatMoney(sourceMetricValue(promoDiscountWeekBySource, row.key))}</td>
                  <td className="py-2">{formatMoney(sourceMetricValue(netSubtotalWeekBySource, row.key))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4">
          <h3 className="text-sm font-semibold">Top Campaigns (This Week)</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-2">Campaign</th>
                  <th className="pb-2">Delivered</th>
                  <th className="pb-2">Commission</th>
                  <th className="pb-2">Promo Spend</th>
                </tr>
              </thead>
              <tbody>
                {topCampaignsWeek.length ? (
                  topCampaignsWeek.map((campaign) => (
                    <tr key={campaign.campaignId} className="border-t border-slate-100">
                      <td className="py-2 font-mono text-xs">{campaign.campaignId}</td>
                      <td className="py-2">{Number(campaign.deliveredCount || 0)}</td>
                      <td className="py-2">{formatMoney(campaign.commissionTotal)}</td>
                      <td className="py-2">{formatMoney(campaign.promoDiscountTotal)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-3 text-center text-slate-500">
                      No campaign data this week.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
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

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Promo Budget Insights (This Week)</h2>
            <p className="text-xs text-slate-500">Week: {currentWeekKey}</p>
          </div>
          <RunPromoBudgetReconcileButton adminKey={key} weekKey={currentWeekKey} />
        </div>
        {promoSpendReq.ok ? null : (
          <p className="mb-3 text-sm text-red-600">{promoSpendReq.error}</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard label="Promo Spent" value={formatMoney(promoSpendSummary?.spentRdp)} />
          <MetricCard label="Promo Remaining" value={formatMoney(promoSpendSummary?.remainingRdp)} />
          <MetricCard label="Over Budget" value={formatMoney(promoSpendSummary?.overBudgetRdp)} />
          <MetricCard label="Burn Rate / Day" value={formatMoney(promoSpendSummary?.burnRatePerDayRdp)} />
          <MetricCard label="Elapsed Days" value={String(Number(promoSpendSummary?.elapsedDays || 0))} />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <article className="rounded-lg border border-slate-200 p-3">
            <h3 className="text-sm font-semibold">Daily Spend</h3>
            <div className="mt-2 space-y-1 text-sm">
              {promoDailySpend.length ? (
                promoDailySpend.map((row) => (
                  <div key={row.date} className="flex items-center justify-between">
                    <span>{row.date}</span>
                    <span>{formatMoney(row.amount)}</span>
                  </div>
                ))
              ) : (
                <p className="text-slate-500">No promo spend this week.</p>
              )}
            </div>
          </article>
          <article className="rounded-lg border border-slate-200 p-3">
            <h3 className="text-sm font-semibold">Top Promos By Spend</h3>
            <div className="mt-2 space-y-1 text-sm">
              {topPromos.length ? (
                topPromos.map((row) => (
                  <div key={row.code} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{row.code}</span>
                    <span>{formatMoney(row.spendRdp)}</span>
                    <span className="text-slate-500">{row.orders} orders</span>
                  </div>
                ))
              ) : (
                <p className="text-slate-500">No promo events yet.</p>
              )}
            </div>
          </article>
          <article className="rounded-lg border border-slate-200 p-3">
            <h3 className="text-sm font-semibold">Top Businesses By Promo Spend</h3>
            <div className="mt-2 space-y-1 text-sm">
              {topPromoBusinesses.length ? (
                topPromoBusinesses.map((row) => (
                  <div key={row.businessId} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{row.businessName}</span>
                    <span>{formatMoney(row.spendRdp)}</span>
                    <span className="text-slate-500">{row.orders} orders</span>
                  </div>
                ))
              ) : (
                <p className="text-slate-500">No business promo spend yet.</p>
              )}
            </div>
          </article>
        </div>
      </section>

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Settlement Mismatches (This Week)</h2>
              {integrityFailCount > 0 ? (
                <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
                  Integrity Fail: {integrityFailCount}
                </span>
              ) : null}
            </div>
            <p className="text-xs text-slate-500">
              Week: {currentWeekKey} | GeneratedAt: {formatDateTime(previewGeneratedAt)}
            </p>
          </div>
          <RunSettlementPreviewsButton adminKey={key} weekKey={currentWeekKey} />
        </div>
        {settlementPreviewReq.ok ? null : (
          <p className="mb-3 text-sm text-red-600">{settlementPreviewReq.error}</p>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Business</th>
                <th className="pb-2">Diff Fee</th>
                <th className="pb-2">Diff Orders</th>
                <th className="pb-2">Stored?</th>
                <th className="pb-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {settlementPreviews.length ? (
                settlementPreviews.map((preview, index) => (
                  <tr
                    key={`${normalizeId(preview.businessId)}-${index}`}
                    className="border-t border-slate-100"
                  >
                    <td className="py-2">{String(preview.businessName || "-")}</td>
                    <td className="py-2">{formatMoney(preview.diffFeeTotal)}</td>
                    <td className="py-2">{String(preview.diffOrdersCount ?? "-")}</td>
                    <td className="py-2">{preview.storedExists ? "yes" : "no"}</td>
                    <td className="py-2">
                      {preview.integrityHashMatches === false ? (
                        <span className="mr-2 rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
                          INTEGRITY FAIL
                        </span>
                      ) : null}
                      <Link
                        href={`/admin/settlements/recompute?key=${encodeURIComponent(
                          key
                        )}&businessId=${encodeURIComponent(
                          normalizeId(preview.businessId)
                        )}&weekKey=${encodeURIComponent(currentWeekKey)}`}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold"
                        target="_blank"
                      >
                        Recompute
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-slate-500">
                    No mismatches found for this week.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ComplaintsPanel
        adminKey={key}
        complaints={complaints}
        fetchError={complaintsReq.ok ? "" : complaintsReq.error}
      />

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
