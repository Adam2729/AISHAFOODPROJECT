"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type DaySchedule = {
  open: string;
  close: string;
  closed: boolean;
};

type SettingsResponse = {
  ok?: boolean;
  business?: {
    id: string;
    name: string;
    isManuallyPaused?: boolean;
    busyUntil?: string | null;
    hours?: {
      timezone?: string;
      weekly?: Partial<Record<DayKey, Partial<DaySchedule>>>;
    };
  };
  error?: { message?: string } | string;
};

const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

function defaultWeekly(): Record<DayKey, DaySchedule> {
  return {
    mon: { open: "08:00", close: "22:00", closed: false },
    tue: { open: "08:00", close: "22:00", closed: false },
    wed: { open: "08:00", close: "22:00", closed: false },
    thu: { open: "08:00", close: "22:00", closed: false },
    fri: { open: "08:00", close: "22:00", closed: false },
    sat: { open: "08:00", close: "22:00", closed: false },
    sun: { open: "08:00", close: "22:00", closed: false },
  };
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

export default function MerchantSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busySaving, setBusySaving] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [businessName, setBusinessName] = useState("Merchant");
  const [timezone, setTimezone] = useState("America/Santo_Domingo");
  const [isManuallyPaused, setIsManuallyPaused] = useState(false);
  const [busyUntil, setBusyUntil] = useState<string | null>(null);
  const [weekly, setWeekly] = useState<Record<DayKey, DaySchedule>>(defaultWeekly());

  const busyActive = useMemo(() => {
    if (!busyUntil) return false;
    const date = new Date(busyUntil);
    return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
  }, [busyUntil]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/merchant/business/settings", { cache: "no-store" });
      const json = (await res.json()) as SettingsResponse;
      if (!res.ok || !json?.ok || !json.business) {
        const message =
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          "Failed to load settings";
        setError(message);
        if (res.status === 401) router.push("/merchant/login");
        if ((json as { error?: { code?: string } })?.error?.code === "PIN_CHANGE_REQUIRED") {
          router.push("/merchant/set-pin");
        }
        return;
      }

      const nextWeekly = defaultWeekly();
      for (const day of DAY_KEYS) {
        const source = json.business.hours?.weekly?.[day] || {};
        nextWeekly[day] = {
          open: String(source.open || "08:00"),
          close: String(source.close || "22:00"),
          closed: Boolean(source.closed),
        };
      }

      setBusinessName(String(json.business.name || "Merchant"));
      setTimezone(String(json.business.hours?.timezone || "America/Santo_Domingo"));
      setIsManuallyPaused(Boolean(json.business.isManuallyPaused));
      setBusyUntil(json.business.busyUntil || null);
      setWeekly(nextWeekly);
    } catch {
      setError("Could not load business settings.");
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/merchant/business/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isManuallyPaused,
          hours: {
            timezone,
            weekly,
          },
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        const message =
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          "Could not save settings.";
        setError(message);
        return;
      }
      setSuccess("Settings saved.");
      await load();
    } catch {
      setError("Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function setBusy(minutes: 0 | 30 | 45 | 60) {
    setBusySaving(minutes);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/merchant/business/busy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        const message =
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          "Could not update busy mode.";
        setError(message);
        return;
      }
      setBusyUntil(json?.busyUntil || null);
      setSuccess(minutes === 0 ? "Busy mode cleared." : `Busy mode set for ${minutes} minutes.`);
    } catch {
      setError("Could not update busy mode.");
    } finally {
      setBusySaving(null);
    }
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Merchant Settings</h1>
          <p className="text-sm text-slate-600">{businessName}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/merchant/orders" className="rounded-lg border px-3 py-2 text-sm">
            Orders
          </Link>
          <Link href="/merchant/finance" className="rounded-lg border px-3 py-2 text-sm">
            Finance
          </Link>
          <Link href="/merchant/products" className="rounded-lg border px-3 py-2 text-sm">
            Products
          </Link>
        </div>
      </div>

      {loading ? <p className="text-sm text-slate-600">Loading settings...</p> : null}
      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mb-3 text-sm text-emerald-700">{success}</p> : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Busy Mode</h2>
          <p className="mt-1 text-sm text-slate-600">
            Status: {busyActive ? `BUSY until ${formatDateTime(busyUntil)}` : "Not busy"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[30, 45, 60].map((minutes) => (
              <button
                key={minutes}
                type="button"
                disabled={busySaving !== null}
                onClick={() => setBusy(minutes as 30 | 45 | 60)}
                className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold"
              >
                {busySaving === minutes ? "Saving..." : `${minutes} min`}
              </button>
            ))}
            <button
              type="button"
              disabled={busySaving !== null}
              onClick={() => setBusy(0)}
              className="rounded border border-red-300 px-3 py-2 text-sm font-semibold text-red-700"
            >
              {busySaving === 0 ? "Saving..." : "Clear"}
            </button>
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Manual Pause</h2>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isManuallyPaused}
              onChange={(e) => setIsManuallyPaused(e.target.checked)}
            />
            Pause new orders
          </label>
          <p className="mt-2 text-xs text-slate-500">
            Manual pause blocks new orders until turned off.
          </p>
        </article>
      </section>

      <form onSubmit={saveSettings} className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Business Hours</h2>
        <div className="mt-3 max-w-md">
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Timezone</label>
          <input
            className="input"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="America/Santo_Domingo"
          />
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Day</th>
                <th className="pb-2">Closed</th>
                <th className="pb-2">Open</th>
                <th className="pb-2">Close</th>
              </tr>
            </thead>
            <tbody>
              {DAY_KEYS.map((day) => (
                <tr key={day} className="border-t border-slate-100">
                  <td className="py-2 font-medium">{DAY_LABELS[day]}</td>
                  <td className="py-2">
                    <input
                      type="checkbox"
                      checked={weekly[day].closed}
                      onChange={(e) =>
                        setWeekly((prev) => ({
                          ...prev,
                          [day]: { ...prev[day], closed: e.target.checked },
                        }))
                      }
                    />
                  </td>
                  <td className="py-2">
                    <input
                      className="input"
                      type="time"
                      value={weekly[day].open}
                      disabled={weekly[day].closed}
                      onChange={(e) =>
                        setWeekly((prev) => ({
                          ...prev,
                          [day]: { ...prev[day], open: e.target.value },
                        }))
                      }
                    />
                  </td>
                  <td className="py-2">
                    <input
                      className="input"
                      type="time"
                      value={weekly[day].close}
                      disabled={weekly[day].closed}
                      onChange={(e) =>
                        setWeekly((prev) => ({
                          ...prev,
                          [day]: { ...prev[day], close: e.target.value },
                        }))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </form>

      <style jsx>{`
        .input {
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          padding: 0.5rem 0.65rem;
        }
      `}</style>
    </main>
  );
}
