"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type MerchantPortalShellProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
};

type PortalStatus = "online" | "busy" | "offline";

type MerchantContext = {
  id: string;
  name: string;
  ownerName?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  merchantType?: string;
  deliveryType?: "own_driver" | "platform_driver";
  cityCode?: string;
  cityName?: string;
  country?: string;
  marketCode?: string;
  defaultLanguage?: "es" | "fr" | "bm" | "en";
  currencyCode?: string;
  currencyDisplay?: string;
  supportWhatsApp?: string;
  paymentMethods?: string[];
  timezone?: string;
  isManuallyPaused?: boolean;
  busyUntil?: string | null;
  portalStatus?: PortalStatus;
  openOrdersCount?: number;
  preparingOrdersCount?: number;
};

type ContextResponse = {
  ok?: boolean;
  business?: MerchantContext;
  error?: { message?: string; code?: string } | string;
};

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/merchant/dashboard",
    label: "Dashboard",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
        <path d="M3 10.5 10 4l7 6.5v6.25A1.25 1.25 0 0 1 15.75 18H4.25A1.25 1.25 0 0 1 3 16.75V10.5Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7.5 18v-4.75c0-.69.56-1.25 1.25-1.25h2.5c.69 0 1.25.56 1.25 1.25V18" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    href: "/merchant/orders",
    label: "Orders",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
        <path d="M4 5.75A1.75 1.75 0 0 1 5.75 4h8.5A1.75 1.75 0 0 1 16 5.75v8.5A1.75 1.75 0 0 1 14.25 16h-8.5A1.75 1.75 0 0 1 4 14.25v-8.5Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 8h6M7 11h6M7 14h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/merchant/products",
    label: "Menu / Products",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
        <path d="M4 5.75A1.75 1.75 0 0 1 5.75 4h8.5A1.75 1.75 0 0 1 16 5.75v8.5A1.75 1.75 0 0 1 14.25 16h-8.5A1.75 1.75 0 0 1 4 14.25v-8.5Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6.5 7.5h7M6.5 10h7M6.5 12.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/merchant/finance",
    label: "Payouts",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
        <path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h8a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 14 16H6a2.5 2.5 0 0 1-2.5-2.5v-7Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3.5 8.25h13M12.75 12h1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/merchant/settings",
    label: "Settings",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
        <path d="M10 6.5A3.5 3.5 0 1 0 10 13.5A3.5 3.5 0 1 0 10 6.5Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M16 10a6 6 0 0 0-.08-.96l1.38-1.07-1.5-2.6-1.7.5a6.06 6.06 0 0 0-1.66-.96L12 3h-3.01l-.44 1.91c-.6.21-1.14.53-1.64.93l-1.73-.47-1.5 2.6 1.4 1.08A6.08 6.08 0 0 0 4 10c0 .33.03.65.08.96l-1.38 1.07 1.5 2.6 1.7-.5c.5.42 1.06.74 1.66.96L8 17h3.01l.44-1.91c.6-.21 1.14-.53 1.64-.93l1.73.47 1.5-2.6-1.4-1.08c.06-.31.08-.63.08-.95Z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatStatus(status: PortalStatus | string | null | undefined) {
  if (status === "busy") return "Busy";
  if (status === "offline") return "Offline";
  return "Online";
}

function statusTone(status: PortalStatus | string | null | undefined) {
  if (status === "busy") return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  if (status === "offline") return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
  return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
}

function statusDot(status: PortalStatus | string | null | undefined) {
  if (status === "busy") return "bg-amber-500";
  if (status === "offline") return "bg-rose-500";
  return "bg-emerald-500";
}

function deliveryLabel(value: MerchantContext["deliveryType"]) {
  return value === "platform_driver" ? "Aisha Food drivers" : "Own drivers";
}

function languageLabel(value: MerchantContext["defaultLanguage"]) {
  if (value === "fr") return "French";
  if (value === "bm") return "Bambara";
  if (value === "en") return "English";
  return "Spanish";
}

function merchantTypeLabel(value: string | undefined) {
  if (!value) return "Restaurant";
  return value
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function initialsFromName(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) return "AF";
  return parts.map((part) => part[0]?.toUpperCase() || "").join("");
}

function smallCurrency(value: string | undefined, code: string | undefined) {
  return value || code || "DOP";
}

