"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ACTIVE_MERCHANT_TYPES,
  DELIVERY_TYPES,
  PAYOUT_METHODS,
  defaultDeliveryTypeForMarket,
  getDeliveryTypeLabel,
  getMerchantTypeDescription,
  getMerchantTypeLabel,
  normalizeMerchantType,
  type ActiveMerchantType,
  type DeliveryType,
  type PayoutMethod,
} from "@/lib/merchantOnboarding";

type Props = {
  cityId?: string;
  referralCode?: string;
  prefillMerchantType?: ActiveMerchantType;
};

type CityRow = {
  _id: string;
  code?: string;
  slug?: string;
  name?: string;
  country?: string;
  marketCode?: "DO" | "ML";
  defaultLanguage?: "es" | "fr" | "bm" | "en";
  currencyDisplay?: string;
  defaultTimezone?: string;
  paymentMethods?: string[];
};

type CitiesResponse = {
  ok?: boolean;
  cities?: CityRow[];
  error?: { message?: string } | string;
};

type ApplyResponse = {
  ok?: boolean;
  applicationId?: string;
  error?: { message?: string } | string;
};

type ApplyState = {
  merchantType: ActiveMerchantType;
  deliveryType: DeliveryType;
  deliveryModePreference: "self_delivery" | "platform_driver" | "both";
  acceptsPayTech: boolean;
  businessName: string;
  ownerName: string;
  phone: string;
  email: string;
  password: string;
  country: string;
  cityId: string;
  area: string;
  address: string;
  whatsapp: string;
  cuisineType: string;
  storeCategory: string;
  openingHoursText: string;
  averagePrepMinutes: string;
  minimumOrderAmount: string;
  deliveryRadiusKm: string;
  logoUrl: string;
  coverImageUrl: string;
  legalIdNumber: string;
  businessRegistrationNumber: string;
  payoutMethod: PayoutMethod;
  payoutDetails: string;
  notes: string;
};

const STEPS = [
  "Business type",
  "Account details",
  "Business details",
  "Store setup",
  "Delivery and payout",
  "Review",
] as const;

