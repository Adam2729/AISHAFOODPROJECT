import { headers } from "next/headers";

type HealthResponse = {
  ok: boolean;
  env?: string;
  db?: {
    connected?: boolean;
    name?: string;
  };
  baseLocation?: {
    lat?: number;
    lng?: number;
  };
  maxRadiusKm?: number;
  pilotMode?: boolean;
  pilotAllowlistEnabled?: boolean;
  timestamp?: string;
  error?: { message?: string } | string;
};

function formatDateTime(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

async function fetchHealth(baseUrl: string) {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
    const json = (await res.json().catch(() => null)) as HealthResponse | null;
    if (!res.ok || !json) {
      return {
        ok: false,
        error: `HTTP ${res.status}`,
      };
    }
    return json;
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Request failed",
    };
  }
}

export default async function HealthPage() {
  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") || hdrs.get("host") || "localhost:3000";
  const protoHeader = hdrs.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = protoHeader || (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");
  const baseUrl = `${protocol}://${host}`;
  const health = await fetchHealth(baseUrl);

  const dbConnected = Boolean(health.db?.connected);
  const systemOk = Boolean(health.ok && dbConnected);

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Health Status</h1>
        <p className="text-sm text-slate-600">Human-readable view for /api/health</p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-500">System</p>
        <p className={`mt-1 text-2xl font-bold ${systemOk ? "text-emerald-700" : "text-red-700"}`}>
          {systemOk ? "HEALTHY" : "UNHEALTHY"}
        </p>
        <p className="mt-2 text-xs text-slate-500">Checked at: {formatDateTime(health.timestamp)}</p>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2">
        <Card label="Environment" value={String(health.env || "-")} />
        <Card label="DB Connected" value={dbConnected ? "yes" : "no"} />
        <Card label="DB Name" value={String(health.db?.name || "-")} />
        <Card label="Max Radius (km)" value={String(Number(health.maxRadiusKm || 0))} />
        <Card
          label="Base Location"
          value={`${Number(health.baseLocation?.lat || 0).toFixed(4)}, ${Number(
            health.baseLocation?.lng || 0
          ).toFixed(4)}`}
        />
        <Card label="Pilot Mode" value={health.pilotMode ? "ON" : "OFF"} />
        <Card
          label="Pilot Allowlist"
          value={health.pilotAllowlistEnabled ? "ENFORCED" : "DISABLED"}
        />
      </section>

      {!health.ok ? (
        <section className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-700">Error</p>
          <p className="mt-1 text-sm text-red-700">
            {typeof health.error === "string"
              ? health.error
              : health.error?.message || "Health check failed."}
          </p>
        </section>
      ) : null}

      <section className="mt-4">
        <a
          href="/api/health"
          target="_blank"
          rel="noreferrer"
          className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
        >
          Open Raw JSON
        </a>
      </section>
    </main>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </article>
  );
}

