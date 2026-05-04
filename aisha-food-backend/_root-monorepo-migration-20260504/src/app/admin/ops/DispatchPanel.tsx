"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type DriverRow = {
  id: string;
  name: string;
  isActive: boolean;
  zoneLabel?: string | null;
};

type OrderRow = {
  orderId: string;
  orderNumber: string;
  businessName: string;
  address: string;
  total: number;
  status: "new" | "preparing" | "out_for_delivery";
  statusProgressPct: number;
  createdAt?: string | null;
  eta?: {
    text?: string;
    maxMins?: number | null;
  };
  dispatch: {
    assignedDriverId?: string | null;
    assignedDriverName?: string | null;
    assignedAt?: string | null;
    pickupConfirmedAt?: string | null;
    deliveredConfirmedAt?: string | null;
    cashCollectedByDriver?: boolean;
    handoffNote?: string | null;
  };
};

type BoardResponse = {
  ok: boolean;
  drivers?: DriverRow[];
  orders?: OrderRow[];
  error?: { message?: string } | string;
};

type Props = {
  adminKey: string;
};

function formatMoney(value: number) {
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

function computeLate(order: OrderRow) {
  const created = order.createdAt ? new Date(order.createdAt) : null;
  if (!created || Number.isNaN(created.getTime())) return false;
  const etaMaxMins = Number(order.eta?.maxMins || 0);
  if (etaMaxMins <= 0) return false;
  const elapsedMs = Date.now() - created.getTime();
  return elapsedMs > etaMaxMins * 60 * 1000 && Number(order.statusProgressPct || 0) < 100;
}

function statusBadgeClass(status: string) {
  if (status === "out_for_delivery") return "bg-blue-100 text-blue-700";
  if (status === "preparing") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

export default function DispatchPanel({ adminKey }: Props) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<"all" | "new" | "preparing" | "out_for_delivery">("all");
  const [lateOnly, setLateOnly] = useState(false);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [selectedDriverByOrder, setSelectedDriverByOrder] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const activeDrivers = useMemo(
    () => drivers.filter((driver) => driver.isActive),
    [drivers]
  );

  const visibleOrders = useMemo(
    () => orders.filter((order) => (lateOnly ? computeLate(order) : true)),
    [orders, lateOnly]
  );

  const unassignedOrders = useMemo(
    () => visibleOrders.filter((order) => !order.dispatch?.assignedDriverId),
    [visibleOrders]
  );

  const assignedGroups = useMemo(() => {
    const grouped = new Map<string, { driver: DriverRow | null; orders: OrderRow[] }>();
    for (const order of visibleOrders) {
      const driverId = String(order.dispatch?.assignedDriverId || "").trim();
      if (!driverId) continue;
      const existing = grouped.get(driverId);
      if (existing) {
        existing.orders.push(order);
        continue;
      }
      const driver = drivers.find((row) => row.id === driverId) || null;
      grouped.set(driverId, { driver, orders: [order] });
    }
    return Array.from(grouped.entries()).map(([driverId, value]) => ({
      driverId,
      driver: value.driver,
      orders: value.orders.sort((a, b) =>
        String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
      ),
    }));
  }, [visibleOrders, drivers]);

  async function loadBoard(nextStatus = statusFilter) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/admin/dispatch/board?key=${encodeURIComponent(adminKey)}&status=${encodeURIComponent(nextStatus)}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => null)) as BoardResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not load dispatch board."
        );
      }
      const nextDrivers = Array.isArray(json.drivers) ? json.drivers : [];
      const nextOrders = Array.isArray(json.orders) ? json.orders : [];
      setDrivers(nextDrivers);
      setOrders(nextOrders);
      const defaults: Record<string, string> = {};
      for (const order of nextOrders) {
        const assignedId = String(order.dispatch?.assignedDriverId || "").trim();
        defaults[order.orderId] = assignedId;
      }
      setSelectedDriverByOrder(defaults);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not load dispatch board.");
    } finally {
      setLoading(false);
    }
  }

  async function assignDriver(order: OrderRow) {
    const selectedDriverId =
      String(selectedDriverByOrder[order.orderId] || "").trim() ||
      String(order.dispatch?.assignedDriverId || "").trim();
    if (!selectedDriverId) {
      setError("Select a driver first.");
      return;
    }
    setActionLoading(`assign:${order.orderId}`);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/dispatch/assign?key=${encodeURIComponent(adminKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.orderId,
          driverId: selectedDriverId,
          confirm: "ASSIGN",
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not assign driver."
        );
      }
      setSuccess(`Assigned ${order.orderNumber}.`);
      await loadBoard();
      router.refresh();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not assign driver.");
    } finally {
      setActionLoading("");
    }
  }

  async function unassignDriver(order: OrderRow) {
    setActionLoading(`unassign:${order.orderId}`);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/dispatch/unassign?key=${encodeURIComponent(adminKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.orderId,
          confirm: "UNASSIGN",
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not unassign driver."
        );
      }
      setSuccess(`Unassigned ${order.orderNumber}.`);
      await loadBoard();
      router.refresh();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not unassign driver.");
    } finally {
      setActionLoading("");
    }
  }

  async function saveNote(order: OrderRow) {
    const note = window
      .prompt(
        "Handoff note (max 200 chars). Leave empty to clear.",
        String(order.dispatch?.handoffNote || "")
      )
      ?.trim();
    if (note == null) return;
    setActionLoading(`note:${order.orderId}`);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/dispatch/note?key=${encodeURIComponent(adminKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.orderId,
          note: note.slice(0, 200),
          confirm: "NOTE",
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not save note."
        );
      }
      setSuccess(`Saved note for ${order.orderNumber}.`);
      await loadBoard();
      router.refresh();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not save note.");
    } finally {
      setActionLoading("");
    }
  }

  useEffect(() => {
    loadBoard(statusFilter);
  }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Dispatch</h2>
          <p className="text-xs text-slate-500">
            Assign riders, confirm handoff notes, and triage late active orders.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as "all" | "new" | "preparing" | "out_for_delivery")
            }
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="all">All active statuses</option>
            <option value="new">new</option>
            <option value="preparing">preparing</option>
            <option value="out_for_delivery">out_for_delivery</option>
          </select>
          <label className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-sm">
            <input
              type="checkbox"
              checked={lateOnly}
              onChange={(event) => setLateOnly(event.target.checked)}
            />
            Late only
          </label>
          <button
            type="button"
            onClick={() => loadBoard()}
            className="rounded border border-slate-300 px-3 py-1 text-sm font-semibold"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mb-2 text-sm text-emerald-700">{success}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-lg border border-slate-200 p-3">
          <h3 className="text-sm font-semibold">Unassigned Active Orders</h3>
          <div className="mt-2 space-y-2">
            {unassignedOrders.length ? (
              unassignedOrders.map((order) => (
                <OrderCard
                  key={order.orderId}
                  order={order}
                  actionLoading={actionLoading}
                  activeDrivers={activeDrivers}
                  selectedDriverId={selectedDriverByOrder[order.orderId] || ""}
                  onDriverChange={(driverId) =>
                    setSelectedDriverByOrder((prev) => ({ ...prev, [order.orderId]: driverId }))
                  }
                  onAssign={() => assignDriver(order)}
                  onUnassign={() => unassignDriver(order)}
                  onNote={() => saveNote(order)}
                />
              ))
            ) : (
              <p className="text-sm text-slate-500">No unassigned orders in this filter.</p>
            )}
          </div>
        </article>

        <article className="rounded-lg border border-slate-200 p-3">
          <h3 className="text-sm font-semibold">Assigned Orders by Driver</h3>
          <div className="mt-2 space-y-3">
            {assignedGroups.length ? (
              assignedGroups.map((group) => (
                <div key={group.driverId} className="rounded border border-slate-200 p-2">
                  <p className="text-sm font-semibold">
                    {group.driver?.name || "Driver unavailable"}
                    {group.driver?.zoneLabel ? (
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {group.driver.zoneLabel}
                      </span>
                    ) : null}
                  </p>
                  <div className="mt-2 space-y-2">
                    {group.orders.map((order) => (
                      <OrderCard
                        key={order.orderId}
                        order={order}
                        actionLoading={actionLoading}
                        activeDrivers={activeDrivers}
                        selectedDriverId={selectedDriverByOrder[order.orderId] || group.driverId}
                        onDriverChange={(driverId) =>
                          setSelectedDriverByOrder((prev) => ({ ...prev, [order.orderId]: driverId }))
                        }
                        onAssign={() => assignDriver(order)}
                        onUnassign={() => unassignDriver(order)}
                        onNote={() => saveNote(order)}
                      />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No assigned orders in this filter.</p>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}

function OrderCard({
  order,
  actionLoading,
  activeDrivers,
  selectedDriverId,
  onDriverChange,
  onAssign,
  onUnassign,
  onNote,
}: {
  order: OrderRow;
  actionLoading: string;
  activeDrivers: DriverRow[];
  selectedDriverId: string;
  onDriverChange: (driverId: string) => void;
  onAssign: () => void;
  onUnassign: () => void;
  onNote: () => void;
}) {
  const isLate = computeLate(order);
  return (
    <div className={`rounded border p-2 ${isLate ? "border-red-300 bg-red-50" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs">{order.orderNumber}</p>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusBadgeClass(order.status)}`}>
          {order.status}
        </span>
      </div>
      <p className="text-sm font-semibold">{order.businessName}</p>
      <p className="text-xs text-slate-600">{order.address}</p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
        <span>Total: {formatMoney(order.total)}</span>
        <span>ETA: {String(order.eta?.text || "-")}</span>
        <span>Created: {formatDateTime(order.createdAt || null)}</span>
      </div>
      <div className="mt-1 text-xs text-slate-600">
        Handoff note: {String(order.dispatch?.handoffNote || "").trim() || "-"}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <select
          value={selectedDriverId}
          onChange={(event) => onDriverChange(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          <option value="">Select driver</option>
          {activeDrivers.map((driver) => (
            <option key={driver.id} value={driver.id}>
              {driver.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={Boolean(actionLoading)}
          onClick={onAssign}
          className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
        >
          {actionLoading === `assign:${order.orderId}` ? "Assigning..." : "Assign"}
        </button>
        <button
          type="button"
          disabled={Boolean(actionLoading)}
          onClick={onUnassign}
          className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
        >
          {actionLoading === `unassign:${order.orderId}` ? "Unassigning..." : "Unassign"}
        </button>
        <button
          type="button"
          disabled={Boolean(actionLoading)}
          onClick={onNote}
          className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
        >
          {actionLoading === `note:${order.orderId}` ? "Saving..." : "Note"}
        </button>
        <a
          href={`/api/public/track?orderNumber=${encodeURIComponent(order.orderNumber)}`}
          target="_blank"
          rel="noreferrer"
          className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
        >
          Track
        </a>
      </div>
    </div>
  );
}
