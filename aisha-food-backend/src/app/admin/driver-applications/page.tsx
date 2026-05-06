"use client";

import { useEffect, useMemo, useState } from "react";

type ApplicationRow = {
  applicationId: string;
  fullName?: string;
  name: string;
  phoneMasked?: string | null;
  email?: string | null;
  city?: string | null;
  zoneLabel?: string | null;
  vehicleType?: string | null;
  availability?: string | null;
  payoutMethod?: string | null;
  payoutAccountName?: string | null;
  payoutAccountNumber?: string | null;
  payoutNotes?: string | null;
  notes?: string | null;
  createdAt?: string | null;
  status: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  rejectionReason?: string | null;
  driverId?: string | null;
  approvedDriverId?: string | null;
};

type ListResponse = {
  ok?: boolean;
  cityId?: string;
  status?: string;
  total?: number;
  rows?: ApplicationRow[];
  error?: { message?: string } | string;
};

type CitiesResponse = { ok?: boolean; cities?: Array<{ _id: string; name?: string; code?: string }> };

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

export default function AdminDriverApplicationsPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [cities, setCities] = useState<Array<{ _id: string; name?: string; code?: string }>>([]);
  const [cityId, setCityId] = useState("");
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [approvalArtifact, setApprovalArtifact] = useState<{
    driverName?: string;
    email?: string;
    temporaryPassword?: string | null;
    loginLink?: string | null;
    loginLinkExpiresAt?: string | null;
  } | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (cityId) params.set("cityId", cityId);
    if (status) params.set("status", status);
    return params.toString();
  }, [cityId, status]);

  async function loadCities() {
    try {
      const res = await fetch("/api/admin/cities", { cache: "no-store" });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as CitiesResponse | null;
      if (res.ok && json?.ok && Array.isArray(json.cities)) {
        setCities(json.cities);
        if (!cityId && json.cities.length) setCityId(String(json.cities[0]._id));
      }
    } catch {
      // ignore
    }
  }

  async function loadApps() {
    if (!authenticated || !cityId) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/driver-applications?${queryString}`, { cache: "no-store" });
      if (res.status === 401) {
        setAuthenticated(false);
        setRows([]);
        return;
      }
      const json = (await res.json().catch(() => null)) as ListResponse | null;
      if (!res.ok || !json?.ok) throw new Error(pickError(json?.error, "Could not load applications."));
      setRows(Array.isArray(json.rows) ? json.rows : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load applications.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function approve(appId: string) {
    if (!authenticated || !cityId) return;
    setLoading(true);
    setError("");
    setSuccess("");
    setApprovalArtifact(null);
    try {
      const res = await fetch(`/api/admin/driver-applications/${encodeURIComponent(appId)}/approve`, {
        method: "POST",
      });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: unknown;
            driver?: { name?: string; email?: string };
            temporaryPassword?: string | null;
            loginLink?: string | null;
            loginLinkExpiresAt?: string | null;
          }
        | null;
      if (!res.ok || !json?.ok) throw new Error(pickError(json?.error, "Could not approve application."));
      setSuccess("Driver approved and account created.");
      setApprovalArtifact({
        driverName: json.driver?.name,
        email: json.driver?.email,
        temporaryPassword: json.temporaryPassword || null,
        loginLink: json.loginLink || null,
        loginLinkExpiresAt: json.loginLinkExpiresAt || null,
      });
      await loadApps();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not approve application.");
    } finally {
      setLoading(false);
    }
  }

  async function reject(appId: string) {
    if (!authenticated || !cityId) return;
    const reason = window.prompt("Rejection reason (required, max 280 chars):", "") || "";
    if (!reason.trim()) {
      setError("Reason is required to reject.");
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");
    setApprovalArtifact(null);
    try {
      const res = await fetch(`/api/admin/driver-applications/${encodeURIComponent(appId)}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown } | null;
      if (!res.ok || !json?.ok) throw new Error(pickError(json?.error, "Could not reject application."));
      setSuccess("Application rejected.");
      await loadApps();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not reject application.");
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!authenticated || !cityId) return;
    loadApps();
  }, [authenticated, cityId, status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (authenticated === null) {
    return (
      <main className="mx-auto min-h-screen max-w-6xl p-6">
        <h1 className="text-2xl font-bold">Driver Applications</h1>
        <p className="mt-2 text-sm text-slate-600">Checking secure admin session...</p>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="mx-auto min-h-screen max-w-6xl p-6">
        <h1 className="text-2xl font-bold">Driver Applications</h1>
        <p className="mt-2 text-sm text-red-600">
          Admin access requires a secure browser session.
        </p>
        <a
          href="/admin/access?next=/admin/driver-applications"
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Driver Applications</h1>
          <p className="text-sm text-slate-600">City-scoped review of driver onboarding.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/admin/drivers"
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Open Driver Operations
          </a>
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
      {approvalArtifact ? (
        <section className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <p className="font-semibold">Approval credentials</p>
          <p className="mt-1">
            Driver: {approvalArtifact.driverName || "-"}
            {approvalArtifact.email ? ` (${approvalArtifact.email})` : ""}
          </p>
          {approvalArtifact.temporaryPassword ? (
            <p className="mt-1">
              Temporary password:{" "}
              <span className="font-semibold">{approvalArtifact.temporaryPassword}</span>
            </p>
          ) : null}
          {approvalArtifact.loginLink ? (
            <div className="mt-2 break-all text-xs text-emerald-900">
              <p>Login link:</p>
              <p>{approvalArtifact.loginLink}</p>
              {approvalArtifact.loginLinkExpiresAt ? (
                <p className="mt-1 text-emerald-800">
                  Expires: {formatDate(approvalArtifact.loginLinkExpiresAt)}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mb-3 flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-4">
        <select
          value={cityId}
          onChange={(e) => setCityId(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">Select city</option>
          {cities.map((c) => (
            <option key={c._id} value={c._id}>
              {(c.code || "").toUpperCase()} {c.name ? `- ${c.name}` : ""}
            </option>
          ))}
        </select>

        <div className="flex gap-1 rounded border border-slate-300 px-2 py-1 text-sm">
          {(["pending", "approved", "rejected"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`px-2 py-1 text-xs font-semibold ${
                status === s ? "rounded bg-slate-900 text-white" : "text-slate-700"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Name</th>
                <th className="pb-2">Phone</th>
                <th className="pb-2">Email</th>
                <th className="pb-2">Zone</th>
                <th className="pb-2">Created</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row) => (
                  <tr key={row.applicationId} className="border-t border-slate-100 align-top">
                    <td className="py-2">{row.fullName || row.name}</td>
                    <td className="py-2">{row.phoneMasked || "-"}</td>
                    <td className="py-2">{row.email || "-"}</td>
                    <td className="py-2">
                      <div>{row.city || row.zoneLabel || "-"}</div>
                      <div className="text-xs text-slate-500">
                        {[row.vehicleType, row.availability].filter(Boolean).join(" / ") || "-"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {[row.payoutMethod, row.payoutAccountNumber].filter(Boolean).join(" / ") || "-"}
                      </div>
                    </td>
                    <td className="py-2 text-xs">{formatDate(row.createdAt)}</td>
                    <td className="py-2">
                      <div className="flex flex-col gap-1 text-xs">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold uppercase">
                          {row.status}
                        </span>
                        {row.rejectionReason ? <span className="text-red-700">Reason: {row.rejectionReason}</span> : null}
                        {row.approvedDriverId ? <span className="text-emerald-700">Driver: {row.approvedDriverId}</span> : null}
                      </div>
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => approve(row.applicationId)}
                          disabled={loading || row.status !== "pending"}
                          className="rounded border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => reject(row.applicationId)}
                          disabled={loading || row.status !== "pending"}
                          className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-3 text-center text-slate-500">
                    No applications found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
