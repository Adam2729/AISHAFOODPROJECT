"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type CityRow = {
  _id: string;
  name?: string;
  code?: string;
};

type ApplicationRow = {
  applicationId: string;
  fullName?: string;
  name?: string;
  phoneMasked?: string | null;
  email?: string | null;
  city?: string | null;
  zoneLabel?: string | null;
  vehicleType?: string | null;
  availability?: string | null;
  createdAt?: string | null;
  status: string;
  approvedDriverId?: string | null;
  rejectionReason?: string | null;
};

type DriverRow = {
  id: string;
  name: string;
  email?: string | null;
  phoneMasked?: string | null;
  availability?: string | null;
  accountStatus?: string | null;
  isActive?: boolean;
  zoneLabel?: string | null;
  activeAssignedOrderCount?: number;
  lastLocationUpdatedAt?: string | null;
  createdAt?: string | null;
};

type CitiesResponse = {
  ok?: boolean;
  cities?: CityRow[];
  error?: { message?: string } | string;
};

type DriverApplicationsResponse = {
  ok?: boolean;
  rows?: ApplicationRow[];
  total?: number;
  error?: { message?: string } | string;
};

type DriversResponse = {
  ok?: boolean;
  rows?: DriverRow[];
  total?: number;
  hiddenCount?: number;
  error?: { message?: string } | string;
};

