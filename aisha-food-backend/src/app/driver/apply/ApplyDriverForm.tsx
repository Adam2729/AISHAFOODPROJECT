"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  cityId?: string;
  referralCode?: string;
};

type CityRow = {
  _id: string;
  code?: string;
  name?: string;
};

type CitiesResponse = {
  ok?: boolean;
  cities?: CityRow[];
  error?: { message?: string } | string;
};

type ApiResponse = {
  ok?: boolean;
  applicationId?: string;
  status?: string;
  cityId?: string;
  error?: { message?: string } | string;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

export default function ApplyDriverForm({ cityId: initialCityId, referralCode }: Props) {
  const [cities, setCities] = useState<CityRow[]>([]);
  const [cityId, setCityId] = useState(initialCityId || "");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [vehicleType, setVehicleType] = useState("motorbike");
  const [availability, setAvailability] = useState("flexible");
  const [zoneLabel, setZoneLabel] = useState("");
  const [idDocumentUrl, setIdDocumentUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);
  const [successId, setSuccessId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadCities() {
      setLoadingCities(true);
      try {
        const res = await fetch("/api/public/cities", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as CitiesResponse | null;
        if (!res.ok || !json?.ok) {
          throw new Error(pickError(json?.error, "Could not load cities."));
        }
        if (cancelled) return;
        const rows = Array.isArray(json.cities) ? json.cities : [];
        setCities(rows);
        if (!cityId && rows.length) {
          setCityId(String(rows[0]?._id || ""));
        }
      } catch (requestError: unknown) {
        if (!cancelled) {
          setError(
            requestError instanceof Error ? requestError.message : "Could not load cities."
          );
        }
      } finally {
        if (!cancelled) setLoadingCities(false);
      }
    }

    loadCities();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submitDisabled = useMemo(
    () =>
      submitting ||
      loadingCities ||
      !cityId ||
      !fullName.trim() ||
      !phone.trim() ||
      !email.trim(),
    [cityId, email, fullName, loadingCities, phone, submitting]
  );

  async function submit() {
    setSubmitting(true);
    setError("");
    setSuccessId("");
    try {
      const res = await fetch("/api/driver/apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-city-id": cityId,
        },
        body: JSON.stringify({
          fullName,
          phone,
          email,
          vehicleType,
          availability,
          idDocumentUrl,
          zoneLabel,
          notes,
          referredByCode: referralCode || undefined,
        }),
      });
      const json = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok || !json?.ok || !json.applicationId) {
        throw new Error(pickError(json?.error, "Could not submit application."));
      }
      setSuccessId(json.applicationId);
      setFullName("");
      setPhone("");
      setEmail("");
      setVehicleType("motorbike");
      setAvailability("flexible");
      setZoneLabel("");
      setIdDocumentUrl("");
      setNotes("");
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not submit application."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      {referralCode ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Referral detected: <span className="font-semibold">{referralCode}</span>. If approved,
          the referring driver receives a signup bonus.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

        {successId ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Application received. We will contact you on WhatsApp. ID:{" "}
          <span className="font-semibold">{successId}</span>
          </div>
        ) : null}

      <div className="grid gap-3">
        <label className="text-sm font-medium text-slate-700">
          Full name
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Driver name"
            className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none"
          />
        </label>

        <label className="text-sm font-medium text-slate-700">
          Phone
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+1 809... or +223..."
            className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none"
          />
        </label>

        <label className="text-sm font-medium text-slate-700">
          Email
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="driver@example.com"
            type="email"
            className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none"
          />
        </label>

        <label className="text-sm font-medium text-slate-700">
          Vehicle type
          <select
            value={vehicleType}
            onChange={(event) => setVehicleType(String(event.target.value || "motorbike"))}
            className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none"
          >
            <option value="motorbike">Motorbike</option>
            <option value="bike">Bike</option>
            <option value="car">Car</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label className="text-sm font-medium text-slate-700">
          Availability
          <select
            value={availability}
            onChange={(event) => setAvailability(String(event.target.value || "flexible"))}
            className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none"
          >
            <option value="flexible">Flexible</option>
            <option value="full_time">Full time</option>
            <option value="part_time">Part time</option>
            <option value="evenings">Evenings</option>
            <option value="weekends">Weekends</option>
          </select>
        </label>

        <label className="text-sm font-medium text-slate-700">
          City
          <select
            value={cityId}
            onChange={(event) => setCityId(String(event.target.value || ""))}
            className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none"
          >
            <option value="">{loadingCities ? "Loading cities..." : "Select city"}</option>
            {cities.map((city) => (
              <option key={city._id} value={city._id}>
                {city.name || city.code || city._id}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-medium text-slate-700">
          Zone
          <input
            value={zoneLabel}
            onChange={(event) => setZoneLabel(event.target.value)}
            placeholder="Neighborhood or zone"
            className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none"
          />
        </label>

        <label className="text-sm font-medium text-slate-700">
          ID document URL
          <input
            value={idDocumentUrl}
            onChange={(event) => setIdDocumentUrl(event.target.value)}
            placeholder="Optional document link"
            className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none"
          />
        </label>

        <label className="text-sm font-medium text-slate-700">
          Notes
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional notes about schedule or documents"
            rows={3}
            className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={submitDisabled}
        className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {submitting ? "Submitting..." : "Submit driver application"}
      </button>
    </div>
  );
}