export default function MerchantPortalShell({
  title,
  subtitle,
  actions,
  children,
}: MerchantPortalShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  const [business, setBusiness] = useState<MerchantContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [shellError, setShellError] = useState("");
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [busySaving, setBusySaving] = useState<number | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  async function loadContext() {
    setLoading(true);
    setShellError("");
    try {
      const response = await fetch("/api/merchant/context", { cache: "no-store" });
      const json = (await response.json().catch(() => null)) as ContextResponse | null;
      if (!response.ok || !json?.ok || !json.business) {
        const message =
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          "Could not load merchant workspace.";
        setShellError(message);
        if (response.status === 401) {
          router.push("/merchant/login");
          return;
        }
        if (json && typeof json.error !== "string" && json.error?.code === "PIN_CHANGE_REQUIRED") {
          router.push("/merchant/set-pin");
          return;
        }
        return;
      }
      setBusiness(json.business);
    } catch {
      setShellError("Could not load merchant workspace.");
    } finally {
      setLoading(false);
    }
  }

  async function setBusy(minutes: 0 | 30 | 60) {
    if (business?.isManuallyPaused) return;
    setBusySaving(minutes);
    try {
      const response = await fetch("/api/merchant/business/busy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        const message =
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          "Could not update store status.";
        setShellError(message);
        return;
      }
      await loadContext();
      setStatusMenuOpen(false);
    } finally {
      setBusySaving(null);
    }
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/merchant/auth/logout", { method: "POST" });
    } finally {
      router.push("/merchant/login");
    }
  }

  useEffect(() => {
    loadContext().catch(() => null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node | null;
      if (statusMenuRef.current && !statusMenuRef.current.contains(target)) {
        setStatusMenuOpen(false);
      }
      if (profileMenuRef.current && !profileMenuRef.current.contains(target)) {
        setProfileMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const displayName = useMemo(
    () => String(business?.name || business?.ownerName || "Aisha Food Merchant"),
    [business]
  );
  const avatarText = useMemo(
    () => initialsFromName(String(business?.ownerName || business?.name || "Aisha Food")),
    [business]
  );
  const compactMeta = useMemo(
    () => [
      {
        label: "City",
        value: business?.cityName ? `${business.cityName}${business.cityCode ? ` · ${business.cityCode}` : ""}` : "Not linked",
      },
      {
        label: "Delivery",
        value: deliveryLabel(business?.deliveryType),
      },
      {
        label: "Payments",
        value: business?.paymentMethods?.length ? business.paymentMethods.join(", ") : "cash",
      },
      {
        label: "Support",
        value: business?.supportWhatsApp ? `+${business.supportWhatsApp}` : "Not configured",
      },
    ],
    [business]
  );

  return (
    <div className="min-h-screen bg-[#eef2f7] text-slate-900">
      <div className="mx-auto flex max-w-[1500px] gap-4 px-4 py-4 lg:px-6 lg:py-5">
        <aside className="hidden w-[252px] shrink-0 flex-col rounded-[28px] bg-slate-900 px-4 py-5 text-slate-100 shadow-[0_22px_60px_rgba(15,23,42,0.18)] lg:flex">
          <Link href="/merchant/dashboard" className="inline-flex items-center gap-2 px-2">
            <span className="text-[1.55rem] font-black italic leading-none text-rose-500">Aisha</span>
            <span className="text-[1.55rem] font-black italic leading-none text-emerald-400">Food</span>
          </Link>

          <div className="mt-6 rounded-3xl bg-white/5 p-4 ring-1 ring-white/10">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Store</p>
                <h2 className="mt-2 text-lg font-semibold text-white">{displayName}</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {business?.cityName || "City pending"} · {merchantTypeLabel(business?.merchantType)}
                </p>
              </div>
              <span className={classes("inline-flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-bold", statusTone(business?.portalStatus))}>
                {avatarText}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-slate-950/40 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Open orders</p>
                <p className="mt-1 text-xl font-semibold text-white">{Number(business?.openOrdersCount || 0)}</p>
              </div>
              <div className="rounded-2xl bg-slate-950/40 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Preparing</p>
                <p className="mt-1 text-xl font-semibold text-white">{Number(business?.preparingOrdersCount || 0)}</p>
              </div>
            </div>
          </div>

          <nav className="mt-6 space-y-1.5">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={classes(
                    "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium transition",
                    active
                      ? "bg-emerald-500 text-white shadow-[0_14px_30px_rgba(16,185,129,0.24)]"
                      : "text-slate-300 hover:bg-white/8 hover:text-white"
                  )}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto rounded-3xl bg-white/5 p-4 ring-1 ring-white/10">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Workspace</p>
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              <p>Market: {business?.marketCode || "DO"}</p>
              <p>Currency: {smallCurrency(business?.currencyDisplay, business?.currencyCode)}</p>
              <p>Language: {languageLabel(business?.defaultLanguage)}</p>
              <p>Timezone: {business?.timezone || "-"}</p>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="rounded-[28px] border border-slate-200/80 bg-white px-4 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)] lg:px-6 lg:py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Link
                  href="/merchant/dashboard"
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 lg:hidden"
                >
                  <span className="text-base font-black italic leading-none text-rose-500">Aisha</span>
                  <span className="text-base font-black italic leading-none text-emerald-500">Food</span>
                </Link>

                <div ref={statusMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setStatusMenuOpen((current) => !current)}
                    className={classes(
                      "inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold",
                      statusTone(business?.portalStatus)
                    )}
                  >
                    <span className={classes("h-2.5 w-2.5 rounded-full", statusDot(business?.portalStatus))} />
                    <span>{formatStatus(business?.portalStatus)}</span>
                    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
                      <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>

                  {statusMenuOpen ? (
                    <div className="absolute left-0 top-[calc(100%+10px)] z-30 w-64 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Store status</p>
                      <p className="mt-2 text-sm text-slate-600">
                        {business?.isManuallyPaused
                          ? "Orders are paused in Settings."
                          : "Use busy mode when the kitchen needs extra prep time."}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {[30, 60].map((minutes) => (
                          <button
                            key={minutes}
                            type="button"
                            disabled={busySaving !== null || business?.isManuallyPaused}
                            onClick={() => setBusy(minutes as 30 | 60)}
                            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {busySaving === minutes ? "Saving..." : `Busy ${minutes} min`}
                          </button>
                        ))}
                        <button
                          type="button"
                          disabled={busySaving !== null || business?.isManuallyPaused}
                          onClick={() => setBusy(0)}
                          className="rounded-xl border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busySaving === 0 ? "Saving..." : "Mark online"}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setStatusMenuOpen(false);
                          router.push("/merchant/settings");
                        }}
                        className="mt-3 w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
                      >
                        Open settings
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <TopActionLink href="/merchant/orders" label="Orders">
                  <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
                    <path d="M4 5.75A1.75 1.75 0 0 1 5.75 4h8.5A1.75 1.75 0 0 1 16 5.75v8.5A1.75 1.75 0 0 1 14.25 16h-8.5A1.75 1.75 0 0 1 4 14.25v-8.5Z" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M7 8h6M7 11h6M7 14h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </TopActionLink>
                <TopActionLink href="/merchant/finance" label="Payouts">
                  <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
                    <path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h8a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 14 16H6a2.5 2.5 0 0 1-2.5-2.5v-7Z" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M3.5 8.25h13M12.75 12h1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </TopActionLink>
                <TopActionLink href="/merchant/settings" label="Settings">
                  <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
                    <path d="M10 6.5A3.5 3.5 0 1 0 10 13.5A3.5 3.5 0 1 0 10 6.5Z" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M16 10a6 6 0 0 0-.08-.96l1.38-1.07-1.5-2.6-1.7.5a6.06 6.06 0 0 0-1.66-.96L12 3h-3.01l-.44 1.91c-.6.21-1.14.53-1.64.93l-1.73-.47-1.5 2.6 1.4 1.08A6.08 6.08 0 0 0 4 10c0 .33.03.65.08.96l-1.38 1.07 1.5 2.6 1.7-.5c.5.42 1.06.74 1.66.96L8 17h3.01l.44-1.91c.6-.21 1.14-.53 1.64-.93l1.73.47 1.5-2.6-1.4-1.08c.06-.31.08-.63.08-.95Z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </TopActionLink>

                <div ref={profileMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setProfileMenuOpen((current) => !current)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#fb7185_0%,#f97316_100%)] text-sm font-bold text-white shadow-[0_14px_30px_rgba(249,115,22,0.2)]"
                  >
                    {avatarText}
                  </button>

                  {profileMenuOpen ? (
                    <div className="absolute right-0 top-[calc(100%+10px)] z-30 w-64 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
                      <p className="text-sm font-semibold text-slate-950">{displayName}</p>
                      <p className="mt-1 text-xs text-slate-500">{business?.email || business?.phone || "Merchant account"}</p>
                      <div className="mt-3 space-y-2">
                        <button
                          type="button"
                          onClick={() => {
                            setProfileMenuOpen(false);
                            router.push("/merchant/settings");
                          }}
                          className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Account settings
                          <span aria-hidden="true">›</span>
                        </button>
                        <button
                          type="button"
                          disabled={signingOut}
                          onClick={signOut}
                          className="flex w-full items-center justify-between rounded-xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                        >
                          {signingOut ? "Signing out..." : "Sign out"}
                          <span aria-hidden="true">›</span>
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">
                  {business?.cityName || "Merchant workspace"} {business?.country ? `· ${business.country}` : ""}
                </p>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
                {subtitle ? <p className="mt-2 max-w-3xl text-sm text-slate-600">{subtitle}</p> : null}
              </div>
              {actions ? (
                <div className="flex flex-wrap items-center gap-2 xl:justify-end">{actions}</div>
              ) : null}
            </div>

            {shellError ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {shellError}
              </div>
            ) : null}

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {compactMeta.map((item) => (
                <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{item.value}</p>
                </div>
              ))}
            </div>
          </header>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={classes(
                    "inline-flex items-center gap-2 whitespace-nowrap rounded-2xl border px-3 py-2 text-sm font-medium",
                    active
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-slate-200 bg-white text-slate-700"
                  )}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>

          <section className="mt-5">{loading && !business ? <ShellLoadingState /> : children}</section>
        </main>
      </div>
    </div>
  );
}

function TopActionLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
      aria-label={label}
      title={label}
    >
      {children}
    </Link>
  );
}

function ShellLoadingState() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-[26px] border border-slate-200 bg-white p-5">
        <div className="h-5 w-40 animate-pulse rounded-full bg-slate-100" />
        <div className="mt-4 space-y-3">
          <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </div>
      <div className="rounded-[26px] border border-slate-200 bg-white p-5">
        <div className="h-5 w-32 animate-pulse rounded-full bg-slate-100" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </div>
    </div>
  );
}
