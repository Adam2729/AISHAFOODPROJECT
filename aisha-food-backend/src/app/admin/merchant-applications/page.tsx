"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ApplicationRow = {
  _id: string;
  cityId: string;
  businessName: string;
  ownerName: string;
  phone: string;
  email?: string;
  whatsapp?: string;
  merchantType?: string;
  deliveryType?: string;
  deliveryModePreference?: string;
  acceptsPayTech?: boolean;
  area?: string;
  address?: string;
  cuisineType?: string;
  storeCategory?: string;
  payoutMethod?: string;
  notes?: string;
  status: string;
  createdAt?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  createdBusinessId?: string | null;
};

type CityRow = { _id: string; name?: string; code?: string };

type ListResponse = {
  ok?: boolean;
  rows?: ApplicationRow[];
  nextCursor?: string;
  error?: { message?: string } | string;
};

type CitiesResponse = { ok?: boolean; cities?: CityRow[]; error?: { message?: string } | string };

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

function formatDate(value: unknown) {
  if (!value) return "-";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
}

function statusTone(status: string) {
  switch (status) {
    case "pending":
      return "bg-blue-50 text-blue-700 ring-blue-200";
    case "needs_info":
      return "bg-amber-50 text-amber-700 ring-amber-200";
    case "approved":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "rejected":
      return "bg-rose-50 text-rose-700 ring-rose-200";
    default:
      return "bg-slate-100 text-slate-700 ring-slate-200";
  }
}

function merchantTypeLabel(value: string | undefined) {
  switch (String(value || "").trim()) {
    case "corner_shop":
      return "Corner shop";
    case "grocery":
      return "Grocery / mini market";
    case "bakery":
      return "Bakery";
    case "pharmacy":
      return "Pharmacy";
    default:
      return "Restaurant";
  }
}

function deliveryTypeLabel(value: string | undefined) {
  switch (String(value || "").trim()) {
    case "platform_driver":
      return "Aisha Food drivers";
    default:
      return "Own drivers";
  }
}

function deliveryModePreferenceLabel(value: string | undefined) {
  switch (String(value || "").trim()) {
    case "platform_driver":
      return "Platform driver";
    case "both":
      return "Both";
    default:
      return "Self delivery";
  }
}

function payoutLabel(value: string | undefined) {
  switch (String(value || "").trim()) {
    case "bank_transfer":
      return "Bank transfer";
    case "mobile_money":
      return "Mobile money";
    case "weekly_cashout":
      return "Weekly cashout";
    case "cash_collection":
      return "Cash collection";
    default:
      return "-";
  }
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</dt>
      <dd className="text-right text-sm text-slate-800">{value || "-"}</dd>
    </div>
  );
}

export default function AdminMerchantApplicationsPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [cityId, setCityId] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (cityId) params.set("cityId", cityId);
    if (status) params.set("status", status);
    if (q.trim()) params.set("q", q.trim());
    return params.toString();
  }, [cityId, status, q]);

  const selected = useMemo(
    () => rows.find((row) => row._id === selectedId) || rows[0] || null,
    [rows, selectedId]
  );

  const summary = useMemo(
    () => ({
      pending: rows.filter((row) => row.status === "pending").length,
      needsInfo: rows.filter((row) => row.status === "needs_info").length,
      approved: rows.filter((row) => row.status === "approved").length,
      rejected: rows.filter((row) => row.status === "rejected").length,
    }),
    [rows]
  );

  function cityLabel(value: string) {
    const city = cities.find((entry) => entry._id === value);
    if (!city) return value;
    return `${String(city.code || "").toUpperCase()}${city.name ? ` - ${city.name}` : ""}`;
  }

  async function loadCities() {
    try {
      const res = await fetch("/api/admin/cities", {
        cache: "no-store",
      });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as CitiesResponse | null;
      if (res.ok && json?.ok && Array.isArray(json.cities)) {
        setCities(json.cities);
      }
    } catch {
      // ignore
    }
  }

  async function loadApps() {
    if (!authenticated) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/merchant-applications?${queryString}`, {
        cache: "no-store",
      });
      if (res.status === 401) {
        setAuthenticated(false);
        setRows([]);
        return;
      }
      const json = (await res.json().catch(() => null)) as ListResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not load applications."));
      }
      const nextRows = Array.isArray(json.rows) ? json.rows : [];
      setRows(nextRows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load applications.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function approve(id: string) {
    if (!authenticated) return;
    if (!confirm("Approve this application and create the merchant business?")) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/merchant-applications/${encodeURIComponent(id)}/approve`, {
        method: "POST",
      });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        businessId?: string;
        loginIdentifier?: string;
        temporaryPin?: string | null;
        error?: unknown;
      } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not approve application."));
      }
      setSuccess(
        [
          "Application approved and business created.",
          json.loginIdentifier ? `Login: ${json.loginIdentifier}` : "",
          json.temporaryPin ? `Temporary PIN: ${json.temporaryPin}` : "",
        ]
          .filter(Boolean)
          .join(" ")
      );
      await loadApps();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not approve application.");
    } finally {
      setLoading(false);
    }
  }

  async function reject(id: string) {
    if (!authenticated) return;
    const reason = prompt("Rejection reason (optional, max 400 chars):", "") || "";
    if (!confirm("Reject this application?")) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/merchant-applications/${encodeURIComponent(id)}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not reject application."));
      }
      setSuccess("Application rejected.");
      await loadApps();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not reject application.");
    } finally {
      setLoading(false);
    }
  }

  async function requestInfo(id: string) {
    if (!authenticated) return;
    const note = prompt("What information is still missing?", "") || "";
    if (!note.trim()) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/merchant-applications/${encodeURIComponent(id)}/request-info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not request more information."));
      }
      setSuccess("Application moved to needs info.");
      await loadApps();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not request more information.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const res = await fetch("/api/admin/session", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { authenticated?: boolean } | null;
        const allowed = Boolean(res.ok && json?.authenticated);
        if (!mounted) return;
        setAuthenticated(allowed);
        if (!allowed) return;
        await loadCities();
      } catch {
        if (!mounted) return;
        setAuthenticated(false);
      }
    }

    bootstrap().catch(() => null);

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    loadApps();
  }, [authenticated, cityId, status, q]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!rows.length) {
      setSelectedId("");
      return;
    }
    if (selectedId && rows.some((row) => row._id === selectedId)) return;
    const preferred = rows.find((row) => row.status === "pending") || rows[0];
    setSelectedId(preferred._id);
  }, [rows, selectedId]);

  if (authenticated === null) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Merchant Applications</h1>
        <p className="mt-2 text-sm text-slate-600">Checking secure admin session...</p>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Merchant Applications</h1>
        <p className="mt-2 text-sm text-red-600">
          Admin access requires a secure browser session.
        </p>
        <Link
          href="/admin/access?next=/admin/merchant-applications"
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Merchant Applications</h1>
          <p className="text-sm text-slate-600">
            Review business registrations, verify the setup, then approve from the review panel.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin"
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Admin Home
          </Link>
          <Link
            href="/admin/ops"
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Ops Center
          </Link>
          <button
            type="button"
            onClick={loadApps}
            disabled={loading}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mb-3 text-sm text-emerald-700">{success}</p> : null}

      <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Pending</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{summary.pending}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Needs info</p>
          <p className="mt-2 text-2xl font-semibold text-amber-600">{summary.needsInfo}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Approved</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-600">{summary.approved}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Rejected</p>
          <p className="mt-2 text-2xl font-semibold text-rose-600">{summary.rejected}</p>
        </article>
      </section>

      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap gap-2">
          <select
            value={cityId}
            onChange={(event) => setCityId(event.target.value)}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All cities</option>
            {cities.map((city) => (
              <option key={city._id} value={city._id}>
                {(city.code || "").toUpperCase()} {city.name ? `- ${city.name}` : ""}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Any status</option>
            <option value="pending">Pending</option>
            <option value="needs_info">Needs info</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search business, owner, phone"
            className="min-w-[220px] rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_420px]">
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Applications queue</h2>
              <p className="text-sm text-slate-500">
                Select an application to review the full operator summary before approval.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {rows.length} total
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-2">Business</th>
                  <th className="pb-2">Owner</th>
                  <th className="pb-2">City</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Created</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((row) => {
                    const isSelected = selected?._id === row._id;
                    return (
                      <tr
                        key={row._id}
                        className={`border-t border-slate-100 align-top ${isSelected ? "bg-slate-50" : ""}`}
                      >
                        <td className="py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedId(row._id)}
                            className="text-left"
                          >
                            <div className="font-semibold text-slate-950">{row.businessName}</div>
                            <div className="text-xs text-slate-500">
                              {merchantTypeLabel(row.merchantType)}
                            </div>
                          </button>
                        </td>
                        <td className="py-3">
                          <div>{row.ownerName || "-"}</div>
                          <div className="mt-1 text-xs text-slate-500">{row.phone}</div>
                        </td>
                        <td className="py-3 text-xs">
                          <div>{cityLabel(row.cityId)}</div>
                          <div className="mt-1 text-slate-500">{row.area || "-"}</div>
                        </td>
                        <td className="py-3">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ring-1 ${statusTone(row.status)}`}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td className="py-3 text-xs text-slate-500">{formatDate(row.createdAt)}</td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedId(row._id)}
                              className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                            >
                              Review
                            </button>
                            <button
                              type="button"
                              onClick={() => requestInfo(row._id)}
                              disabled={loading || row.status !== "pending"}
                              className="rounded border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-700 disabled:opacity-50"
                            >
                              Request info
                            </button>
                            <button
                              type="button"
                              onClick={() => reject(row._id)}
                              disabled={loading || !["pending", "needs_info"].includes(row.status)}
                              className="rounded border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-500">
                      No applications found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <aside className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Review panel
              </p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">
                {selected?.businessName || "Select an application"}
              </h2>
            </div>
            {selected ? (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ring-1 ${statusTone(selected.status)}`}
              >
                {selected.status}
              </span>
            ) : null}
          </div>

          {!selected ? (
            <p className="mt-4 text-sm text-slate-500">
              Pick a registration from the queue to review business details before approval.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Operator summary
                </p>
                <dl className="mt-3">
                  <DetailRow label="Business" value={selected.businessName} />
                  <DetailRow label="Owner" value={selected.ownerName} />
                  <DetailRow label="City" value={cityLabel(selected.cityId)} />
                  <DetailRow label="Type" value={merchantTypeLabel(selected.merchantType)} />
                  <DetailRow
                    label="Delivery preference"
                    value={deliveryModePreferenceLabel(selected.deliveryModePreference)}
                  />
                  <DetailRow label="Delivery" value={deliveryTypeLabel(selected.deliveryType)} />
                  <DetailRow
                    label="PayTech"
                    value={selected.acceptsPayTech ? "Requested" : "Not requested"}
                  />
                  <DetailRow label="Payout" value={payoutLabel(selected.payoutMethod)} />
                </dl>
              </section>

              <section>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Contact details
                </p>
                <dl className="mt-2">
                  <DetailRow label="Phone" value={selected.phone} />
                  <DetailRow label="WhatsApp" value={selected.whatsapp} />
                  <DetailRow label="Email" value={selected.email} />
                </dl>
              </section>

              <section>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Store setup
                </p>
                <dl className="mt-2">
                  <DetailRow label="Area" value={selected.area} />
                  <DetailRow label="Address" value={selected.address} />
                  <DetailRow
                    label="Cuisine / category"
                    value={selected.cuisineType || selected.storeCategory}
                  />
                  <DetailRow label="Notes" value={selected.notes} />
                </dl>
              </section>

              <section>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Timeline
                </p>
                <dl className="mt-2">
                  <DetailRow label="Created" value={formatDate(selected.createdAt)} />
                  <DetailRow label="Approved" value={formatDate(selected.approvedAt)} />
                  <DetailRow label="Rejected" value={formatDate(selected.rejectedAt)} />
                  <DetailRow label="Business ID" value={selected.createdBusinessId} />
                </dl>
              </section>

              <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-sm font-semibold text-emerald-900">
                  Ready to approve this business?
                </p>
                <p className="mt-1 text-sm text-emerald-800">
                  Approval creates the merchant business and returns the login identifier and
                  temporary PIN if one is needed.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => approve(selected._id)}
                    disabled={loading || !["pending", "needs_info"].includes(selected.status)}
                    className="rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Approve and create business
                  </button>
                  <button
                    type="button"
                    onClick={() => requestInfo(selected._id)}
                    disabled={loading || selected.status !== "pending"}
                    className="rounded border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-700 disabled:opacity-50"
                  >
                    Request info
                  </button>
                  <button
                    type="button"
                    onClick={() => reject(selected._id)}
                    disabled={loading || !["pending", "needs_info"].includes(selected.status)}
                    className="rounded border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </section>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
