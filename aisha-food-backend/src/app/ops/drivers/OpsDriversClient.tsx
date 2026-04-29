"use client";

import { useEffect, useMemo, useState } from "react";

type CityRow = {
  _id: string;
  code?: string;
  slug?: string;
  name?: string;
  isActive?: boolean;
};

type DriverRow = {
  id: string;
  name: string;
  isActive: boolean;
  zoneLabel?: string | null;
};

type DriversResponse = {
  ok?: boolean;
  drivers?: DriverRow[];
  error?: { message?: string } | string;
};

type CitiesResponse = {
  ok?: boolean;
  cities?: CityRow[];
  error?: { message?: string } | string;
};

type SessionLinkResponse = {
  ok?: boolean;
  driverId?: string;
  driverName?: string;
  cityId?: string;
  linkUrl?: string;
  whatsappText?: string;
  expiresAt?: string;
  error?: { message?: string } | string;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

function copyText(value: string) {
  return navigator.clipboard.writeText(String(value || ""));
}

export default function OpsDriversClient({
  adminKey,
  initialCityId,
}: {
  adminKey: string;
  initialCityId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [cities, setCities] = useState<CityRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [selectedCityId, setSelectedCityId] = useState(initialCityId);
  const [manualDriverId, setManualDriverId] = useState("");
  const [generatingFor, setGeneratingFor] = useState("");
  const [generated, setGenerated] = useState<SessionLinkResponse | null>(null);

  async function loadResources() {
    setLoading(true);
    setError("");
    try {
      const [citiesRes, driversRes] = await Promise.all([
        fetch(`/api/admin/cities`, { cache: "no-store" }),
        fetch(`/api/admin/drivers`, { cache: "no-store" }),
      ]);
      const citiesJson = (await citiesRes.json().catch(() => null)) as CitiesResponse | null;
      const driversJson = (await driversRes.json().catch(() => null)) as DriversResponse | null;

      if (!citiesRes.ok || !citiesJson?.ok) {
        throw new Error(pickError(citiesJson?.error, "Could not load cities."));
      }
      if (!driversRes.ok || !driversJson?.ok) {
        throw new Error(pickError(driversJson?.error, "Could not load drivers."));
      }

      const cityRows = Array.isArray(citiesJson.cities) ? citiesJson.cities : [];
      const driverRows = Array.isArray(driversJson.drivers) ? driversJson.drivers : [];
      setCities(cityRows);
      setDrivers(driverRows);
      if (!selectedCityId && cityRows.length) {
        const preferred =
          cityRows.find((city) => String(city.code || "").toUpperCase() === "BKO") || cityRows[0];
        setSelectedCityId(String(preferred._id || ""));
      }
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not load drivers page data."
      );
      setDrivers([]);
      setCities([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadResources();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCity = useMemo(
    () => cities.find((city) => String(city._id) === String(selectedCityId)) || null,
    [cities, selectedCityId]
  );
  const isBamako = String(selectedCity?.code || "").toUpperCase() === "BKO";

  async function createLink(driverIdInput: string) {
    const driverId = String(driverIdInput || "").trim();
    if (!driverId) {
      setError("Driver ID is required.");
      return;
    }
    if (!selectedCityId) {
      setError("Select a city first.");
      return;
    }

    setGeneratingFor(driverId);
    setError("");
    setSuccess("");
    setGenerated(null);
    try {
      const res = await fetch(
        `/api/ops/drivers/${encodeURIComponent(
          driverId
        )}/session-link?cityId=${encodeURIComponent(selectedCityId)}`,
        {
          method: "POST",
        }
      );
      const json = (await res.json().catch(() => null)) as SessionLinkResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(pickError(json?.error, "Could not create session link."));
      }
      setGenerated(json);
      setSuccess("Shift link created.");
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not create session link.");
    } finally {
      setGeneratingFor("");
    }
  }

  return (
    <section className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">City</span>
            <select
              value={selectedCityId}
              onChange={(event) => setSelectedCityId(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2"
            >
              {cities.map((city) => (
                <option key={city._id} value={city._id}>
                  {String(city.name || "City")} ({String(city.code || city.slug || "CITY").toUpperCase()})
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm md:col-span-2">
            <span className="mb-1 block text-slate-600">Manual driverId input</span>
            <div className="flex gap-2">
              <input
                value={manualDriverId}
                onChange={(event) => setManualDriverId(event.target.value)}
                placeholder="64f1..."
                className="w-full rounded border border-slate-300 px-3 py-2"
              />
              <button
                type="button"
                onClick={() => createLink(manualDriverId)}
                disabled={loading || generatingFor === manualDriverId}
                className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Create WhatsApp Link
              </button>
            </div>
          </label>
        </div>

        {!isBamako ? (
          <p className="mt-2 text-xs text-amber-700">
            Driver web links are currently supported only for Bamako (BKO).
          </p>
        ) : null}
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

      {generated?.linkUrl ? (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h2 className="text-sm font-semibold text-emerald-900">Generated link</h2>
          <p className="mt-2 break-all text-xs text-emerald-900">{generated.linkUrl}</p>
          <p className="mt-1 text-xs text-emerald-900">
            Expires: {generated.expiresAt ? new Date(generated.expiresAt).toLocaleString() : "-"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  await copyText(String(generated.linkUrl || ""));
                  setSuccess("Link copied.");
                } catch {
                  setError("Could not copy link.");
                }
              }}
              className="rounded border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800"
            >
              Copy link
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await copyText(String(generated.whatsappText || ""));
                  setSuccess("WhatsApp text copied.");
                } catch {
                  setError("Could not copy WhatsApp text.");
                }
              }}
              className="rounded border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800"
            >
              Copy WhatsApp text
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Drivers</h2>
          <button
            type="button"
            onClick={loadResources}
            disabled={loading}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th className="border-b py-2">Name</th>
                <th className="border-b py-2">Driver ID</th>
                <th className="border-b py-2">Zone</th>
                <th className="border-b py-2">Active</th>
                <th className="border-b py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((row) => (
                <tr key={row.id} className="border-b last:border-b-0">
                  <td className="py-2">{row.name || "-"}</td>
                  <td className="py-2 font-mono text-xs">{row.id}</td>
                  <td className="py-2">{row.zoneLabel || "-"}</td>
                  <td className="py-2">{row.isActive ? "Yes" : "No"}</td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => createLink(row.id)}
                      disabled={!row.isActive || loading || Boolean(generatingFor)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold disabled:opacity-50"
                    >
                      {generatingFor === row.id ? "Creating..." : "Create WhatsApp Link"}
                    </button>
                  </td>
                </tr>
              ))}
              {!drivers.length ? (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-slate-500">
                    No drivers found.
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
