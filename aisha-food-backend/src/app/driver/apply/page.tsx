import ApplyDriverForm from "./ApplyDriverForm";

type SearchParams = Record<string, string | string[] | undefined>;

function pickSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export default async function DriverApplyPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const cityId = pickSingle(query.cityId).trim();
  const referralCode = pickSingle(query.ref).trim().toUpperCase();

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#d1fae5_0%,#ecfeff_28%,#ffffff_70%)]">
      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-[32px] border border-emerald-200 bg-white/90 p-8 shadow-[0_24px_80px_rgba(15,118,110,0.12)] backdrop-blur">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-700">
              Driver Onboarding
            </p>
            <h1 className="mt-3 text-3xl font-semibold text-slate-950 sm:text-4xl">
              Apply to join Aisha Food as a driver
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
              Send your core details. Operations reviews the application, creates your access,
              and contacts you for activation in the selected city.
            </p>
          </section>

          <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-950">Driver application</h2>
            <p className="mt-2 text-sm text-slate-600">
              Referred applicants allow the referring driver to earn a launch bonus after
              approval.
            </p>
            <ApplyDriverForm cityId={cityId} referralCode={referralCode} />
          </section>
        </div>
      </section>
    </main>
  );
}
