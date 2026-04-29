"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ExchangeResponse = {
  ok?: boolean;
  cityId?: string;
  driverId?: string;
  error?: { message?: string } | string;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

export default function DriverLinkExchangeClient({
  token,
  cityId,
}: {
  token: string;
  cityId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [working, setWorking] = useState(true);

  const exchangeUrl = useMemo(() => {
    const query = cityId ? `?cityId=${encodeURIComponent(cityId)}` : "";
    return `/api/driver/session/exchange${query}`;
  }, [cityId]);

  useEffect(() => {
    let active = true;
    async function exchange() {
      if (!token || !cityId) {
        setError("Missing token or city.");
        setWorking(false);
        return;
      }
      try {
        const res = await fetch(exchangeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const json = (await res.json().catch(() => null)) as ExchangeResponse | null;
        if (!res.ok || !json?.ok) {
          throw new Error(pickError(json?.error, "Invalid or expired link."));
        }
        if (!active) return;
        router.replace(`/driver?cityId=${encodeURIComponent(cityId)}`);
      } catch (requestError: unknown) {
        if (!active) return;
        setError(
          requestError instanceof Error ? requestError.message : "Could not start driver session."
        );
        setWorking(false);
      }
    }
    exchange();
    return () => {
      active = false;
    };
  }, [token, cityId, exchangeUrl, router]);

  return (
    <section className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-6 text-center">
      <h1 className="text-xl font-semibold">Aisha Driver Link</h1>
      {working ? (
        <p className="text-sm text-slate-600">Validando enlace y abriendo tu panel...</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <p className="text-sm text-slate-600">No se pudo iniciar sesion de conductor.</p>
      )}
      {!working ? (
        <a
          href="/driver/link"
          className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold"
        >
          Reintentar
        </a>
      ) : null}
    </section>
  );
}

