"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAdminLaunchMarket } from "@/app/admin/useAdminLaunchMarket";
import { formatDateTimeForProfile, formatMoneyForProfile } from "@/lib/marketFormatting";
import { getPayoutMethodLabel } from "@/lib/merchantOnboarding";

type CityRow = {
  _id: string;
  name?: string;
  code?: string;
};

type SettlementRow = {
  id: string;
  cityId?: string | null;
  merchantId: string;
  restaurantName: string;
  settlementDate: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  currency?: string;
  grossSales: number;
  platformCommission: number;
  deliveryFeesCollected: number;
  restaurantNet: number;
  orderCount: number;
  payoutMethod?: string;
  payoutAccountName?: string;
  payoutAccountNumber?: string;
  payoutNotes?: string;
  status: "pending" | "paid" | "failed" | "cancelled";
  paidAt?: string | null;
  paidBy?: string | null;
  payoutReference?: string;
  adminNote?: string;
};

type DriverPayoutRequestRow = {
  id: string;
  cityId?: string | null;
  driverId: string;
  driverName: string;
  currency?: string;
  requestedAmount: number;
  availableBalanceAtRequest: number;
  payoutMethod?: string;
  payoutAccountName?: string;
  payoutAccountNumber?: string;
  payoutNotes?: string;
  status: "requested" | "approved" | "paid" | "rejected" | "cancelled";
  deliveryCount: number;
  requestedAt?: string | null;
  approvedAt?: string | null;
  paidAt?: string | null;
  rejectedAt?: string | null;
  reviewedBy?: string | null;
  payoutReference?: string;
  adminNote?: string;
  rejectionReason?: string;
};

type SettlementModalState = {
  mode: "edit" | "mark_paid";
  row: SettlementRow;
  payoutMethod: string;
  payoutAccountName: string;
  payoutAccountNumber: string;
  payoutNotes: string;
  payoutReference: string;
  adminNote: string;
  status: string;
};

type DriverPayoutModalState = {
  mode: "edit" | "mark_paid";
  row: DriverPayoutRequestRow;
  payoutMethod: string;
  payoutAccountName: string;
  payoutAccountNumber: string;
  payoutNotes: string;
  payoutReference: string;
  adminNote: string;
};

type CitiesResponse = {
  ok?: boolean;
  cities?: CityRow[];
  error?: { message?: string } | string;
};

type RestaurantSettlementsResponse = {
  ok?: boolean;
  settlementDate?: string;
  rows?: SettlementRow[];
  error?: { message?: string } | string;
};

type DriverPayoutsResponse = {
  ok?: boolean;
  rows?: DriverPayoutRequestRow[];
  error?: { message?: string } | string;
};

const INPUT_CLASS =
  "w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#ff6b00] focus:ring-2 focus:ring-[#ff6b00]/15";

function todayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string" && error.trim()) return error;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return String((error as { message: string }).message);
  }
  return fallback;
}