const INITIAL_STATE: ApplyState = {
  merchantType: "restaurant",
  deliveryType: "own_driver",
  deliveryModePreference: "self_delivery",
  acceptsPayTech: true,
  businessName: "",
  ownerName: "",
  phone: "",
  email: "",
  password: "",
  country: "",
  cityId: "",
  area: "",
  address: "",
  whatsapp: "",
  cuisineType: "",
  storeCategory: "",
  openingHoursText: "",
  averagePrepMinutes: "15",
  minimumOrderAmount: "0",
  deliveryRadiusKm: "8",
  logoUrl: "",
  coverImageUrl: "",
  legalIdNumber: "",
  businessRegistrationNumber: "",
  payoutMethod: "cash_collection",
  payoutDetails: "",
  notes: "",
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

function merchantSetupLabels(merchantType: ActiveMerchantType) {
  switch (merchantType) {
    case "corner_shop":
    case "grocery":
      return {
        setupTitle: "Shop setup",
        categoryLabel: "Shop category",
        categoryPlaceholder: "Groceries, drinks, home essentials",
        prepLabel: "Estimated packing time (minutes)",
        minOrderLabel: "Minimum order amount",
      };
    case "bakery":
      return {
        setupTitle: "Bakery setup",
        categoryLabel: "Bakery specialty",
        categoryPlaceholder: "Bread, cakes, snacks",
        prepLabel: "Average prep time (minutes)",
        minOrderLabel: "Minimum order amount",
      };
    default:
      return {
        setupTitle: "Restaurant setup",
        categoryLabel: "Cuisine type",
        categoryPlaceholder: "Pizza, rice bowls, grill, desserts",
        prepLabel: "Average prep time (minutes)",
        minOrderLabel: "Minimum order amount",
      };
  }
}

export default function ApplyForm({
  cityId,
  referralCode,
  prefillMerchantType,
}: Props) {
  const [cities, setCities] = useState<CityRow[]>([]);
  const [step, setStep] = useState(0);
  const [loadingCities, setLoadingCities] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successId, setSuccessId] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState<ApplyState>({
    ...INITIAL_STATE,
    cityId: cityId || "",
    merchantType: prefillMerchantType || INITIAL_STATE.merchantType,
  });

  const selectedCity = useMemo(
    () => cities.find((entry) => entry._id === form.cityId) || null,
    [cities, form.cityId]
  );
  const setupLabels = useMemo(
    () => merchantSetupLabels(form.merchantType),
    [form.merchantType]
  );

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
        const nextCities = Array.isArray(json.cities) ? json.cities : [];
        setCities(nextCities);
        const defaultCityId = cityId || String(nextCities[0]?._id || "");
        setForm((current) => {
          const nextCityId = current.cityId || defaultCityId;
          const nextCity = nextCities.find((entry) => entry._id === nextCityId) || null;
          return {
            ...current,
            cityId: nextCityId,
            country: current.country || String(nextCity?.country || ""),
            deliveryType: defaultDeliveryTypeForMarket(nextCity?.marketCode),
            deliveryModePreference:
              current.deliveryModePreference || "self_delivery",
          };
        });
      } catch (requestError: unknown) {
        if (!cancelled) {
          setError(
            requestError instanceof Error ? requestError.message : "Could not load cities."
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingCities(false);
        }
      }
    }

    loadCities();
    return () => {
      cancelled = true;
    };
  }, [cityId]);

  useEffect(() => {
    if (!selectedCity) return;
    setForm((current) => ({
      ...current,
      country: current.country || String(selectedCity.country || ""),
      deliveryType: defaultDeliveryTypeForMarket(selectedCity.marketCode),
    }));
  }, [selectedCity]);

  function update<K extends keyof ApplyState>(key: K, value: ApplyState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateDeliveryModePreference(value: "self_delivery" | "platform_driver" | "both") {
    setForm((current) => ({
      ...current,
      deliveryModePreference: value,
      deliveryType:
        value === "platform_driver"
          ? "platform_driver"
          : value === "self_delivery"
          ? "own_driver"
          : current.deliveryType || defaultDeliveryTypeForMarket(selectedCity?.marketCode),
    }));
  }

  function canMoveNext() {
    switch (step) {
      case 0:
        return Boolean(form.merchantType);
      case 1:
        return Boolean(
          form.businessName.trim() &&
            form.ownerName.trim() &&
            form.phone.trim() &&
            form.email.trim() &&
            form.password.trim().length >= 6
        );
      case 2:
        return Boolean(
          form.cityId &&
            form.country.trim() &&
            form.area.trim() &&
            form.address.trim()
        );
      case 3:
        return Boolean(form.openingHoursText.trim() && Number(form.averagePrepMinutes) >= 0);
      case 4:
        return Boolean(form.deliveryType && form.payoutMethod);
      default:
        return true;
    }
  }

  async function submit() {
    setSubmitting(true);
    setError("");
    setSuccessId("");
    try {
      const res = await fetch("/api/merchant/apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-city-id": form.cityId,
        },
        body: JSON.stringify({
          merchantType: form.merchantType,
          deliveryType: form.deliveryType,
          deliveryModePreference: form.deliveryModePreference,
          acceptsPayTech: form.acceptsPayTech,
          businessName: form.businessName,
          ownerName: form.ownerName,
          phone: form.phone,
          email: form.email,
          password: form.password,
          country: form.country,
          cityName: selectedCity?.name || "",
          area: form.area,
          address: form.address,
          whatsapp: form.whatsapp,
          cuisineType: form.cuisineType,
          storeCategory: form.storeCategory,
          openingHoursText: form.openingHoursText,
          averagePrepMinutes: Number(form.averagePrepMinutes || 0),
          minimumOrderAmount: Number(form.minimumOrderAmount || 0),
          deliveryRadiusKm: Number(form.deliveryRadiusKm || 0),
          logoUrl: form.logoUrl,
          coverImageUrl: form.coverImageUrl,
          legalIdNumber: form.legalIdNumber,
          businessRegistrationNumber: form.businessRegistrationNumber,
          payoutMethod: form.payoutMethod,
          payoutDetails: form.payoutDetails,
          referredByCode: referralCode || undefined,
          notes: form.notes,
        }),
      });
      const json = (await res.json().catch(() => null)) as ApplyResponse | null;
      if (!res.ok || !json?.ok || !json.applicationId) {
        throw new Error(pickError(json?.error, "Could not submit application."));
      }
      setSuccessId(json.applicationId);
      setStep(STEPS.length - 1);
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
    <div className="mt-6 space-y-5">
      {referralCode ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Referral detected: <span className="font-semibold">{referralCode}</span>. If approved,
          the referring business receives partner credits.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {successId ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
          <p className="font-semibold">Your application has been received.</p>
          <p className="mt-1">
            Application ID: <span className="font-semibold">{successId}</span>
          </p>
          <p className="mt-2">
            We will review your store details and contact you with the next onboarding steps.
          </p>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {STEPS.map((label, index) => (
          <div
            key={label}
            className={`flex min-h-[76px] items-start gap-3 rounded-[24px] border px-4 py-3 text-xs font-semibold ${
              index === step
                ? "border-slate-950 bg-slate-950 text-white shadow-[0_14px_30px_rgba(15,23,42,0.18)]"
                : index < step
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-slate-200 bg-slate-50 text-slate-500"
            }`}
          >
            <span
              className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${
                index === step
                  ? "bg-white/15 text-white"
                  : index < step
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-white text-slate-500 ring-1 ring-slate-200"
              }`}
            >
              {index + 1}
            </span>
            <span className="leading-5">{label}</span>
          </div>
        ))}
      </div>

      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_16px_42px_rgba(15,23,42,0.06)]">
        {step === 0 ? (
          <div className="space-y-4">
            <div>
              <h3 className="text-xl font-semibold text-slate-950">
                What type of business are you registering?
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                The merchant dashboard and onboarding checklist adapt by business type.
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {[...ACTIVE_MERCHANT_TYPES, "pharmacy"].map((type) => {
                const active = type !== "pharmacy";
                const selected = form.merchantType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    disabled={!active}
                    onClick={() => active && update("merchantType", normalizeMerchantType(type))}
                    className={`rounded-[28px] border px-5 py-5 text-left transition ${
                      selected
                        ? "border-slate-950 bg-slate-950 text-white shadow-[0_18px_34px_rgba(15,23,42,0.18)]"
                        : active
                        ? "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50"
                        : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                    }`}
                  >
                    <div className="text-base font-semibold">{getMerchantTypeLabel(type)}</div>
                    <p className={`mt-2 text-sm ${selected ? "text-slate-200" : "text-slate-600"}`}>
                      {getMerchantTypeDescription(type)}
                    </p>
                    {!active ? (
                      <span className="mt-3 inline-flex rounded-full bg-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600">
                        Later expansion
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="grid gap-3">
            <div>
              <h3 className="text-xl font-semibold text-slate-950">Account details</h3>
              <p className="mt-1 text-sm text-slate-600">
                Set the main merchant contact that will receive onboarding updates.
              </p>
            </div>
            <input
              value={form.businessName}
              onChange={(event) => update("businessName", event.target.value)}
              placeholder="Business name"
              className="input"
            />
            <input
              value={form.ownerName}
              onChange={(event) => update("ownerName", event.target.value)}
              placeholder="Owner full name"
              className="input"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={form.phone}
                onChange={(event) => update("phone", event.target.value)}
                placeholder="Phone number"
                className="input"
              />
              <input
                value={form.whatsapp}
                onChange={(event) => update("whatsapp", event.target.value)}
                placeholder="WhatsApp contact"
                className="input"
              />
            </div>
            <input
              value={form.email}
              onChange={(event) => update("email", event.target.value)}
              placeholder="Email address"
              className="input"
              type="email"
            />
            <input
              value={form.password}
              onChange={(event) => update("password", event.target.value)}
              placeholder="Password"
              className="input"
              type="password"
            />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid gap-3">
            <div>
              <h3 className="text-xl font-semibold text-slate-950">Business details</h3>
              <p className="mt-1 text-sm text-slate-600">
                Choose the city and operating area for your store.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={form.country}
                onChange={(event) => update("country", event.target.value)}
                placeholder="Country"
                className="input"
              />
              <select
                value={form.cityId}
                onChange={(event) => update("cityId", event.target.value)}
                className="input bg-white"
              >
                <option value="">{loadingCities ? "Loading cities..." : "Select city"}</option>
                {cities.map((city) => (
                  <option key={city._id} value={city._id}>
                    {city.name || city.code || city._id}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={form.area}
              onChange={(event) => update("area", event.target.value)}
              placeholder="Area or neighborhood"
              className="input"
            />
            <input
              value={form.address}
              onChange={(event) => update("address", event.target.value)}
              placeholder="Full address"
              className="input"
            />
            <textarea
              value={form.notes}
              onChange={(event) => update("notes", event.target.value)}
              rows={3}
              placeholder="Anything ops should know before review"
              className="input"
            />
          </div>
        ) : null}

        {step === 3 ? (
          <div className="grid gap-3">
            <div>
              <h3 className="text-xl font-semibold text-slate-950">{setupLabels.setupTitle}</h3>
              <p className="mt-1 text-sm text-slate-600">
                Add store setup details so ops can configure your catalog faster after approval.
              </p>
            </div>
            {form.merchantType === "restaurant" || form.merchantType === "bakery" ? (
              <input
                value={form.cuisineType}
                onChange={(event) => update("cuisineType", event.target.value)}
                placeholder={setupLabels.categoryPlaceholder}
                className="input"
              />
            ) : (
              <input
                value={form.storeCategory}
                onChange={(event) => update("storeCategory", event.target.value)}
                placeholder={setupLabels.categoryPlaceholder}
                className="input"
              />
            )}
            <textarea
              value={form.openingHoursText}
              onChange={(event) => update("openingHoursText", event.target.value)}
              rows={3}
              placeholder="Opening hours, for example Mon-Sat 8:00 to 22:00"
              className="input"
            />
            <div className="grid gap-3 md:grid-cols-3">
              <input
                value={form.averagePrepMinutes}
                onChange={(event) => update("averagePrepMinutes", event.target.value)}
                placeholder={setupLabels.prepLabel}
                className="input"
                inputMode="numeric"
              />
              <input
                value={form.minimumOrderAmount}
                onChange={(event) => update("minimumOrderAmount", event.target.value)}
                placeholder={setupLabels.minOrderLabel}
                className="input"
                inputMode="decimal"
              />
              <input
                value={form.deliveryRadiusKm}
                onChange={(event) => update("deliveryRadiusKm", event.target.value)}
                placeholder="Delivery radius (km)"
                className="input"
                inputMode="decimal"
              />
            </div>
            <input
              value={form.logoUrl}
              onChange={(event) => update("logoUrl", event.target.value)}
              placeholder="Logo URL (Cloudinary or CDN)"
              className="input"
            />
            <input
              value={form.coverImageUrl}
              onChange={(event) => update("coverImageUrl", event.target.value)}
              placeholder="Cover image URL (Cloudinary or CDN)"
              className="input"
            />
          </div>
        ) : null}

        {step === 4 ? (
          <div className="grid gap-3">
            <div>
              <h3 className="text-xl font-semibold text-slate-950">Delivery and payout</h3>
              <p className="mt-1 text-sm text-slate-600">
                Delivery defaults adapt to the selected city, but you can confirm them here.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {[
                {
                  value: "self_delivery" as const,
                  label: "Self delivery",
                  detail: "Use your own riders by default.",
                },
                {
                  value: "platform_driver" as const,
                  label: "Platform driver",
                  detail: "Use AishaFood riders by default.",
                },
                {
                  value: "both" as const,
                  label: "Both",
                  detail: "Decide the final setup during onboarding.",
                },
              ].map((option) => (
                <label
                  key={option.value}
                  className={`rounded-2xl border px-4 py-3 text-sm ${
                    form.deliveryModePreference === option.value
                      ? "border-slate-950 bg-slate-950 text-white"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  <input
                    type="radio"
                    name="deliveryModePreference"
                    value={option.value}
                    checked={form.deliveryModePreference === option.value}
                    onChange={() => updateDeliveryModePreference(option.value)}
                    className="mr-2"
                  />
                  <span className="font-semibold">{option.label}</span>
                  <span className={`mt-1 block text-xs ${form.deliveryModePreference === option.value ? "text-slate-200" : "text-slate-500"}`}>
                    {option.detail}
                  </span>
                </label>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {DELIVERY_TYPES.map((type) => (
                <label
                  key={type}
                  className={`rounded-2xl border px-4 py-3 text-sm ${
                    form.deliveryType === type
                      ? "border-slate-950 bg-slate-950 text-white"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  <input
                    type="radio"
                    name="deliveryType"
                    value={type}
                    checked={form.deliveryType === type}
                    onChange={() => update("deliveryType", type)}
                    className="mr-2"
                  />
                  {getDeliveryTypeLabel(type)}
                </label>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={form.legalIdNumber}
                onChange={(event) => update("legalIdNumber", event.target.value)}
                placeholder="National ID or legal ID"
                className="input"
              />
              <input
                value={form.businessRegistrationNumber}
                onChange={(event) => update("businessRegistrationNumber", event.target.value)}
                placeholder="Business registration number"
                className="input"
              />
            </div>
            <select
              value={form.payoutMethod}
              onChange={(event) => update("payoutMethod", event.target.value as PayoutMethod)}
              className="input bg-white"
            >
              {PAYOUT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
            <textarea
              value={form.payoutDetails}
              onChange={(event) => update("payoutDetails", event.target.value)}
              rows={3}
              placeholder="Bank account, mobile money, or cash collection instructions"
              className="input"
            />
            <label className="flex items-start gap-3 rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.acceptsPayTech}
                onChange={(event) => update("acceptsPayTech", event.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="block font-semibold text-slate-950">
                  I want to accept Orange Money / Wave / Card payments through PayTech
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  AishaFood will use this during onboarding to configure online payment acceptance.
                </span>
              </span>
            </label>
          </div>
        ) : null}

        {step === 5 ? (
          <div className="space-y-4">
            <div>
              <h3 className="text-xl font-semibold text-slate-950">Review and submit</h3>
              <p className="mt-1 text-sm text-slate-600">
                Check your information before sending it for approval.
              </p>
            </div>
            <div className="grid gap-4 rounded-[28px] border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700 md:grid-cols-2">
              <div>
                <p className="font-semibold text-slate-950">{form.businessName || "Business"}</p>
                <p>{getMerchantTypeLabel(form.merchantType)}</p>
                <p>{form.ownerName}</p>
                <p>{form.phone}</p>
                <p>{form.email}</p>
              </div>
              <div>
                <p>{selectedCity?.name || "City pending"}</p>
                <p>{form.area}</p>
                <p>{form.address}</p>
                <p>
                  {form.deliveryModePreference === "both"
                    ? "Both delivery modes"
                    : form.deliveryModePreference === "platform_driver"
                    ? "Platform driver"
                    : "Self delivery"}
                </p>
                <p>{getDeliveryTypeLabel(form.deliveryType)}</p>
                <p>{form.payoutMethod}</p>
                <p>{form.acceptsPayTech ? "PayTech requested" : "PayTech not requested"}</p>
              </div>
              <div>
                <p>{form.cuisineType || form.storeCategory || "Catalog setup pending"}</p>
                <p>{form.openingHoursText || "Opening hours pending"}</p>
                <p>Prep / packing time: {form.averagePrepMinutes || "0"} min</p>
              </div>
              <div>
                <p>Minimum order: {form.minimumOrderAmount || "0"}</p>
                <p>Delivery radius: {form.deliveryRadiusKm || "0"} km</p>
                <p>WhatsApp: {form.whatsapp || "-"}</p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5">
          <button
            type="button"
            onClick={() => setStep((current) => Math.max(0, current - 1))}
            disabled={step === 0 || submitting}
            className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Back
          </button>
          <div className="flex gap-2">
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}
                disabled={!canMoveNext()}
                className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {submitting ? "Submitting..." : "Submit for approval"}
              </button>
            )}
          </div>
        </div>
      </section>

      <style jsx>{`
        .input {
          width: 100%;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 1.1rem;
          padding: 0.95rem 1rem;
          font-size: 0.95rem;
          outline: none;
          transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
        }

        .input:focus {
          border-color: #0f172a;
          box-shadow: 0 0 0 4px rgba(15, 23, 42, 0.08);
          background: #fff;
        }

        textarea.input {
          min-height: 120px;
          resize: vertical;
        }
      `}</style>
    </div>
  );
}
