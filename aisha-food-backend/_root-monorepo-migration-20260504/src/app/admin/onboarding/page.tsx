import Link from "next/link";
import { headers } from "next/headers";
import GeneratePinButton from "./GeneratePinButton";

type SearchParams = Record<string, string | string[] | undefined>;

type Merchant = {
  businessId: string;
  name: string;
  type: string;
  isActive: boolean;
  mustChangePin: boolean;
  createdAt?: string | Date;
};

type OnboardingResponse = {
  ok: boolean;
  merchants?: Merchant[];
  error?: { message?: string } | string;
};

function normalizeSingle(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function formatDateTime(value: string | Date | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

async function fetchJson<T>(url: string): Promise<{ ok: boolean; data: T | null; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const json = (await res.json().catch(() => null)) as
      | (T & { ok?: boolean; error?: { message?: string } | string })
      | null;
    if (!res.ok || !json?.ok) {
      const message =
        (typeof json?.error === "string" ? json.error : json?.error?.message) || `HTTP ${res.status}`;
      return { ok: false, data: null, error: message };
    }
    return { ok: true, data: json, error: "" };
  } catch (error: unknown) {
    return {
      ok: false,
      data: null,
      error: error instanceof Error ? error.message : "Request failed",
    };
  }
}

export default async function AdminOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const key = normalizeSingle(params.key).trim();

  if (!key) {
    return (
      <main className="mx-auto min-h-screen max-w-6xl p-6">
        <h1 className="text-2xl font-bold">Merchant Onboarding</h1>
        <p className="mt-2 text-sm text-red-600">
          Unauthorized. Usa la URL con <code>?key=ADMIN_KEY</code>.
        </p>
      </main>
    );
  }

  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") || hdrs.get("host") || "localhost:3000";
  const protoHeader = hdrs.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = protoHeader || (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");
  const baseUrl = `${protocol}://${host}`;

  const onboardingReq = await fetchJson<OnboardingResponse>(
    `${baseUrl}/api/admin/onboarding?key=${encodeURIComponent(key)}&limit=100`
  );
  const merchants = onboardingReq.data?.merchants || [];

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Merchant Onboarding</h1>
          <p className="text-sm text-slate-600">Generate temporary PINs for merchant login handoff</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/admin/businesses?key=${encodeURIComponent(key)}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Businesses
          </Link>
          <Link
            href={`/admin?key=${encodeURIComponent(key)}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Dashboard
          </Link>
        </div>
      </header>

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        {onboardingReq.ok ? null : <p className="mb-3 text-sm text-red-600">{onboardingReq.error}</p>}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Business</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Active</th>
                <th className="pb-2">Must Change PIN</th>
                <th className="pb-2">Created</th>
                <th className="pb-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {merchants.length ? (
                merchants.map((merchant) => (
                  <tr key={merchant.businessId} className="border-t border-slate-100">
                    <td className="py-2">
                      <div className="font-medium">{merchant.name}</div>
                      <div className="font-mono text-xs text-slate-500">{merchant.businessId}</div>
                    </td>
                    <td className="py-2 capitalize">{merchant.type || "-"}</td>
                    <td className="py-2">{merchant.isActive ? "yes" : "no"}</td>
                    <td className="py-2">{merchant.mustChangePin ? "yes" : "no"}</td>
                    <td className="py-2">{formatDateTime(merchant.createdAt)}</td>
                    <td className="py-2">
                      <GeneratePinButton adminKey={key} businessId={merchant.businessId} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-3 text-center text-slate-500">
                    No merchants found.
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