type ApprovalResponse = {
  ok?: boolean;
  error?: { message?: string } | string;
  driver?: {
    id?: string;
    name?: string;
    email?: string;
    phoneMasked?: string | null;
  };
  temporaryPassword?: string | null;
  loginLink?: string | null;
  loginLinkExpiresAt?: string | null;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

function formatDate(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

async function copyText(value: string) {
  if (!value || !navigator?.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export default function AdminDriversPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [cityId, setCityId] = useState("");
  const [pendingApplications, setPendingApplications] = useState<ApplicationRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showInactiveTestDrivers, setShowInactiveTestDrivers] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [hiddenDriversCount, setHiddenDriversCount] = useState(0);
  const [revealedPhones, setRevealedPhones] = useState<Record<string, string>>({});
  const [approvalArtifact, setApprovalArtifact] = useState<{
    driverName?: string;
    email?: string;
    temporaryPassword?: string | null;
    loginLink?: string | null;
    loginLinkExpiresAt?: string | null;
  } | null>(null);
  const [lastGeneratedLink, setLastGeneratedLink] = useState<{
    driverName?: string;
    linkUrl?: string | null;
    expiresAt?: string | null;
  } | null>(null);

  const selectedCity = useMemo(
    () => cities.find((row) => row._id === cityId) || null,
    [cities, cityId]
  );

  async function loadCities() {
    const res = await fetch("/api/admin/cities", { cache: "no-store" });
    if (res.status === 401) {
      setAuthenticated(false);
      return;
    }
    const json = (await res.json().catch(() => null)) as CitiesResponse | null;
    if (!res.ok || !json?.ok || !Array.isArray(json.cities)) {
      throw new Error(pickError(json?.error, "Could not load cities."));
    }
    setCities(json.cities);
    if (!cityId && json.cities.length) {
      setCityId(String(json.cities[0]._id || ""));
    }
  }

  async function loadPendingApplications(nextCityId: string) {
    const params = new URLSearchParams({
      cityId: nextCityId,
      status: "pending",
      limit: "100",
    });
    const res = await fetch(`/api/admin/driver-applications?${params.toString()}`, {
      cache: "no-store",
    });
    if (res.status === 401) {
      setAuthenticated(false);
      return;
    }
    const json = (await res.json().catch(() => null)) as DriverApplicationsResponse | null;
    if (!res.ok || !json?.ok) {
      throw new Error(pickError(json?.error, "Could not load driver applications."));
    }
    setPendingApplications(Array.isArray(json.rows) ? json.rows : []);
  }

  async function loadDrivers(nextCityId: string) {
    const params = new URLSearchParams({
      cityId: nextCityId,
      status: "all",
      limit: "200",
    });
    if (showInactiveTestDrivers) {
      params.set("includeHidden", "1");
    }
    const res = await fetch(`/api/admin/drivers?${params.toString()}`, {
      cache: "no-store",
    });
    if (res.status === 401) {
      setAuthenticated(false);
      return;
    }
    const json = (await res.json().catch(() => null)) as DriversResponse | null;
    if (!res.ok || !json?.ok) {
      throw new Error(pickError(json?.error, "Could not load drivers."));
    }
    setDrivers(Array.isArray(json.rows) ? json.rows : []);
    setHiddenDriversCount(Number(json.hiddenCount || 0));
  }

  async function loadAll(nextCityId = cityId) {
    if (!authenticated || !nextCityId) return;
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadPendingApplications(nextCityId), loadDrivers(nextCityId)]);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load driver operations."
      );
    } finally {
      setLoading(false);
    }
  }

  async function approveApplication(applicationId: string) {
    setLoading(true);
    setError("");
    setSuccess("");
    setApprovalArtifact(null);
    try {
      const res = await fetch(
        `/api/admin/driver-applications/${encodeURIComponent(applicationId)}/approve`,
        { method: "POST" }
      );
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as ApprovalResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not approve driver application."));
      }
      setSuccess("Driver approved and account created.");
      setApprovalArtifact({
        driverName: json.driver?.name,
        email: json.driver?.email,
        temporaryPassword: json.temporaryPassword || null,
        loginLink: json.loginLink || null,
        loginLinkExpiresAt: json.loginLinkExpiresAt || null,
      });
      await loadAll();
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not approve driver application."
      );
    } finally {
      setLoading(false);
    }
  }

  async function rejectApplication(applicationId: string) {
    const reason = window.prompt("Rejection reason", "") || "";
    if (!reason.trim()) {
      setError("Rejection reason is required.");
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(
        `/api/admin/driver-applications/${encodeURIComponent(applicationId)}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }
      );
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not reject driver application."));
      }
      setSuccess("Driver application rejected.");
      await loadAll();
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not reject driver application."
      );
    } finally {
      setLoading(false);
    }
  }

  async function revealPhone(driverId: string) {
    const reason = window.prompt("Reason for revealing the full phone number", "") || "";
    if (reason.trim().length < 10) {
      setError("Reveal reason must be at least 10 characters.");
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/drivers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reveal_phone",
          driverId,
          reason,
        }),
      });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: unknown; phoneE164?: string | null }
        | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not reveal phone number."));
      }
      setRevealedPhones((current) => ({
        ...current,
        [driverId]: String(json.phoneE164 || ""),
      }));
      setSuccess("Driver phone revealed for this session.");
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not reveal phone number."
      );
    } finally {
      setLoading(false);
    }
  }

  async function toggleDriverActive(driver: DriverRow) {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/drivers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          driverId: driver.id,
          isActive: !driver.isActive,
        }),
      });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not update driver account."));
      }
      setSuccess(!driver.isActive ? "Driver account activated." : "Driver account deactivated.");
      await loadDrivers(cityId);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not update driver account."
      );
    } finally {
      setLoading(false);
    }
  }

  async function generateLoginLink(driver: DriverRow) {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/drivers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_link",
          driverId: driver.id,
          cityId,
        }),
      });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: unknown;
            linkUrl?: string | null;
            expiresAt?: string | null;
          }
        | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not create driver login link."));
      }
      setSuccess("Driver login link generated.");
      setLastGeneratedLink({
        driverName: driver.name,
        linkUrl: json.linkUrl || null,
        expiresAt: json.expiresAt || null,
      });
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not create driver login link."
      );
    } finally {
      setLoading(false);
    }
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
    bootstrap().catch(() => null);
    return () => {
      active = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!authenticated || !cityId) return;
    loadAll(cityId).catch(() => null);
  }, [authenticated, cityId, showInactiveTestDrivers]); // eslint-disable-line react-hooks/exhaustive-deps

  if (authenticated === null) {
    return (
      <main className="mx-auto min-h-screen max-w-7xl p-6">
        <h1 className="text-2xl font-bold">Driver Operations</h1>
        <p className="mt-2 text-sm text-slate-600">Checking secure admin session...</p>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="mx-auto min-h-screen max-w-7xl p-6">
        <h1 className="text-2xl font-bold">Driver Operations</h1>
        <p className="mt-2 text-sm text-red-600">
          Admin access requires a secure browser session.
        </p>
        <a
          href="/admin/access?next=/admin/drivers"
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Driver Operations</h1>
          <p className="mt-1 text-sm text-slate-600">
            Review pending applications, manage approved driver accounts, and generate secure login links.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/driver-applications"
            className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-800"
          >
            Review Driver Applications
          </Link>
          <button
            type="button"
            onClick={() => loadAll()}
            disabled={loading || !cityId}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-semibold text-slate-700">
            City
            <select
              value={cityId}
              onChange={(event) => setCityId(String(event.target.value || ""))}
              className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">Select city</option>
              {cities.map((city) => (
                <option key={city._id} value={city._id}>
                  {(city.code || "").toUpperCase()} {city.name ? `- ${city.name}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={showInactiveTestDrivers}
              onChange={(event) => setShowInactiveTestDrivers(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Show inactive/test drivers
          </label>
        </div>

        {selectedCity ? (
          <p className="mt-3 text-sm text-slate-500">
            Managing driver operations for {selectedCity.name || selectedCity.code || selectedCity._id}.
          </p>
        ) : null}
      </section>

      {error ? (
        <section className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </section>
      ) : null}

      {success ? (
        <section className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </section>
      ) : null}

      {approvalArtifact ? (
        <section className="mt-4 rounded-2xl border border-emerald-200 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-950">Latest approval credentials</h2>
          <p className="mt-2 text-sm text-slate-700">
            Driver: {approvalArtifact.driverName || "-"}
            {approvalArtifact.email ? ` (${approvalArtifact.email})` : ""}
          </p>
          {approvalArtifact.temporaryPassword ? (
            <p className="mt-2 text-sm text-slate-700">
              Temporary password:{" "}
              <span className="font-semibold text-slate-950">
                {approvalArtifact.temporaryPassword}
              </span>
            </p>
          ) : null}
          {approvalArtifact.loginLink ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <p className="font-semibold text-slate-950">One-time login link</p>
              <p className="mt-2 break-all">{approvalArtifact.loginLink}</p>
              {approvalArtifact.loginLinkExpiresAt ? (
                <p className="mt-2">Expires: {formatDate(approvalArtifact.loginLinkExpiresAt)}</p>
              ) : null}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => copyText(String(approvalArtifact.loginLink || ""))}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"
                >
                  Copy link
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Pending driver applications</h2>
            <p className="text-sm text-slate-500">
              Approve applications to create active driver accounts.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            {pendingApplications.length} pending
          </span>
        </div>

        {pendingApplications.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pendingApplications.map((application) => (
              <article
                key={application.applicationId}
                className="rounded-2xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">
                      {application.fullName || application.name || "Driver application"}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {application.phoneMasked || "-"}
                    </p>
                  </div>
                  <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold uppercase text-orange-700">
                    {application.status}
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-sm text-slate-700">
                  <p>Email: {application.email || "-"}</p>
                  <p>City: {application.city || selectedCity?.name || "-"}</p>
                  <p>Vehicle: {application.vehicleType || "-"}</p>
                  <p>Availability: {application.availability || "-"}</p>
                  <p>Submitted: {formatDate(application.createdAt)}</p>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => approveApplication(application.applicationId)}
                    disabled={loading}
                    className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => rejectApplication(application.applicationId)}
                    disabled={loading}
                    className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
            No pending driver applications for this city.
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Approved drivers</h2>
            <p className="text-sm text-slate-500">
              Active driver accounts, availability status, and support actions.
            </p>
          </div>
          {hiddenDriversCount > 0 && !showInactiveTestDrivers ? (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
              {hiddenDriversCount} inactive/test rows hidden
            </span>
          ) : null}
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Driver</th>
                <th className="px-4 py-3 font-semibold">Phone</th>
                <th className="px-4 py-3 font-semibold">City / zone</th>
                <th className="px-4 py-3 font-semibold">Availability</th>
                <th className="px-4 py-3 font-semibold">Account</th>
                <th className="px-4 py-3 font-semibold">Active orders</th>
                <th className="px-4 py-3 font-semibold">Last location</th>
                <th className="px-4 py-3 font-semibold">Created</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {drivers.length ? (
                drivers.map((driver) => (
                  <tr key={driver.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-950">{driver.name}</div>
                      {driver.email ? (
                        <div className="mt-1 text-xs text-slate-500">{driver.email}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div>{revealedPhones[driver.id] || driver.phoneMasked || "-"}</div>
                      {revealedPhones[driver.id] ? (
                        <div className="mt-1 text-xs text-amber-700">Revealed for this session</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div>{selectedCity?.name || selectedCity?.code || "-"}</div>
                      <div className="mt-1 text-xs text-slate-500">{driver.zoneLabel || "-"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase text-slate-700">
                        {driver.availability || "offline"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase text-slate-700">
                        {driver.accountStatus || "-"}
                      </span>
                    </td>
                    <td className="px-4 py-3">{driver.activeAssignedOrderCount || 0}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {formatDate(driver.lastLocationUpdatedAt)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {formatDate(driver.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => revealPhone(driver.id)}
                          disabled={loading}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                        >
                          Reveal phone
                        </button>
                        <button
                          type="button"
                          onClick={() => generateLoginLink(driver)}
                          disabled={loading}
                          className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-800 disabled:opacity-50"
                        >
                          Generate login link
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleDriverActive(driver)}
                          disabled={loading}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                        >
                          {driver.isActive ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-sm text-slate-500">
                    No drivers found for this city.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-950">Dispatch support tools</h2>
        <p className="mt-1 text-sm text-slate-500">
          Generate secure login links for approved drivers. The link uses the real driver session exchange flow.
        </p>

        {lastGeneratedLink ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-950">
              Latest login link{lastGeneratedLink.driverName ? `: ${lastGeneratedLink.driverName}` : ""}
            </p>
            <p className="mt-2 break-all text-xs">{lastGeneratedLink.linkUrl || "-"}</p>
            <p className="mt-2 text-xs text-slate-500">
              Expires: {formatDate(lastGeneratedLink.expiresAt)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => copyText(String(lastGeneratedLink.linkUrl || ""))}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"
              >
                Copy link
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            Generate a login link from the active drivers table to send a driver into the driver session flow.
          </div>
        )}
      </section>
    </main>
  );
}
