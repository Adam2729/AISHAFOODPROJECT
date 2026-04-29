"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type DriverRow = {
  id: string;
  name: string;
  isActive: boolean;
  accountStatus?: string;
  availability?: string;
  breakStartedAt?: string | null;
  breakReason?: string | null;
  lastSeenAt?: string | null;
  lastLocationUpdatedAt?: string | null;
  activeAssignedOrderCount?: number;
  zoneLabel?: string | null;
  notes?: string | null;
  hasPhone?: boolean;
  phoneMasked?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type DraftRow = {
  name: string;
  isActive: boolean;
  zoneLabel: string;
  notes: string;
  phoneE164: string;
};

type ApiResponse = {
  ok: boolean;
  rows?: DriverRow[];
  driver?: DriverRow;
  phoneE164?: string | null;
  url?: string;
  error?: { message?: string } | string;
};

type CityOption = {
  id: string;
  name: string;
  code: string;
};

function getErrorMessage(json: ApiResponse | null, fallback: string) {
  return (typeof json?.error === "string" ? json.error : json?.error?.message) || fallback;
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("en-GB", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function AdminDriversPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [cities, setCities] = useState<CityOption[]>([]);
  const [selectedCityId, setSelectedCityId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [revealedPhones, setRevealedPhones] = useState<Record<string, string>>({});
  const [linkByDriver, setLinkByDriver] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [createName, setCreateName] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createZone, setCreateZone] = useState("");
  const [createNotes, setCreateNotes] = useState("");
  const [createActive, setCreateActive] = useState(true);

  function initializeDraftRows(rows: DriverRow[]) {
    const next: Record<string, DraftRow> = {};
    for (const row of rows) {
      next[row.id] = {
        name: String(row.name || ""),
        isActive: Boolean(row.isActive),
        zoneLabel: String(row.zoneLabel || ""),
        notes: String(row.notes || ""),
        phoneE164: "",
      };
    }
    setDrafts(next);
  }

  async function loadDrivers() {
    if (!authenticated || !selectedCityId) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        cityId: selectedCityId,
      });
      const res = await fetch(`/api/admin/drivers?${params.toString()}`, { cache: "no-store" });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(getErrorMessage(json, "Could not load drivers."));
      }
      const rows = Array.isArray(json.rows) ? json.rows : [];
      setDrivers(rows);
      initializeDraftRows(rows);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not load drivers.");
    } finally {
      setLoading(false);
    }
  }

  async function loadCities() {
    if (!authenticated) return;
    try {
      const res = await fetch("/api/admin/cities", {
        cache: "no-store",
      });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        cities?: Array<{ _id: string; name?: string; code?: string }>;
        error?: { message?: string } | string;
      } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(getErrorMessage(json as ApiResponse, "Could not load cities."));
      }
      const rows =
        Array.isArray(json.cities) && json.cities.length
          ? json.cities.map((c) => ({
              id: String(c._id),
              name: String(c.name || ""),
              code: String(c.code || ""),
            }))
          : [];
      setCities(rows);
      if (!selectedCityId && rows.length) {
        const bamako = rows.find((c) => c.code.toUpperCase() === "BKO");
        setSelectedCityId(String((bamako || rows[0]).id));
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load cities.");
    }
  }

  async function createDriver() {
    if (!createName.trim()) {
      setError("Driver name is required.");
      return;
    }
    if (!selectedCityId) {
      setError("Select a city first.");
      return;
    }
    setSaving("create");
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          phoneE164: createPhone.trim(),
          zoneLabel: createZone.trim(),
          notes: createNotes.trim(),
          isActive: createActive,
          cityId: selectedCityId,
        }),
      });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(getErrorMessage(json, "Could not create driver."));
      }
      setCreateName("");
      setCreatePhone("");
      setCreateZone("");
      setCreateNotes("");
      setCreateActive(true);
      setSuccess("Driver created.");
      await loadDrivers();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not create driver.");
    } finally {
      setSaving("");
    }
  }

  async function saveDriver(driverId: string) {
    const draft = drafts[driverId];
    if (!draft) return;
    setSaving(`save:${driverId}`);
    setError("");
    setSuccess("");
    try {
      const payload: Record<string, unknown> = {
        action: "update",
        driverId,
        name: draft.name.trim(),
        zoneLabel: draft.zoneLabel.trim(),
        notes: draft.notes.trim(),
        isActive: Boolean(draft.isActive),
      };
      if (draft.phoneE164.trim()) {
        payload.phoneE164 = draft.phoneE164.trim();
      }
      const res = await fetch("/api/admin/drivers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(getErrorMessage(json, "Could not update driver."));
      }
      setSuccess("Driver updated.");
      await loadDrivers();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not update driver.");
    } finally {
      setSaving("");
    }
  }

  async function revealPhone(driverId: string) {
    const confirm = window.prompt("Type REVEAL to show raw phone.", "");
    if (confirm !== "REVEAL") return;
    const reason = window.prompt("Reason for reveal (min 10 chars).", "") || "";
    if (reason.trim().length < 10) {
      setError("Reason must be at least 10 characters.");
      return;
    }
    setSaving(`reveal:${driverId}`);
    setError("");
    try {
      const res = await fetch("/api/admin/drivers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reveal_phone",
          driverId,
          confirm: "REVEAL",
          reason: reason.trim(),
        }),
      });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(getErrorMessage(json, "Could not reveal phone."));
      }
      setRevealedPhones((prev) => ({
        ...prev,
        [driverId]: String(json.phoneE164 || ""),
      }));
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not reveal phone.");
    } finally {
      setSaving("");
    }
  }

  async function generateLink(driverId: string) {
    const confirm = window.prompt("Type REVEAL LINK to generate a driver URL.", "");
    if (confirm !== "REVEAL LINK") return;
    if (!selectedCityId) {
      setError("Select a city before generating links.");
      return;
    }
    setSaving(`link:${driverId}`);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/drivers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_link",
          driverId,
          confirm: "REVEAL LINK",
          cityId: selectedCityId,
        }),
      });
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      const json = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(getErrorMessage(json, "Could not generate driver link."));
      }
      const link = String(json.url || "");
      setLinkByDriver((prev) => ({ ...prev, [driverId]: link }));
      if (link && navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(link).catch(() => null);
      }
      setSuccess("Driver link generated.");
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not generate driver link.");
    } finally {
      setSaving("");
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
    loadCities();
  }, [authenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!authenticated || !selectedCityId) return;
    loadDrivers();
  }, [authenticated, selectedCityId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (authenticated === null) return null;

  if (!authenticated) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Drivers</h1>
        <p className="mt-2 text-sm text-red-600">
          Admin access requires a secure browser session.
        </p>
        <Link
          href="/admin/access?next=/admin/drivers"
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Dispatch Drivers</h1>
          <p className="text-sm text-slate-600">Create, update, and manage driver links.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">
            <span>Link city</span>
            <select
              value={selectedCityId}
              onChange={(event) => setSelectedCityId(event.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-sm"
            >
              {!selectedCityId ? <option value="">Select</option> : null}
              {cities.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.code || city.name}
                </option>
              ))}
            </select>
          </label>
          <Link
            href="/admin/ops"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Ops Center
          </Link>
          <button
            type="button"
            onClick={loadDrivers}
            disabled={loading || !selectedCityId}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mb-3 text-sm text-emerald-700">{success}</p> : null}

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold">Create Driver</h2>
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-5">
          <input
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder="Name"
            className="rounded border border-slate-300 px-2 py-2 text-sm"
          />
          <input
            value={createPhone}
            onChange={(event) => setCreatePhone(event.target.value)}
            placeholder="Phone E164 (optional)"
            className="rounded border border-slate-300 px-2 py-2 text-sm"
          />
          <input
            value={createZone}
            onChange={(event) => setCreateZone(event.target.value)}
            placeholder="Zone label"
            className="rounded border border-slate-300 px-2 py-2 text-sm"
          />
          <input
            value={createNotes}
            onChange={(event) => setCreateNotes(event.target.value)}
            placeholder="Notes"
            className="rounded border border-slate-300 px-2 py-2 text-sm"
          />
          <label className="flex items-center gap-2 rounded border border-slate-300 px-2 py-2 text-sm">
            <input
              type="checkbox"
              checked={createActive}
              onChange={(event) => setCreateActive(event.target.checked)}
            />
            Active
          </label>
        </div>
        <button
          type="button"
          disabled={saving === "create"}
          onClick={createDriver}
          className="mt-3 rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
        >
          {saving === "create" ? "Creating..." : "Create driver"}
        </button>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold">Drivers</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Name</th>
                <th className="pb-2">Zone</th>
                <th className="pb-2">Phone</th>
                <th className="pb-2">Ops state</th>
                <th className="pb-2">Active</th>
                <th className="pb-2">Notes</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {drivers.length ? (
                drivers.map((driver) => {
                  const draft = drafts[driver.id] || {
                    name: driver.name,
                    isActive: driver.isActive,
                    zoneLabel: String(driver.zoneLabel || ""),
                    notes: String(driver.notes || ""),
                    phoneE164: "",
                  };
                  const phoneValue = revealedPhones[driver.id] || "";
                  const linkValue = linkByDriver[driver.id] || "";
                  return (
                    <tr key={driver.id} className="border-t border-slate-100 align-top">
                      <td className="py-2">
                        <input
                          value={draft.name}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [driver.id]: {
                                ...draft,
                                name: event.target.value,
                              },
                            }))
                          }
                          className="w-full min-w-[180px] rounded border border-slate-300 px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="py-2">
                        <input
                          value={draft.zoneLabel}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [driver.id]: {
                                ...draft,
                                zoneLabel: event.target.value,
                              },
                            }))
                          }
                          className="w-full min-w-[140px] rounded border border-slate-300 px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="py-2">
                        <div className="space-y-1">
                          <div>{driver.phoneMasked || "-"}</div>
                          {phoneValue ? (
                            <div className="font-mono text-xs text-amber-700">{phoneValue}</div>
                          ) : null}
                          <input
                            value={draft.phoneE164}
                            onChange={(event) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [driver.id]: {
                                  ...draft,
                                  phoneE164: event.target.value,
                                },
                              }))
                            }
                            placeholder="New phone (optional)"
                            className="w-full min-w-[160px] rounded border border-slate-300 px-2 py-1 text-xs"
                          />
                        </div>
                      </td>
                      <td className="py-2">
                        <div className="min-w-[190px] space-y-1 text-xs text-slate-600">
                          <div>
                            <span className="font-semibold text-slate-900">Availability:</span>{" "}
                            {driver.availability || "offline"}
                          </div>
                          <div>
                            <span className="font-semibold text-slate-900">Account:</span>{" "}
                            {driver.accountStatus || (driver.isActive ? "active" : "inactive")}
                          </div>
                          {driver.breakReason ? (
                            <div>
                              <span className="font-semibold text-slate-900">Break:</span>{" "}
                              {driver.breakReason} since {formatDateTime(driver.breakStartedAt)}
                            </div>
                          ) : null}
                          <div>
                            <span className="font-semibold text-slate-900">Active orders:</span>{" "}
                            {Number(driver.activeAssignedOrderCount || 0)}
                          </div>
                          <div>
                            <span className="font-semibold text-slate-900">Location:</span>{" "}
                            {formatDateTime(driver.lastLocationUpdatedAt)}
                          </div>
                        </div>
                      </td>
                      <td className="py-2">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={draft.isActive}
                            onChange={(event) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [driver.id]: {
                                  ...draft,
                                  isActive: event.target.checked,
                                },
                              }))
                            }
                          />
                          <span>{draft.isActive ? "yes" : "no"}</span>
                        </label>
                      </td>
                      <td className="py-2">
                        <input
                          value={draft.notes}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [driver.id]: {
                                ...draft,
                                notes: event.target.value,
                              },
                            }))
                          }
                          className="w-full min-w-[180px] rounded border border-slate-300 px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            disabled={Boolean(saving)}
                            onClick={() => saveDriver(driver.id)}
                            className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                          >
                            {saving === `save:${driver.id}` ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(saving)}
                            onClick={() => revealPhone(driver.id)}
                            className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                          >
                            {saving === `reveal:${driver.id}` ? "Revealing..." : "Reveal phone"}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(saving)}
                            onClick={() => generateLink(driver.id)}
                            className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                          >
                            {saving === `link:${driver.id}` ? "Generating..." : "Generate link"}
                          </button>
                        </div>
                        {linkValue ? (
                          <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs">
                            <div className="break-all font-mono">{linkValue}</div>
                            <button
                              type="button"
                              onClick={() => navigator.clipboard?.writeText(linkValue).catch(() => null)}
                              className="mt-1 rounded border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700"
                            >
                              Copy link
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="py-3 text-center text-slate-500">
                    No drivers found.
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