function payoutTone(status: string) {
  switch (status) {
    case "paid":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "approved":
      return "bg-sky-50 text-sky-700 ring-sky-200";
    case "failed":
    case "rejected":
      return "bg-rose-50 text-rose-700 ring-rose-200";
    case "cancelled":
      return "bg-amber-50 text-amber-700 ring-amber-200";
    default:
      return "bg-slate-100 text-slate-700 ring-slate-200";
  }
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold uppercase ring-1 ${payoutTone(
        status
      )}`}
    >
      {status.replace(/_/g, " ")}
    </span>
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
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
      {children}
    </label>
  );
}

export default function AdminPayoutsPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [cityId, setCityId] = useState("");
  const [settlementDate, setSettlementDate] = useState(todayDateKey());
  const [settlementStatus, setSettlementStatus] = useState("");
  const [settlementSearch, setSettlementSearch] = useState("");
  const [driverStatus, setDriverStatus] = useState("");
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [driverPayouts, setDriverPayouts] = useState<DriverPayoutRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [settlementModal, setSettlementModal] = useState<SettlementModalState | null>(null);
  const [driverPayoutModal, setDriverPayoutModal] = useState<DriverPayoutModalState | null>(null);
  const market = useAdminLaunchMarket(authenticated);

  const settlementTotals = useMemo(
    () =>
      settlements.reduce(
        (summary, row) => {
          summary.grossSales += Number(row.grossSales || 0);
          summary.platformCommission += Number(row.platformCommission || 0);
          summary.restaurantNet += Number(row.restaurantNet || 0);
          summary.orderCount += Number(row.orderCount || 0);
          return summary;
        },
        { grossSales: 0, platformCommission: 0, restaurantNet: 0, orderCount: 0 }
      ),
    [settlements]
  );

  const driverTotals = useMemo(
    () =>
      driverPayouts.reduce(
        (summary, row) => {
          summary.requestedAmount += Number(row.requestedAmount || 0);
          summary.deliveryCount += Number(row.deliveryCount || 0);
          return summary;
        },
        { requestedAmount: 0, deliveryCount: 0 }
      ),
    [driverPayouts]
  );

  const selectedCity = useMemo(
    () => cities.find((city) => city._id === cityId) || null,
    [cities, cityId]
  );

  const formatMoney = (value: number | null | undefined) => formatMoneyForProfile(value, market);
  const formatDateTime = (value: string | null | undefined) =>
    formatDateTimeForProfile(value, market);

  async function loadCities() {
    const res = await fetch("/api/admin/cities", { cache: "no-store" });
    if (res.status === 401) {
      setAuthenticated(false);
      return;
    }
    const json = (await res.json().catch(() => null)) as CitiesResponse | null;
    if (!res.ok || !json?.ok || !Array.isArray(json.cities)) {
      throw new Error(pickError(json?.error, "Could not load admin cities."));
    }
    setCities(json.cities);
  }

  async function loadPayouts() {
    if (!authenticated) return;
    setLoading(true);
    setError("");
    try {
      const settlementParams = new URLSearchParams();
      if (settlementDate) settlementParams.set("date", settlementDate);
      if (settlementStatus) settlementParams.set("status", settlementStatus);
      if (cityId) settlementParams.set("cityId", cityId);
      if (settlementSearch.trim()) settlementParams.set("q", settlementSearch.trim());

      const driverParams = new URLSearchParams();
      if (driverStatus) driverParams.set("status", driverStatus);
      if (cityId) driverParams.set("cityId", cityId);
      driverParams.set("limit", "200");

      const [settlementsRes, driverPayoutsRes] = await Promise.all([
        fetch(`/api/admin/restaurant-settlements?${settlementParams.toString()}`, {
          cache: "no-store",
        }),
        fetch(`/api/admin/driver-payouts?${driverParams.toString()}`, {
          cache: "no-store",
        }),
      ]);

      if (settlementsRes.status === 401 || driverPayoutsRes.status === 401) {
        setAuthenticated(false);
        setSettlements([]);
        setDriverPayouts([]);
        return;
      }

      const [settlementsJson, driverPayoutsJson] = (await Promise.all([
        settlementsRes.json().catch(() => null),
        driverPayoutsRes.json().catch(() => null),
      ])) as [RestaurantSettlementsResponse | null, DriverPayoutsResponse | null];

      if (!settlementsRes.ok || !settlementsJson?.ok) {
        throw new Error(
          pickError(settlementsJson?.error, "Could not load restaurant settlements.")
        );
      }
      if (!driverPayoutsRes.ok || !driverPayoutsJson?.ok) {
        throw new Error(
          pickError(driverPayoutsJson?.error, "Could not load driver payout requests.")
        );
      }

      setSettlements(Array.isArray(settlementsJson.rows) ? settlementsJson.rows : []);
      setDriverPayouts(Array.isArray(driverPayoutsJson.rows) ? driverPayoutsJson.rows : []);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load payout operations."
      );
    } finally {
      setLoading(false);
    }
  }

  async function submitSettlementAction(
    rowId: string,
    payload: Record<string, unknown>,
    successMessage: string
  ) {
    setActionLoading(rowId);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/restaurant-settlements/${encodeURIComponent(rowId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not update restaurant settlement."));
      }
      setSuccess(successMessage);
      await loadPayouts();
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not update restaurant settlement."
      );
    } finally {
      setActionLoading("");
    }
  }

  async function submitDriverPayoutAction(
    rowId: string,
    payload: Record<string, unknown>,
    successMessage: string
  ) {
    setActionLoading(rowId);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/driver-payouts/${encodeURIComponent(rowId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not update driver payout request."));
      }
      setSuccess(successMessage);
      await loadPayouts();
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not update driver payout request."
      );
    } finally {
      setActionLoading("");
    }
  }

  function openSettlementEditor(row: SettlementRow, mode: "edit" | "mark_paid") {
    setSettlementModal({
      mode,
      row,
      payoutMethod: String(row.payoutMethod || "cash"),
      payoutAccountName: String(row.payoutAccountName || ""),
      payoutAccountNumber: String(row.payoutAccountNumber || ""),
      payoutNotes: String(row.payoutNotes || ""),
      payoutReference: String(row.payoutReference || ""),
      adminNote: String(row.adminNote || ""),
      status: String(row.status || "pending"),
    });
  }

  function openDriverPayoutEditor(row: DriverPayoutRequestRow, mode: "edit" | "mark_paid") {
    setDriverPayoutModal({
      mode,
      row,
      payoutMethod: String(row.payoutMethod || "cash"),
      payoutAccountName: String(row.payoutAccountName || ""),
      payoutAccountNumber: String(row.payoutAccountNumber || ""),
      payoutNotes: String(row.payoutNotes || ""),
      payoutReference: String(row.payoutReference || ""),
      adminNote: String(row.adminNote || ""),
    });
  }

  async function submitSettlementModal() {
    if (!settlementModal) return;
    if (
      settlementModal.mode === "mark_paid" &&
      !String(settlementModal.payoutReference || "").trim()
    ) {
      setError("Payout reference is required to mark a settlement paid.");
      return;
    }
    const payload =
      settlementModal.mode === "mark_paid"
        ? {
            action: "mark_paid",
            payoutReference: settlementModal.payoutReference,
            adminNote: settlementModal.adminNote,
          }
        : {
            action: "edit",
            payoutMethod: settlementModal.payoutMethod,
            payoutAccountName: settlementModal.payoutAccountName,
            payoutAccountNumber: settlementModal.payoutAccountNumber,
            payoutNotes: settlementModal.payoutNotes,
            payoutReference: settlementModal.payoutReference,
            adminNote: settlementModal.adminNote,
            status: settlementModal.status,
          };

    await submitSettlementAction(
      settlementModal.row.id,
      payload,
      settlementModal.mode === "mark_paid"
        ? "Restaurant settlement marked paid."
        : "Restaurant settlement updated."
    );
    setSettlementModal(null);
  }

  async function submitDriverPayoutModal() {
    if (!driverPayoutModal) return;
    if (
      driverPayoutModal.mode === "mark_paid" &&
      !String(driverPayoutModal.payoutReference || "").trim()
    ) {
      setError("Payout reference is required to mark a driver payout paid.");
      return;
    }
    const payload =
      driverPayoutModal.mode === "mark_paid"
        ? {
            action: "mark_paid",
            payoutReference: driverPayoutModal.payoutReference,
            adminNote: driverPayoutModal.adminNote,
          }
        : {
            action: "edit",
            payoutMethod: driverPayoutModal.payoutMethod,
            payoutAccountName: driverPayoutModal.payoutAccountName,
            payoutAccountNumber: driverPayoutModal.payoutAccountNumber,
            payoutNotes: driverPayoutModal.payoutNotes,
            payoutReference: driverPayoutModal.payoutReference,
            adminNote: driverPayoutModal.adminNote,
          };

    await submitDriverPayoutAction(
      driverPayoutModal.row.id,
      payload,
      driverPayoutModal.mode === "mark_paid"
        ? "Driver payout marked paid."
        : "Driver payout request updated."
    );
    setDriverPayoutModal(null);
  }

  async function rejectDriverPayout(row: DriverPayoutRequestRow) {
    const reason = window.prompt("Rejection reason", "") || "";
    if (!reason.trim()) {
      setError("Rejection reason is required.");
      return;
    }
    await submitDriverPayoutAction(
      row.id,
      { action: "reject", rejectionReason: reason },
      "Driver payout request rejected."
    );
  }

  async function archiveDriverPayout(row: DriverPayoutRequestRow) {
    if (!window.confirm(`Archive payout request for ${row.driverName}?`)) return;
    const reason = window.prompt("Archive reason (optional)", "") || "";
    await submitDriverPayoutAction(
      row.id,
      { action: "archive", reason },
      "Driver payout request archived."
    );
  }

  async function archiveSettlement(row: SettlementRow) {
    if (!window.confirm(`Archive settlement for ${row.restaurantName}?`)) return;
    const reason = window.prompt("Archive reason (optional)", "") || "";
    await submitSettlementAction(
      row.id,
      { action: "archive", reason },
      "Restaurant settlement archived."
    );
  }

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const res = await fetch("/api/admin/session", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { authenticated?: boolean } | null;
        const allowed = Boolean(res.ok && json?.authenticated);
        if (!active) return;
        setAuthenticated(allowed);
        if (!allowed) return;
        await loadCities();
      } catch {
        if (!active) return;
        setAuthenticated(false);
      }
    }

    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    void loadPayouts();
  }, [authenticated, cityId, settlementDate, settlementStatus, settlementSearch, driverStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  if (authenticated === null) {
    return (
      <main className="mx-auto min-h-screen max-w-7xl p-6">
        <h1 className="text-2xl font-bold">Payout Operations</h1>
        <p className="mt-2 text-sm text-slate-600">Checking secure admin session...</p>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="mx-auto min-h-screen max-w-7xl p-6">
        <h1 className="text-2xl font-bold">Payout Operations</h1>
        <p className="mt-2 text-sm text-red-600">
          Admin access requires a secure browser session.
        </p>
        <Link
          href="/admin/access?next=/admin/payouts"
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.14),_transparent_34%),linear-gradient(180deg,#fffaf4_0%,#f8fafc_44%,#eef2ff_100%)]">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-[32px] border border-slate-200/70 bg-white/90 shadow-[0_24px_80px_rgba(15,23,42,0.10)] backdrop-blur">
          <div className="border-b border-slate-200/80 bg-[linear-gradient(135deg,#fff7ed_0%,#ffffff_48%,#eff6ff_100%)] px-6 py-7 sm:px-8">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex rounded-full border border-amber-200 bg-white/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-700">
                  Finance Operations
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                  OranjeEats Payout Operations
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                  Track restaurant daily settlements and driver payout requests without touching
                  customer payment state. PayTech remains the inbound customer payment rail; this
                  workspace is for manual outbound payouts only.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:w-[360px]">
                <div className="rounded-3xl border border-slate-200 bg-white/85 p-4 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                    City scope
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">
                    {selectedCity?.name || "All cities"}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {selectedCity?.code
                      ? String(selectedCity.code).toUpperCase()
                      : "Cross-city finance view"}
                  </p>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-950 p-4 text-white shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-300">
                    Settlement date
                  </p>
                  <p className="mt-2 text-2xl font-semibold">{settlementDate || todayDateKey()}</p>
                  <p className="mt-1 text-sm text-slate-300">
                    Daily merchant settlements are generated per merchant per day.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadPayouts()}
                  disabled={loading}
                  className="inline-flex items-center justify-center rounded-2xl bg-[#ff6b00] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e85f00] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Refreshing..." : "Refresh payouts"}
                </button>
                <Link
                  href="/admin"
                  className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
                >
                  Back to dashboard
                </Link>
              </div>
            </div>

            {error ? (
              <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}
            {success ? (
              <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {success}
              </div>
            ) : null}
          </div>

          <div className="px-6 py-6 sm:px-8">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <article className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-medium text-slate-500">Settlement gross sales</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                  {formatMoney(settlementTotals.grossSales)}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {settlementTotals.orderCount} settled orders in the selected day.
                </p>
              </article>
              <article className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-medium text-slate-500">Platform commission</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                  {formatMoney(settlementTotals.platformCommission)}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  Paid or completed eligible orders only. Unpaid PayTech orders are excluded.
                </p>
              </article>
              <article className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-medium text-slate-500">Restaurant net total</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                  {formatMoney(settlementTotals.restaurantNet)}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  Manual payout only. Nothing here is paid automatically.
                </p>
              </article>
              <article className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-medium text-slate-500">Driver payout requests</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                  {formatMoney(driverTotals.requestedAmount)}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {driverTotals.deliveryCount} deliveries included in the visible request list.
                </p>
              </article>
            </section>

            <section className="mt-6 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <SectionHeading
                eyebrow="Filters"
                title="Payout scope and date"
                description="Restaurant settlements are daily. Driver payout requests are open-ended but can be narrowed by city and status."
              />
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <div>
                  <FieldLabel>City</FieldLabel>
                  <select
                    value={cityId}
                    onChange={(event) => setCityId(event.target.value)}
                    className={`${INPUT_CLASS} mt-2`}
                  >
                    <option value="">All cities</option>
                    {cities.map((city) => (
                      <option key={city._id} value={city._id}>
                        {(city.code || "").toUpperCase()} {city.name ? `- ${city.name}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <FieldLabel>Settlement date</FieldLabel>
                  <input
                    type="date"
                    value={settlementDate}
                    onChange={(event) => setSettlementDate(event.target.value)}
                    className={`${INPUT_CLASS} mt-2`}
                  />
                </div>
                <div>
                  <FieldLabel>Settlement status</FieldLabel>
                  <select
                    value={settlementStatus}
                    onChange={(event) => setSettlementStatus(event.target.value)}
                    className={`${INPUT_CLASS} mt-2`}
                  >
                    <option value="">Any status</option>
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                    <option value="failed">Failed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <FieldLabel>Driver payout status</FieldLabel>
                  <select
                    value={driverStatus}
                    onChange={(event) => setDriverStatus(event.target.value)}
                    className={`${INPUT_CLASS} mt-2`}
                  >
                    <option value="">Any status</option>
                    <option value="requested">Requested</option>
                    <option value="approved">Approved</option>
                    <option value="paid">Paid</option>
                    <option value="rejected">Rejected</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <FieldLabel>Restaurant search</FieldLabel>
                  <input
                    value={settlementSearch}
                    onChange={(event) => setSettlementSearch(event.target.value)}
                    placeholder="Restaurant name"
                    className={`${INPUT_CLASS} mt-2`}
                  />
                </div>
              </div>
            </section>

            <section
              id="restaurant-settlements"
              className="mt-6 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
            >
              <SectionHeading
                eyebrow="Restaurant settlements"
                title="Daily merchant settlement summary"
                description="One merchant per day. The summary is built from eligible delivered orders and never marks itself paid automatically."
              />
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="pb-3 pr-4 font-semibold">Restaurant</th>
                      <th className="pb-3 pr-4 font-semibold">Date</th>
                      <th className="pb-3 pr-4 font-semibold">Gross sales</th>
                      <th className="pb-3 pr-4 font-semibold">Platform fee</th>
                      <th className="pb-3 pr-4 font-semibold">Net amount</th>
                      <th className="pb-3 pr-4 font-semibold">Payout account</th>
                      <th className="pb-3 pr-4 font-semibold">Status</th>
                      <th className="pb-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settlements.length ? (
                      settlements.map((row) => (
                        <tr key={row.id} className="border-t border-slate-100 align-top">
                          <td className="py-3 pr-4">
                            <div className="font-semibold text-slate-950">{row.restaurantName}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              Orders: {row.orderCount} | Merchant: {row.merchantId}
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-xs text-slate-600">
                            <div>{row.settlementDate}</div>
                            <div className="mt-1">
                              {row.periodStart ? formatDateTime(row.periodStart) : "-"} to{" "}
                              {row.periodEnd ? formatDateTime(row.periodEnd) : "-"}
                            </div>
                          </td>
                          <td className="py-3 pr-4 font-semibold text-slate-950">
                            {formatMoney(row.grossSales)}
                          </td>
                          <td className="py-3 pr-4">{formatMoney(row.platformCommission)}</td>
                          <td className="py-3 pr-4 font-semibold text-emerald-700">
                            {formatMoney(row.restaurantNet)}
                          </td>
                          <td className="py-3 pr-4">
                            <div>{getPayoutMethodLabel(row.payoutMethod)}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {row.payoutAccountName || "-"}
                            </div>
                            <div className="text-xs text-slate-500">
                              {row.payoutAccountNumber || "-"}
                            </div>
                          </td>
                          <td className="py-3 pr-4">
                            <StatusBadge status={row.status} />
                            {row.payoutReference ? (
                              <div className="mt-2 text-xs text-slate-500">
                                Ref: {row.payoutReference}
                              </div>
                            ) : null}
                          </td>
                          <td className="py-3">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => openSettlementEditor(row, "mark_paid")}
                                disabled={Boolean(actionLoading) || row.status === "paid"}
                                className="rounded-2xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 disabled:opacity-50"
                              >
                                Mark paid
                              </button>
                              <button
                                type="button"
                                onClick={() => openSettlementEditor(row, "edit")}
                                disabled={Boolean(actionLoading)}
                                className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void archiveSettlement(row)}
                                disabled={Boolean(actionLoading)}
                                className="rounded-2xl border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50"
                              >
                                Archive
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-500">
                          No restaurant settlements found for the selected date.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section
              id="driver-payout-requests"
              className="mt-6 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
            >
              <SectionHeading
                eyebrow="Driver payouts"
                title="Driver payout request workflow"
                description="Drivers request payout from earned delivery balance. Admin approves, pays manually, then records the payout reference."
              />
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="pb-3 pr-4 font-semibold">Driver</th>
                      <th className="pb-3 pr-4 font-semibold">Requested amount</th>
                      <th className="pb-3 pr-4 font-semibold">Deliveries</th>
                      <th className="pb-3 pr-4 font-semibold">Method</th>
                      <th className="pb-3 pr-4 font-semibold">Requested</th>
                      <th className="pb-3 pr-4 font-semibold">Status</th>
                      <th className="pb-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {driverPayouts.length ? (
                      driverPayouts.map((row) => (
                        <tr key={row.id} className="border-t border-slate-100 align-top">
                          <td className="py-3 pr-4">
                            <div className="font-semibold text-slate-950">{row.driverName}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              Driver ID: {row.driverId}
                            </div>
                            {row.rejectionReason ? (
                              <div className="mt-2 text-xs text-rose-700">
                                Rejection: {row.rejectionReason}
                              </div>
                            ) : null}
                          </td>
                          <td className="py-3 pr-4 font-semibold text-slate-950">
                            <div>{formatMoney(row.requestedAmount)}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              Available at request: {formatMoney(row.availableBalanceAtRequest)}
                            </div>
                          </td>
                          <td className="py-3 pr-4">{row.deliveryCount}</td>
                          <td className="py-3 pr-4">
                            <div>{getPayoutMethodLabel(row.payoutMethod)}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {row.payoutAccountName || "-"}
                            </div>
                            <div className="text-xs text-slate-500">
                              {row.payoutAccountNumber || "-"}
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-xs text-slate-600">
                            {formatDateTime(row.requestedAt || null)}
                          </td>
                          <td className="py-3 pr-4">
                            <StatusBadge status={row.status} />
                            {row.payoutReference ? (
                              <div className="mt-2 text-xs text-slate-500">
                                Ref: {row.payoutReference}
                              </div>
                            ) : null}
                          </td>
                          <td className="py-3">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  void submitDriverPayoutAction(
                                    row.id,
                                    { action: "approve" },
                                    "Driver payout request approved."
                                  )
                                }
                                disabled={Boolean(actionLoading) || row.status !== "requested"}
                                className="rounded-2xl border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 disabled:opacity-50"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => openDriverPayoutEditor(row, "mark_paid")}
                                disabled={Boolean(actionLoading) || row.status === "paid"}
                                className="rounded-2xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 disabled:opacity-50"
                              >
                                Mark paid
                              </button>
                              <button
                                type="button"
                                onClick={() => void rejectDriverPayout(row)}
                                disabled={Boolean(actionLoading) || row.status === "paid"}
                                className="rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-50"
                              >
                                Reject
                              </button>
                              <button
                                type="button"
                                onClick={() => openDriverPayoutEditor(row, "edit")}
                                disabled={Boolean(actionLoading)}
                                className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void submitDriverPayoutAction(
                                    row.id,
                                    { action: "cancel" },
                                    "Driver payout request cancelled."
                                  )
                                }
                                disabled={Boolean(actionLoading) || row.status === "paid"}
                                className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => void archiveDriverPayout(row)}
                                disabled={Boolean(actionLoading)}
                                className="rounded-2xl border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50"
                              >
                                Archive
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500">
                          No driver payout requests found for the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </section>
      </div>

      {settlementModal ? (
        <SettlementModal
          state={settlementModal}
          onClose={() => setSettlementModal(null)}
          onChange={setSettlementModal}
          onSubmit={() => void submitSettlementModal()}
          submitting={Boolean(actionLoading)}
        />
      ) : null}

      {driverPayoutModal ? (
        <DriverPayoutModal
          state={driverPayoutModal}
          onClose={() => setDriverPayoutModal(null)}
          onChange={setDriverPayoutModal}
          onSubmit={() => void submitDriverPayoutModal()}
          submitting={Boolean(actionLoading)}
        />
      ) : null}
    </main>
  );
}

