import { redirect } from "next/navigation";
import { verifyDriverLinkToken } from "@/lib/driverLink";
import DriverDashboardClient from "./DriverDashboardClient";

type SearchParams = Record<string, string | string[] | undefined>;

function pickSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export default async function DriverDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = await searchParams;
  const token = pickSingle(query.token || query.key).trim();
  const cityId = pickSingle(query.cityId).trim();
  const orderId = pickSingle(query.orderId).trim();

  let derivedCityId = cityId;
  if (!derivedCityId && token) {
    const payload = verifyDriverLinkToken(token);
    if (payload?.cityId) {
      derivedCityId = String(payload.cityId);
    }
  }

  if (token && derivedCityId) {
    const qs = new URLSearchParams({
      token,
      cityId: derivedCityId,
    });
    if (orderId) qs.set("orderId", orderId);
    return redirect(`/driver/link?${qs.toString()}`);
  }

  if (!derivedCityId) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center p-6">
        <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <h1 className="text-xl font-semibold">Panel de Repartidor</h1>
          <p className="mt-2 text-sm text-red-600">
            Falta cityId. Abre este panel desde el enlace de turno enviado por operaciones.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4">
      <div className="mx-auto mb-3 flex max-w-2xl items-center justify-between">
        <h1 className="text-xl font-semibold">Driver Dashboard</h1>
        <a
          href={`/driver/earnings?cityId=${encodeURIComponent(derivedCityId)}`}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm"
        >
          Earnings
        </a>
      </div>
      <DriverDashboardClient cityId={derivedCityId} />
    </main>
  );
}
