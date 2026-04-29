import { verifyDriverLinkToken } from "@/lib/driverLink";
import DriverLinkExchangeClient from "./DriverLinkExchangeClient";

type SearchParams = Record<string, string | string[] | undefined>;

function pickSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export default async function DriverLinkPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = await searchParams;
  const token = pickSingle(query.token || query.key).trim();
  let cityId = pickSingle(query.cityId).trim();

  if (!cityId && token) {
    const payload = verifyDriverLinkToken(token);
    if (payload?.cityId) {
      cityId = String(payload.cityId);
    }
  }

  if (!token || !cityId) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center p-6">
        <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <h1 className="text-xl font-semibold">Aisha Driver Link</h1>
          <p className="mt-2 text-sm text-red-600">
            Enlace invalido. Solicita un nuevo enlace al equipo de operaciones.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-md p-6">
      <DriverLinkExchangeClient token={token} cityId={cityId} />
    </main>
  );
}
