import ApplyForm from "./ApplyForm";

type SearchParams = Record<string, string | string[] | undefined>;

function pickSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export default async function MerchantApplyPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const cityId = pickSingle(query.cityId).trim();
  const referralCode = pickSingle(query.ref).trim().toUpperCase();

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#fde68a_0%,#fff7ed_28%,#ffffff_68%)]">
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-[32px] border border-amber-200 bg-white/95 p-8 shadow-[0_24px_80px_rgba(120,53,15,0.16)]">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-amber-700">
              Become a partner
            </p>
            <h1 className="mt-3 text-4xl font-semibold text-slate-950">
              Sell more with Aisha Food
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
              Bring your restaurant or shop onto one operational platform with city-aware
              delivery, easy order management, weekly payouts, and better customer discovery.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <article className="rounded-3xl bg-amber-50 p-5">
                <h2 className="text-base font-semibold text-amber-950">Get new customers</h2>
                <p className="mt-2 text-sm text-amber-900">
                  Show up in the app, capture repeat demand, and stay visible during launch.
                </p>
              </article>
              <article className="rounded-3xl bg-slate-50 p-5">
                <h2 className="text-base font-semibold text-slate-950">Easy order management</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Manage live orders, menu updates, payouts, and operations from one control panel.
                </p>
              </article>
              <article className="rounded-3xl bg-emerald-50 p-5">
                <h2 className="text-base font-semibold text-emerald-950">Delivery options by city</h2>
                <p className="mt-2 text-sm text-emerald-800">
                  Choose your own drivers or the platform driver setup available in your city.
                </p>
              </article>
              <article className="rounded-3xl bg-white p-5 ring-1 ring-slate-200">
                <h2 className="text-base font-semibold text-slate-950">Weekly payouts</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Review statements, reconcile cash, and keep trust high with transparent payout flows.
                </p>
              </article>
            </div>

            <div className="mt-8 rounded-3xl bg-slate-950 px-5 py-4 text-sm text-white">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  Register your restaurant or shop using the guided flow on the right. Our team reviews
                  every application before activation.
                </div>
                <a
                  href="#partner-wizard"
                  className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-950"
                >
                  Register your restaurant or shop
                </a>
              </div>
            </div>
          </section>

          <section
            id="partner-wizard"
            className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-2xl font-semibold text-slate-950">Register your business</h2>
            <p className="mt-2 text-sm text-slate-600">
              Complete the multi-step onboarding and submit it for approval.
            </p>
            <ApplyForm cityId={cityId} referralCode={referralCode} />
          </section>
        </div>
      </section>
    </main>
  );
}
