"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MerchantPortalShell from "@/app/merchant/MerchantPortalShell";
import { useMerchantLaunchProfile } from "@/app/merchant/useMerchantLaunchProfile";
import { formatDateTimeForProfile } from "@/lib/marketFormatting";

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
    ownerName?: string;
    email?: string;
    phone?: string;
    whatsapp?: string;
    address?: string;
    area?: string;
    logoUrl?: string;
    coverImageUrl?: string;
    deliveryType?: "own_driver" | "platform_driver";
    minimumOrderAmount?: number;
    deliveryRadiusKm?: number;
    autoAcceptOrders?: boolean;
    eta?: {
      prepMins?: number;
    };
    payout?: {
      preferredMethod?: string;
      details?: string;
      payoutContactName?: string;
      accountName?: string;
      accountNumber?: string;
      notes?: string;
    };
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
const INPUT_CLASS_NAME = "rounded-xl border border-slate-300 px-3 py-2.5";

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

export default function MerchantSettingsPage() {
  const router = useRouter();
  const { market } = useMerchantLaunchProfile();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busySaving, setBusySaving] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [businessName, setBusinessName] = useState("Merchant");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [address, setAddress] = useState("");
  const [area, setArea] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [deliveryType, setDeliveryType] = useState<"own_driver" | "platform_driver">("own_driver");
  const [minimumOrderAmount, setMinimumOrderAmount] = useState("0");
  const [deliveryRadiusKm, setDeliveryRadiusKm] = useState("8");
  const [prepMins, setPrepMins] = useState("15");
  const [autoAcceptOrders, setAutoAcceptOrders] = useState(false);
  const [payoutMethod, setPayoutMethod] = useState("cash");
  const [payoutAccountName, setPayoutAccountName] = useState("");
  const [payoutAccountNumber, setPayoutAccountNumber] = useState("");
  const [payoutNotes, setPayoutNotes] = useState("");

  const [timezone, setTimezone] = useState("");
  const [isManuallyPaused, setIsManuallyPaused] = useState(false);
  const [busyUntil, setBusyUntil] = useState<string | null>(null);
  const [weekly, setWeekly] = useState<Record<DayKey, DaySchedule>>(defaultWeekly());
  const formatDateTime = (value: string | null | undefined) =>
    formatDateTimeForProfile(value, market);

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
      setOwnerName(String(json.business.ownerName || ""));
      setEmail(String(json.business.email || ""));
      setPhone(String(json.business.phone || ""));
      setWhatsapp(String(json.business.whatsapp || ""));
      setAddress(String(json.business.address || ""));
      setArea(String(json.business.area || ""));
      setLogoUrl(String(json.business.logoUrl || ""));
      setCoverImageUrl(String(json.business.coverImageUrl || ""));
      setDeliveryType(json.business.deliveryType || "own_driver");
      setMinimumOrderAmount(String(json.business.minimumOrderAmount || 0));
      setDeliveryRadiusKm(String(json.business.deliveryRadiusKm || 8));
      setPrepMins(String(json.business.eta?.prepMins || 15));
      setAutoAcceptOrders(Boolean(json.business.autoAcceptOrders));
      setPayoutMethod(String(json.business.payout?.preferredMethod || "cash"));
      setPayoutAccountName(
        String(
          json.business.payout?.accountName ||
            json.business.payout?.payoutContactName ||
            ""
        )
      );
      setPayoutAccountNumber(String(json.business.payout?.accountNumber || ""));
      setPayoutNotes(String(json.business.payout?.notes || json.business.payout?.details || ""));
      setTimezone(String(json.business.hours?.timezone || market.defaultTimezone || ""));
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
          name: businessName,
          ownerName,
          email,
          phone,
          whatsapp,
          address,
          area,
          logoUrl,
          coverImageUrl,
          deliveryType,
          minimumOrderAmount: Number(minimumOrderAmount || 0),
          deliveryRadiusKm: Number(deliveryRadiusKm || 0),
          autoAcceptOrders,
          eta: {
            prepMins: Number(prepMins || 0),
          },
          payout: {
            preferredMethod: payoutMethod,
            details: payoutNotes,
            payoutContactName: payoutAccountName,
            accountName: payoutAccountName,
            accountNumber: payoutAccountNumber,
            notes: payoutNotes,
          },
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
    <MerchantPortalShell
      title="Settings"
      subtitle="Manage store profile, operating hours, delivery setup, and payout preferences."
    >
      {loading ? <p className="text-sm text-slate-600">Loading settings...</p> : null}
      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mb-3 text-sm text-emerald-700">{success}</p> : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Store status</h2>
          <p className="mt-1 text-sm text-slate-600">
            Busy mode: {busyActive ? `Active until ${formatDateTime(busyUntil)}` : "Off"}
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
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isManuallyPaused}
              onChange={(e) => setIsManuallyPaused(e.target.checked)}
            />
            Pause new orders
          </label>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Delivery setup</h2>
          <div className="mt-3 grid gap-3">
            <select
              value={deliveryType}
              onChange={(e) =>
                setDeliveryType(e.target.value as "own_driver" | "platform_driver")
              }
              className={INPUT_CLASS_NAME}
            >
              <option value="own_driver">Own drivers</option>
              <option value="platform_driver">Aisha Food drivers</option>
            </select>
            <input
              className={INPUT_CLASS_NAME}
              value={deliveryRadiusKm}
              onChange={(e) => setDeliveryRadiusKm(e.target.value)}
              placeholder="Delivery radius (km)"
            />
            <input
              className={INPUT_CLASS_NAME}
              value={prepMins}
              onChange={(e) => setPrepMins(e.target.value)}
              placeholder="Average prep time (minutes)"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoAcceptOrders}
                onChange={(e) => setAutoAcceptOrders(e.target.checked)}
              />
              Auto accept incoming orders
            </label>
          </div>
        </article>
      </section>

      <form onSubmit={saveSettings} className="mt-6 space-y-6">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Store profile</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <input className={INPUT_CLASS_NAME} value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Business name" />
            <input className={INPUT_CLASS_NAME} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Owner full name" />
            <input className={INPUT_CLASS_NAME} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" />
            <input className={INPUT_CLASS_NAME} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
            <input className={INPUT_CLASS_NAME} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="WhatsApp" />
            <input className={INPUT_CLASS_NAME} value={area} onChange={(e) => setArea(e.target.value)} placeholder="Area / neighborhood" />
            <input className={`${INPUT_CLASS_NAME} md:col-span-2`} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Full address" />
            <input className={INPUT_CLASS_NAME} value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="Logo URL" />
            <input className={INPUT_CLASS_NAME} value={coverImageUrl} onChange={(e) => setCoverImageUrl(e.target.value)} placeholder="Cover image URL" />
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Operations and payouts</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <input
              className={INPUT_CLASS_NAME}
              value={minimumOrderAmount}
              onChange={(e) => setMinimumOrderAmount(e.target.value)}
              placeholder="Minimum order amount"
            />
            <input
              className={INPUT_CLASS_NAME}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder={market.defaultTimezone}
            />
            <select
              value={payoutMethod}
              onChange={(e) => setPayoutMethod(e.target.value)}
              className={INPUT_CLASS_NAME}
            >
              <option value="cash">cash</option>
              <option value="bank_transfer">bank_transfer</option>
              <option value="orange_money">orange_money</option>
              <option value="moov_money">moov_money</option>
              <option value="wave">wave</option>
            </select>
            <input
              className={INPUT_CLASS_NAME}
              value={payoutAccountName}
              onChange={(e) => setPayoutAccountName(e.target.value)}
              placeholder="Account holder name"
            />
            <input
              className={INPUT_CLASS_NAME}
              value={payoutAccountNumber}
              onChange={(e) => setPayoutAccountNumber(e.target.value)}
              placeholder="Payout phone/account number"
            />
            <textarea
              className={`${INPUT_CLASS_NAME} md:col-span-2`}
              value={payoutNotes}
              onChange={(e) => setPayoutNotes(e.target.value)}
              placeholder="Optional payout notes"
              rows={3}
            />
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Business hours</h2>
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
                        className={INPUT_CLASS_NAME}
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
                        className={INPUT_CLASS_NAME}
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
              {saving ? "Saving..." : "Save settings"}
            </button>
          </div>
        </section>
      </form>

    </MerchantPortalShell>
  );
}
