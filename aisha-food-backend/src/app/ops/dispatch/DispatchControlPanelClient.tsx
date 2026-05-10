"use client";

import { useEffect, useState } from "react";
import { getMarketConfig } from "@/lib/marketConfig";

type CityRow = {
  _id: string;
  code?: string;
  slug?: string;
  name?: string;
  country?: string;
  currency?: string;
  supportWhatsAppE164?: string;
  paymentMethods?: string[];
  isActive?: boolean;
};

type DispatchStatusFilter = "all" | "accepted" | "preparing" | "ready" | "out_for_delivery";

type DispatchOrderRow = {
  orderId: string;
  orderNumber: string;
  businessId?: string | null;
  businessName: string;
  customerName?: string;
  phone?: string | null;
  address: string;
  status: "accepted" | "preparing" | "ready" | "out_for_delivery";
  createdAt?: string | null;
  deliveryFeeToCustomer?: number;
  total: number;
  driverDispatchStatus?: string | null;
  currentOfferDriverId?: string | null;
  offerExpiresAt?: string | null;
  assignedDriverId?: string | null;
  assignedDriverName?: string | null;
  assignedAt?: string | null;
  zoneLabel?: string | null;
  suggestedDriverId?: string | null;
  suggestedScore?: number | null;
  suggestedEtaMinutes?: number | null;
};

type DriverRow = {
  driverId: string;
  name: string;
  phone?: string | null;
  zoneLabel?: string | null;
  isActive: boolean;
  isBanned?: boolean;
  availability?: string;
  lastAssignedAt?: string | null;
  lastDeliveryConfirmedAt?: string | null;
  activeLoad?: number;
};

type HistoryRow = {
  id: string;
  orderId?: string | null;
  action: string;
  actor: string;
  meta?: Record<string, unknown> | null;
  createdAt?: string | null;
};

type ApiErrorShape = { message?: string };

type OrdersResponse = {
  ok?: boolean;
  total?: number;
  rows?: DispatchOrderRow[];
  error?: ApiErrorShape | string;
};

type DriversResponse = {
  ok?: boolean;
  rows?: DriverRow[];
  error?: ApiErrorShape | string;
};

type QueueSuggestionRow = {
  orderId: string;
  zoneLabel?: string | null;
  suggestedDriverId?: string | null;
  suggestedScore?: number | null;
  suggestedEtaMinutes?: number | null;
};

type QueueResponse = {
  ok?: boolean;
  rows?: QueueSuggestionRow[];
  error?: ApiErrorShape | string;
};

type HistoryResponse = {
  ok?: boolean;
  rows?: HistoryRow[];
  error?: ApiErrorShape | string;
};

type CitiesResponse = {
  ok?: boolean;
  cities?: CityRow[];
  error?: ApiErrorShape | string;
};

type MutationResponse = {
  ok?: boolean;
  assigned?: boolean;
  reassigned?: boolean;
  idempotent?: boolean;
  driverId?: string;
  reason?: string;
  score?: number;
  etaMinutes?: number;
  error?: ApiErrorShape | string;
};

type DriverStatsResponse = {
  ok?: boolean;
  availableDrivers?: number;
  busyDrivers?: number;
  offlineDrivers?: number;
  totalDrivers?: number;
  error?: ApiErrorShape | string;
};

type WhatsAppTemplateResponse = {
  ok?: boolean;
  city?: { code?: string; name?: string };
  driverLinkUrl?: string;
  messageText?: string;
  error?: ApiErrorShape | string;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as ApiErrorShape).message || fallback);
  }
  return fallback;
}