function SettlementModal({
  state,
  onClose,
  onChange,
  onSubmit,
  submitting,
}: {
  state: SettlementModalState;
  onClose: () => void;
  onChange: (next: SettlementModalState | null) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6">
      <div className="w-full max-w-2xl rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.25)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Restaurant settlement
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">
              {state.mode === "mark_paid" ? "Mark settlement paid" : "Edit settlement"}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {state.row.restaurantName} · {state.row.settlementDate}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
          >
            Close
          </button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {state.mode === "edit" ? (
            <>
              <div>
                <FieldLabel>Payout method</FieldLabel>
                <select
                  value={state.payoutMethod}
                  onChange={(event) => onChange({ ...state, payoutMethod: event.target.value })}
                  className={`${INPUT_CLASS} mt-2`}
                >
                  <option value="orange_money">Orange Money</option>
                  <option value="moov_money">Moov Money</option>
                  <option value="wave">Wave</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cash">Cash</option>
                </select>
              </div>
              <div>
                <FieldLabel>Status</FieldLabel>
                <select
                  value={state.status}
                  onChange={(event) => onChange({ ...state, status: event.target.value })}
                  className={`${INPUT_CLASS} mt-2`}
                >
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                  <option value="failed">Failed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div>
                <FieldLabel>Account holder name</FieldLabel>
                <input
                  value={state.payoutAccountName}
                  onChange={(event) => onChange({ ...state, payoutAccountName: event.target.value })}
                  className={`${INPUT_CLASS} mt-2`}
                />
              </div>
              <div>
                <FieldLabel>Payout account / phone</FieldLabel>
                <input
                  value={state.payoutAccountNumber}
                  onChange={(event) => onChange({ ...state, payoutAccountNumber: event.target.value })}
                  className={`${INPUT_CLASS} mt-2`}
                />
              </div>
              <div className="md:col-span-2">
                <FieldLabel>Payout notes</FieldLabel>
                <textarea
                  value={state.payoutNotes}
                  onChange={(event) => onChange({ ...state, payoutNotes: event.target.value })}
                  rows={3}
                  className={`${INPUT_CLASS} mt-2`}
                />
              </div>
            </>
          ) : null}

          <div>
            <FieldLabel>Payout reference</FieldLabel>
            <input
              value={state.payoutReference}
              onChange={(event) => onChange({ ...state, payoutReference: event.target.value })}
              className={`${INPUT_CLASS} mt-2`}
            />
          </div>
          <div>
            <FieldLabel>Admin note</FieldLabel>
            <textarea
              value={state.adminNote}
              onChange={(event) => onChange({ ...state, adminNote: event.target.value })}
              rows={3}
              className={`${INPUT_CLASS} mt-2`}
            />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="rounded-2xl bg-[#ff6b00] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {state.mode === "mark_paid" ? "Confirm paid" : "Save settlement"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DriverPayoutModal({
  state,
  onClose,
  onChange,
  onSubmit,
  submitting,
}: {
  state: DriverPayoutModalState;
  onClose: () => void;
  onChange: (next: DriverPayoutModalState | null) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6">
      <div className="w-full max-w-2xl rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.25)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Driver payout request
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">
              {state.mode === "mark_paid" ? "Mark driver payout paid" : "Edit driver payout request"}
            </h2>
            <p className="mt-2 text-sm text-slate-600">{state.row.driverName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
          >
            Close
          </button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {state.mode === "edit" ? (
            <>
              <div>
                <FieldLabel>Payout method</FieldLabel>
                <select
                  value={state.payoutMethod}
                  onChange={(event) => onChange({ ...state, payoutMethod: event.target.value })}
                  className={`${INPUT_CLASS} mt-2`}
                >
                  <option value="orange_money">Orange Money</option>
                  <option value="moov_money">Moov Money</option>
                  <option value="wave">Wave</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cash">Cash</option>
                </select>
              </div>
              <div>
                <FieldLabel>Account holder name</FieldLabel>
                <input
                  value={state.payoutAccountName}
                  onChange={(event) => onChange({ ...state, payoutAccountName: event.target.value })}
                  className={`${INPUT_CLASS} mt-2`}
                />
              </div>
              <div>
                <FieldLabel>Payout account / phone</FieldLabel>
                <input
                  value={state.payoutAccountNumber}
                  onChange={(event) => onChange({ ...state, payoutAccountNumber: event.target.value })}
                  className={`${INPUT_CLASS} mt-2`}
                />
              </div>
              <div>
                <FieldLabel>Payout notes</FieldLabel>
                <textarea
                  value={state.payoutNotes}
                  onChange={(event) => onChange({ ...state, payoutNotes: event.target.value })}
                  rows={3}
                  className={`${INPUT_CLASS} mt-2`}
                />
              </div>
            </>
          ) : null}

          <div>
            <FieldLabel>Payout reference</FieldLabel>
            <input
              value={state.payoutReference}
              onChange={(event) => onChange({ ...state, payoutReference: event.target.value })}
              className={`${INPUT_CLASS} mt-2`}
            />
          </div>
          <div>
            <FieldLabel>Admin note</FieldLabel>
            <textarea
              value={state.adminNote}
              onChange={(event) => onChange({ ...state, adminNote: event.target.value })}
              rows={3}
              className={`${INPUT_CLASS} mt-2`}
            />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="rounded-2xl bg-[#ff6b00] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {state.mode === "mark_paid" ? "Confirm paid" : "Save payout request"}
          </button>
        </div>
      </div>
    </div>
  );
}