function formatMoney(value: number, currencyCode: string) {
  return `${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ${String(currencyCode || "DOP").toUpperCase()}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function formatAvailability(value?: string | null) {
  const normalized = String(value || "offline").trim().toLowerCase();
  if (normalized === "available") return "available";
  if (normalized === "busy") return "busy";
  return "offline";
}

function formatDispatchState(order?: DispatchOrderRow | null) {
  const state = String(order?.driverDispatchStatus || "").trim();
  if (state === "offering_to_driver") return "Offering to driver";
  if (state === "waiting_for_driver") return "Waiting for driver";
  if (state === "no_driver_available" || state === "needs_manual_dispatch") {
    return "Needs manual dispatch";
  }
  if (state === "driver_assigned" || state === "driver_accepted") return "Driver assigned";
  if (order?.assignedDriverId) return "Assigned";
  return "Dispatch pending";
}

function renderHistoryMeta(meta?: Record<string, unknown> | null) {
  if (!meta) return "-";
  const parts: string[] = [];
  const note = String(meta.note || "").trim();
  const driverId = String(meta.driverId || meta.selectedDriverId || "").trim();
  const previousDriverId = String(meta.previousDriverId || "").trim();
  const newDriverId = String(meta.newDriverId || "").trim();
  const reason = String(meta.reason || "").trim();
  if (note) parts.push(`note: ${note}`);
  if (driverId) parts.push(`driver: ${driverId}`);
  if (previousDriverId) parts.push(`previous: ${previousDriverId}`);
  if (newDriverId) parts.push(`new: ${newDriverId}`);
  if (reason) parts.push(`reason: ${reason}`);
  if (meta.etaMinutes != null) parts.push(`eta: ${Number(meta.etaMinutes || 0)}m`);
  if (meta.score != null) parts.push(`score: ${Number(meta.score || 0)}`);
  return parts.join(" | ") || "-";
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(String(value || ""));
}

function SummaryCard({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className: string;
}) {
  return (
    <article className={`rounded-xl border p-4 ${className}`}>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </article>
  );
}

export default function DispatchControlPanelClient({
  adminKey,
  initialCityId,
}: {
  adminKey: string;
  initialCityId: string;
}) {
  const [cities, setCities] = useState<CityRow[]>([]);
  const [cityId, setCityId] = useState(initialCityId);
  const [statusFilter, setStatusFilter] = useState<DispatchStatusFilter>("all");
  const [unassignedOrders, setUnassignedOrders] = useState<DispatchOrderRow[]>([]);
  const [assignedOrders, setAssignedOrders] = useState<DispatchOrderRow[]>([]);
  const [unassignedTotal, setUnassignedTotal] = useState(0);
  const [assignedTotal, setAssignedTotal] = useState(0);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [driverStats, setDriverStats] = useState({
    availableDrivers: 0,
    busyDrivers: 0,
    offlineDrivers: 0,
    totalDrivers: 0,
  });
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [autoDispatchEnabled, setAutoDispatchEnabled] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [accessNotice, setAccessNotice] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [note, setNote] = useState("");
  const [whatsAppTemplate, setWhatsAppTemplate] = useState<WhatsAppTemplateResponse | null>(null);

  const selectedCity = cities.find((row) => String(row._id) === String(cityId)) || null;
  const selectedMarket = getMarketConfig(selectedCity);
  const currencyCode = String(selectedCity?.currency || "DOP");
  const allOrders = [...unassignedOrders, ...assignedOrders];
  const selectedOrder = allOrders.find((row) => row.orderId === selectedOrderId) || null;
  const selectedDriver = drivers.find((row) => row.driverId === selectedDriverId) || null;

  function buildAdminHeaders() {
    const headers: Record<string, string> = {};
    if (adminKey) {
      headers["x-admin-key"] = adminKey;
    }
    return headers;
  }

  function findDriver(driverId?: string | null, list = drivers) {
    return list.find((row) => row.driverId === String(driverId || "")) || null;
  }

  async function loadCities() {
    const res = await fetch(`/api/admin/cities`, {
      cache: "no-store",
      headers: buildAdminHeaders(),
    });
    const json = (await res.json().catch(() => null)) as CitiesResponse | null;
    if (!res.ok || !json?.ok) {
      throw new Error(pickError(json?.error, "Could not load cities."));
    }
    const activeCities = (Array.isArray(json.cities) ? json.cities : []).filter(
      (row) => row.isActive !== false
    );
    setCities(activeCities);
    if (!cityId && activeCities.length) {
      setCityId(String(activeCities[0]?._id || ""));
    }
  }

  async function loadData(nextCityId = cityId, nextStatus = statusFilter) {
    if (!nextCityId) return;
    setLoading(true);
    setError("");
    try {
      const baseParams = new URLSearchParams({
        cityId: nextCityId,
        status: nextStatus,
      });
      const cityParams = new URLSearchParams({ cityId: nextCityId });
      const historyParams = new URLSearchParams({ cityId: nextCityId, limit: "12" });
      const queueParams = new URLSearchParams({ cityId: nextCityId, limit: "50" });

      const [unassignedRes, assignedRes, driversRes, historyRes, statsRes, queueRes] =
        await Promise.all([
          fetch(`/api/ops/dispatch/unassigned?${baseParams.toString()}`, {
            cache: "no-store",
            headers: buildAdminHeaders(),
          }),
          fetch(`/api/ops/dispatch/assigned?${baseParams.toString()}`, {
            cache: "no-store",
            headers: buildAdminHeaders(),
          }),
          fetch(`/api/ops/dispatch/drivers?${cityParams.toString()}`, {
            cache: "no-store",
            headers: buildAdminHeaders(),
          }),
          fetch(`/api/ops/dispatch/history?${historyParams.toString()}`, {
            cache: "no-store",
            headers: buildAdminHeaders(),
          }),
          fetch(`/api/ops/dispatch/driver-stats?${cityParams.toString()}`, {
            cache: "no-store",
            headers: buildAdminHeaders(),
          }),
          fetch(`/api/ops/dispatch/auto-assign-queue?${queueParams.toString()}`, {
            cache: "no-store",
            headers: buildAdminHeaders(),
          }),
        ]);

      const [unassignedJson, assignedJson, driversJson, historyJson, statsJson, queueJson] =
        await Promise.all([
          unassignedRes.json().catch(() => null) as Promise<OrdersResponse | null>,
          assignedRes.json().catch(() => null) as Promise<OrdersResponse | null>,
          driversRes.json().catch(() => null) as Promise<DriversResponse | null>,
          historyRes.json().catch(() => null) as Promise<HistoryResponse | null>,
          statsRes.json().catch(() => null) as Promise<DriverStatsResponse | null>,
          queueRes.json().catch(() => null) as Promise<QueueResponse | null>,
        ]);

      if (!unassignedRes.ok || !unassignedJson?.ok) {
        throw new Error(pickError(unassignedJson?.error, "Could not load unassigned orders."));
      }
      if (!assignedRes.ok || !assignedJson?.ok) {
        throw new Error(pickError(assignedJson?.error, "Could not load assigned orders."));
      }
      if (!driversRes.ok || !driversJson?.ok) {
        throw new Error(pickError(driversJson?.error, "Could not load drivers."));
      }
      if (!historyRes.ok || !historyJson?.ok) {
        throw new Error(pickError(historyJson?.error, "Could not load history."));
      }
      if (!statsRes.ok || !statsJson?.ok) {
        throw new Error(pickError(statsJson?.error, "Could not load driver stats."));
      }
      if (!queueRes.ok || !queueJson?.ok) {
        throw new Error(pickError(queueJson?.error, "Could not load auto-assign queue."));
      }

      const nextDrivers = Array.isArray(driversJson.rows) ? driversJson.rows : [];
      const suggestionMap = new Map(
        (Array.isArray(queueJson.rows) ? queueJson.rows : []).map((row) => [row.orderId, row])
      );
      const nextUnassigned = (Array.isArray(unassignedJson.rows) ? unassignedJson.rows : []).map(
        (row) => {
          const suggestion = suggestionMap.get(row.orderId);
          return {
            ...row,
            zoneLabel: suggestion?.zoneLabel ?? row.zoneLabel ?? null,
            suggestedDriverId: suggestion?.suggestedDriverId ?? null,
            suggestedScore:
              suggestion?.suggestedScore == null ? null : Number(suggestion.suggestedScore),
            suggestedEtaMinutes:
              suggestion?.suggestedEtaMinutes == null
                ? null
                : Number(suggestion.suggestedEtaMinutes),
          };
        }
      );
      const nextAssigned = Array.isArray(assignedJson.rows) ? assignedJson.rows : [];
      const combined = [...nextUnassigned, ...nextAssigned];
      const nextSelectedOrder =
        combined.find((row) => row.orderId === selectedOrderId) || combined[0] || null;
      const nextSelectedDriver =
        findDriver(selectedDriverId, nextDrivers) ||
        findDriver(nextSelectedOrder?.assignedDriverId || nextSelectedOrder?.suggestedDriverId, nextDrivers) ||
        nextDrivers[0] ||
        null;

      setUnassignedOrders(nextUnassigned);
      setAssignedOrders(nextAssigned);
      setUnassignedTotal(Number(unassignedJson.total || nextUnassigned.length));
      setAssignedTotal(Number(assignedJson.total || nextAssigned.length));
      setDrivers(nextDrivers);
      setHistoryRows(Array.isArray(historyJson.rows) ? historyJson.rows : []);
      setDriverStats({
        availableDrivers: Number(statsJson.availableDrivers || 0),
        busyDrivers: Number(statsJson.busyDrivers || 0),
        offlineDrivers: Number(statsJson.offlineDrivers || 0),
        totalDrivers: Number(statsJson.totalDrivers || 0),
      });
      setSelectedOrderId(nextSelectedOrder?.orderId || "");
      setSelectedDriverId(nextSelectedDriver?.driverId || "");
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not load dispatch panel.");
      setUnassignedOrders([]);
      setAssignedOrders([]);
      setUnassignedTotal(0);
      setAssignedTotal(0);
      setDrivers([]);
      setHistoryRows([]);
      setDriverStats({ availableDrivers: 0, busyDrivers: 0, offlineDrivers: 0, totalDrivers: 0 });
    } finally {
      setLoading(false);
    }
  }

  async function loadWhatsAppTemplate(orderId: string) {
    const res = await fetch(`/api/ops/dispatch/whatsapp-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...buildAdminHeaders() },
      body: JSON.stringify({ orderId }),
    });
    const json = (await res.json().catch(() => null)) as WhatsAppTemplateResponse | null;
    if (!res.ok || !json?.ok) {
      throw new Error(pickError(json?.error, "Could not build WhatsApp template."));
    }
    setWhatsAppTemplate(json);
  }

  function selectOrder(order: DispatchOrderRow) {
    setSelectedOrderId(order.orderId);
    setSelectedDriverId(
      String(order.assignedDriverId || order.suggestedDriverId || selectedDriverId || "").trim()
    );
    setError("");
    setSuccess("");
    setWhatsAppTemplate(null);
  }

  async function mutateAssignment(route: "assign" | "reassign") {
    if (!cityId || !selectedOrder || !selectedDriverId) {
      setError("Select a city, order, and driver first.");
      return;
    }

    setActionLoading(route);
    setError("");
    setSuccess("");

    try {
      const res = await fetch(`/api/ops/dispatch/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAdminHeaders() },
        body: JSON.stringify({
          cityId,
          orderId: selectedOrder.orderId,
          driverId: selectedDriverId,
          note: note || undefined,
        }),
      });
      const json = (await res.json().catch(() => null)) as MutationResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not save assignment."));
      }
      try {
        await loadWhatsAppTemplate(selectedOrder.orderId);
      } catch {
        setWhatsAppTemplate(null);
      }
      setSuccess(
        json.idempotent
          ? "Assignment unchanged."
          : route === "reassign"
          ? "Driver reassigned."
          : "Driver assigned."
      );
      setNote("");
      await loadData(cityId, statusFilter);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not save assignment.");
    } finally {
      setActionLoading("");
    }
  }

  async function autoAssign(order: DispatchOrderRow) {
    if (!cityId) {
      setError("Select a city first.");
      return;
    }
    if (!autoDispatchEnabled) {
      setError("Enable auto dispatch before running auto-assign.");
      return;
    }

    setActionLoading(`auto:${order.orderId}`);
    setError("");
    setSuccess("");

    try {
      const res = await fetch(`/api/ops/dispatch/auto-assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAdminHeaders() },
        body: JSON.stringify({
          cityId,
          orderId: order.orderId,
          note: note || undefined,
        }),
      });
      const json = (await res.json().catch(() => null)) as MutationResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not auto-assign order."));
      }
      if (json.assigned || json.idempotent) {
        try {
          await loadWhatsAppTemplate(order.orderId);
        } catch {
          setWhatsAppTemplate(null);
        }
      } else {
        setWhatsAppTemplate(null);
      }
      setSuccess(
        json.assigned
          ? "Driver auto-assigned."
          : json.idempotent
          ? "Best driver already assigned."
          : json.reason === "NO_AVAILABLE_DRIVER"
          ? "No available driver for this order."
          : "Auto-assign completed."
      );
      await loadData(cityId, statusFilter);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not auto-assign order.");
    } finally {
      setActionLoading("");
    }
  }

  async function autoAssignAll() {
    if (!cityId || !unassignedOrders.length) {
      setError("No unassigned orders to auto-assign.");
      return;
    }
    if (!autoDispatchEnabled) {
      setError("Enable auto dispatch before running Auto Assign All.");
      return;
    }

    setBulkLoading(true);
    setError("");
    setSuccess("");

    let assignedCount = 0;
    let unchangedCount = 0;
    let noDriverCount = 0;
    let lastTemplateOrderId = "";

    try {
      for (const order of unassignedOrders) {
        const res = await fetch(`/api/ops/dispatch/auto-assign`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...buildAdminHeaders() },
          body: JSON.stringify({ cityId, orderId: order.orderId, note: note || undefined }),
        });
        const json = (await res.json().catch(() => null)) as MutationResponse | null;
        if (!res.ok || !json?.ok) {
          throw new Error(pickError(json?.error, `Could not auto-assign ${order.orderNumber}.`));
        }
        if (json.assigned) {
          assignedCount += 1;
          lastTemplateOrderId = order.orderId;
        } else if (json.idempotent) {
          unchangedCount += 1;
          lastTemplateOrderId = order.orderId;
        } else if (json.reason === "NO_AVAILABLE_DRIVER") {
          noDriverCount += 1;
        }
      }

      if (lastTemplateOrderId) {
        try {
          await loadWhatsAppTemplate(lastTemplateOrderId);
        } catch {
          setWhatsAppTemplate(null);
        }
      } else {
        setWhatsAppTemplate(null);
      }

      setSuccess(
        `Auto Assign All finished. Assigned: ${assignedCount}. Unchanged: ${unchangedCount}. No driver: ${noDriverCount}.`
      );
      await loadData(cityId, statusFilter);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not auto-assign queue.");
    } finally {
      setBulkLoading(false);
    }
  }

  useEffect(() => {
    loadCities().catch((requestError: unknown) => {
      setError(requestError instanceof Error ? requestError.message : "Could not load cities.");
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof window === "undefined") return;
    const search = new URLSearchParams(window.location.search);
    if (search.get("legacy")) {
      setAccessNotice(
        "Legacy dispatch link detected. Keep admin keys out of shared production URLs and use the ops path from admin surfaces."
      );
    } else if (search.get("key")) {
      setAccessNotice(
        "Dispatch API requests now use header-based admin auth. Avoid sharing keyed page URLs outside trusted operator workflows."
      );
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("aisha:auto-dispatch-enabled");
    if (stored === "0") {
      setAutoDispatchEnabled(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("aisha:auto-dispatch-enabled", autoDispatchEnabled ? "1" : "0");
  }, [autoDispatchEnabled]);

  useEffect(() => {
    if (!cityId) return;
    loadData(cityId, statusFilter);
  }, [cityId, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px_140px_170px_190px]">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">City</span>
            <select
              value={cityId}
              onChange={(event) => {
                setCityId(event.target.value);
                setWhatsAppTemplate(null);
              }}
              className="w-full rounded border border-slate-300 px-3 py-2"
            >
              {cities.map((row) => (
                <option key={row._id} value={row._id}>
                  {String(row.name || "City")} ({String(row.code || row.slug || "CITY").toUpperCase()})
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as DispatchStatusFilter)}
              className="w-full rounded border border-slate-300 px-3 py-2"
            >
              <option value="all">All dispatchable</option>
              <option value="accepted">accepted</option>
              <option value="preparing">preparing</option>
              <option value="ready">ready</option>
              <option value="out_for_delivery">out_for_delivery</option>
            </select>
          </label>

          <button
            type="button"
            onClick={() => loadData(cityId, statusFilter)}
            disabled={loading || !cityId}
            className="self-end rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>

          <button
            type="button"
            onClick={autoAssignAll}
            disabled={
              bulkLoading ||
              loading ||
              !autoDispatchEnabled ||
              !cityId ||
              !unassignedOrders.length
            }
            className="self-end rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900 disabled:opacity-50"
          >
            {bulkLoading ? "Auto assigning..." : "Auto Assign All"}
          </button>

          <label className="flex items-center gap-2 self-end rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={autoDispatchEnabled}
              onChange={(event) => setAutoDispatchEnabled(event.target.checked)}
            />
            Auto dispatch enabled
          </label>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Available Drivers"
          value={driverStats.availableDrivers}
          className="border-emerald-200 bg-emerald-50"
        />
        <SummaryCard
          label="Busy Drivers"
          value={driverStats.busyDrivers}
          className="border-amber-200 bg-amber-50"
        />
        <SummaryCard
          label="Offline Drivers"
          value={driverStats.offlineDrivers}
          className="border-slate-200 bg-slate-50"
        />
        <SummaryCard
          label="Unassigned Orders"
          value={unassignedTotal}
          className="border-sky-200 bg-sky-50"
        />
      </section>

      {selectedCity ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-slate-900">Launch diagnostics</h2>
            <p className="text-xs text-slate-500">
              Confirm the city, market, support number, payment methods, and timezone before dispatching live orders.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">City</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {selectedCity.name || "-"} ({String(selectedCity.code || "").toUpperCase() || "-"})
              </p>
              <p className="mt-1 text-xs text-slate-600">{selectedCity.country || selectedMarket.countryName}</p>
            </article>
            <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Market</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{selectedMarket.marketCode}</p>
              <p className="mt-1 text-xs text-slate-600">
                Language {selectedMarket.defaultLanguage} | Currency {selectedMarket.currencyDisplay}
              </p>
            </article>
            <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Timezone</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{selectedMarket.defaultTimezone}</p>
              <p className="mt-1 text-xs text-slate-600">City-scoped business hours should follow this market.</p>
            </article>
            <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Support WhatsApp</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{selectedMarket.supportWhatsApp}</p>
              <p className="mt-1 text-xs text-slate-600">Use the city support line for customer escalations.</p>
              {selectedMarket.supportWhatsAppIsPlaceholder ? (
                <p className="mt-1 text-xs font-semibold text-rose-700">
                  Replace this placeholder number before live launch.
                </p>
              ) : null}
            </article>
            <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Payment methods</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {(selectedMarket.paymentMethods || []).join(", ") || "cash"}
              </p>
              <p className="mt-1 text-xs text-slate-600">Confirm the selected city matches the pilot playbook.</p>
            </article>
          </div>
        </section>
      ) : null}

      {accessNotice ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {accessNotice}
        </p>
      ) : null}
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {success ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {success}
        </p>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_240px]">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Selected order</p>
            <p className="mt-1 text-sm font-semibold">{selectedOrder?.orderNumber || "No order selected"}</p>
            <p className="text-xs text-slate-600">{selectedOrder?.businessName || "-"}</p>
            <p className="text-xs text-slate-600">{selectedOrder?.address || "-"}</p>
            <p className="mt-1 text-xs text-slate-600">
              Dispatch state: {formatDispatchState(selectedOrder)}
              {selectedOrder?.offerExpiresAt
                ? ` | offer until ${formatDateTime(selectedOrder.offerExpiresAt)}`
                : ""}
            </p>
            {selectedOrder?.suggestedDriverId ? (
              <p className="mt-2 text-xs text-emerald-800">
                Suggested: {findDriver(selectedOrder.suggestedDriverId)?.name || selectedOrder.suggestedDriverId}
                {selectedOrder.suggestedScore != null ? ` | score ${selectedOrder.suggestedScore}` : ""}
                {selectedOrder.suggestedEtaMinutes != null ? ` | ETA ${selectedOrder.suggestedEtaMinutes}m` : ""}
              </p>
            ) : null}
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Selected driver</p>
            <p className="mt-1 text-sm font-semibold">{selectedDriver?.name || "No driver selected"}</p>
            <p className="text-xs text-slate-600">{selectedDriver?.phone || "-"}</p>
            <p className="text-xs text-slate-600">
              {selectedDriver?.zoneLabel || "-"} | {formatAvailability(selectedDriver?.availability)}
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Note</span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value.slice(0, 200))}
                placeholder="Optional dispatch note"
                className="w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <button
              type="button"
              onClick={() => mutateAssignment(selectedOrder?.assignedDriverId ? "reassign" : "assign")}
              disabled={!selectedOrder || !selectedDriverId || Boolean(actionLoading) || bulkLoading}
              className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {actionLoading === "assign" || actionLoading === "reassign"
                ? "Saving..."
                : selectedOrder?.assignedDriverId
                ? "Reassign driver"
                : "Assign driver"}
            </button>
          </div>
        </div>
      </section>

      {whatsAppTemplate?.messageText ? (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-emerald-900">WhatsApp dispatch text</h2>
              <p className="text-xs text-emerald-800">
                {String(whatsAppTemplate.city?.name || "")} ({String(whatsAppTemplate.city?.code || "").toUpperCase()})
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  await copyText(String(whatsAppTemplate.messageText || ""));
                  setSuccess("WhatsApp dispatch text copied.");
                } catch {
                  setError("Could not copy WhatsApp dispatch text.");
                }
              }}
              className="rounded border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-900"
            >
              Copy WhatsApp dispatch text
            </button>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm text-emerald-950">{whatsAppTemplate.messageText}</p>
          {whatsAppTemplate.driverLinkUrl ? (
            <p className="mt-2 break-all text-xs text-emerald-900">{whatsAppTemplate.driverLinkUrl}</p>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Unassigned Orders</h2>
              <p className="text-xs text-slate-500">Ready orders float to the top, then oldest first.</p>
            </div>
            <span className="text-xs text-slate-500">
              {unassignedOrders.length} loaded / {unassignedTotal} total
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-600">
                <tr>
                  <th className="border-b py-2">Order</th>
                  <th className="border-b py-2">Business</th>
                  <th className="border-b py-2">Status</th>
                  <th className="border-b py-2">Dispatch</th>
                  <th className="border-b py-2">Created</th>
                  <th className="border-b py-2">Address</th>
                  <th className="border-b py-2">Suggested</th>
                  <th className="border-b py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {unassignedOrders.map((order) => {
                  const suggestedDriver = findDriver(order.suggestedDriverId);
                  return (
                    <tr
                      key={order.orderId}
                      onClick={() => selectOrder(order)}
                      className={`cursor-pointer border-b align-top last:border-b-0 ${
                        selectedOrderId === order.orderId ? "bg-slate-100" : ""
                      }`}
                    >
                      <td className="py-2 font-mono text-xs">{order.orderNumber}</td>
                      <td className="py-2">{order.businessName}</td>
                      <td className="py-2">{order.status}</td>
                      <td className="py-2">
                        <div className="text-xs text-slate-700">{formatDispatchState(order)}</div>
                        {order.offerExpiresAt ? (
                          <div className="text-[11px] text-slate-500">
                            offer until {formatDateTime(order.offerExpiresAt)}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2">{formatDateTime(order.createdAt)}</td>
                      <td className="py-2">{order.address}</td>
                      <td className="py-2">
                        {order.suggestedDriverId ? (
                          <div className="text-xs">
                            <div className="rounded bg-emerald-50 px-2 py-1 text-emerald-900">
                              {suggestedDriver?.name || order.suggestedDriverId}
                            </div>
                            <p className="mt-1 text-slate-600">
                              {order.zoneLabel ? `zone ${order.zoneLabel}` : "cross-zone"}
                              {order.suggestedScore != null ? ` | score ${order.suggestedScore}` : ""}
                              {order.suggestedEtaMinutes != null ? ` | ETA ${order.suggestedEtaMinutes}m` : ""}
                            </p>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">No suggestion</span>
                        )}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectOrder(order);
                            }}
                            className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                          >
                            Assign
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              autoAssign(order);
                            }}
                            disabled={Boolean(actionLoading) || bulkLoading || !autoDispatchEnabled}
                            className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-900 disabled:opacity-50"
                          >
                            {actionLoading === `auto:${order.orderId}` ? "Working..." : "Auto Assign"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!unassignedOrders.length ? (
                  <tr>
                    <td colSpan={8} className="py-3 text-center text-slate-500">
                      No unassigned dispatchable orders for this city and filter.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Drivers</h2>
              <p className="text-xs text-slate-500">Active, non-banned drivers in the selected city.</p>
            </div>
            <span className="text-xs text-slate-500">{drivers.length} loaded</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-600">
                <tr>
                  <th className="border-b py-2">Name</th>
                  <th className="border-b py-2">Phone</th>
                  <th className="border-b py-2">Zone</th>
                  <th className="border-b py-2">Availability</th>
                  <th className="border-b py-2">Load</th>
                  <th className="border-b py-2">Last Assigned</th>
                  <th className="border-b py-2">Last Delivery</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((driver) => (
                  <tr
                    key={driver.driverId}
                    onClick={() => setSelectedDriverId(driver.driverId)}
                    className={`cursor-pointer border-b last:border-b-0 ${
                      selectedDriverId === driver.driverId ? "bg-slate-100" : ""
                    }`}
                  >
                    <td className="py-2">
                      <div className="font-medium">{driver.name}</div>
                      <div className="font-mono text-xs text-slate-500">{driver.driverId}</div>
                    </td>
                    <td className="py-2">{driver.phone || "-"}</td>
                    <td className="py-2">{driver.zoneLabel || "-"}</td>
                    <td className="py-2">{formatAvailability(driver.availability)}</td>
                    <td className="py-2">{Number(driver.activeLoad || 0)}</td>
                    <td className="py-2">{formatDateTime(driver.lastAssignedAt)}</td>
                    <td className="py-2">{formatDateTime(driver.lastDeliveryConfirmedAt)}</td>
                  </tr>
                ))}
                {!drivers.length ? (
                  <tr>
                    <td colSpan={7} className="py-3 text-center text-slate-500">
                      No active drivers found in this city.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Assigned Orders</h2>
            <p className="text-xs text-slate-500">Select an assigned order, choose another driver, then reassign.</p>
          </div>
          <span className="text-xs text-slate-500">
            {assignedOrders.length} loaded / {assignedTotal} total
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th className="border-b py-2">Order</th>
                <th className="border-b py-2">Business</th>
                <th className="border-b py-2">Status</th>
                <th className="border-b py-2">Assigned Driver</th>
                <th className="border-b py-2">Assigned At</th>
                <th className="border-b py-2">Total</th>
                <th className="border-b py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {assignedOrders.map((order) => (
                <tr
                  key={order.orderId}
                  onClick={() => selectOrder(order)}
                  className={`cursor-pointer border-b last:border-b-0 ${
                    selectedOrderId === order.orderId ? "bg-slate-100" : ""
                  }`}
                >
                  <td className="py-2 font-mono text-xs">{order.orderNumber}</td>
                  <td className="py-2">{order.businessName}</td>
                  <td className="py-2">{order.status}</td>
                  <td className="py-2">{order.assignedDriverName || order.assignedDriverId || "-"}</td>
                  <td className="py-2">{formatDateTime(order.assignedAt)}</td>
                  <td className="py-2">{formatMoney(order.total, currencyCode)}</td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        selectOrder(order);
                      }}
                      className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                    >
                      Reassign
                    </button>
                  </td>
                </tr>
              ))}
              {!assignedOrders.length ? (
                <tr>
                  <td colSpan={7} className="py-3 text-center text-slate-500">
                    No assigned dispatchable orders for this city and filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Dispatch History</h2>
            <p className="text-xs text-slate-500">Latest dispatch audit activity for the selected city.</p>
          </div>
          <button
            type="button"
            onClick={() => loadData(cityId, statusFilter)}
            disabled={loading || !cityId}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            Refresh history
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th className="border-b py-2">Time</th>
                <th className="border-b py-2">Action</th>
                <th className="border-b py-2">Order</th>
                <th className="border-b py-2">Actor</th>
                <th className="border-b py-2">Meta</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map((row) => (
                <tr key={row.id} className="border-b last:border-b-0">
                  <td className="py-2">{formatDateTime(row.createdAt)}</td>
                  <td className="py-2">{row.action}</td>
                  <td className="py-2 font-mono text-xs">{row.orderId || "-"}</td>
                  <td className="py-2">{row.actor}</td>
                  <td className="py-2">{renderHistoryMeta(row.meta)}</td>
                </tr>
              ))}
              {!historyRows.length ? (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-slate-500">
                    No dispatch history found for this city.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
