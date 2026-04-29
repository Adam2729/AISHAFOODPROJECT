import ApplyForm from "@/app/merchant/apply/ApplyForm";

type SearchParams = Record<string, string | string[] | undefined>;

function pickSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export default async function RestaurantApplyLandingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const initialCityId = pickSingle(params.cityId).trim();
  const referralCode = pickSingle(params.ref).trim().toUpperCase();

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#fde68a_0%,#fff7ed_20%,#fff 58%)]">
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <div className="grid items-start gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <aside className="xl:sticky xl:top-6">
            <section className="rounded-[32px] border border-amber-200/80 bg-white/90 p-8 shadow-[0_28px_90px_rgba(120,53,15,0.14)] backdrop-blur">
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-amber-700">
                Restaurant onboarding
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-[2.6rem]">
                Join Aisha Food and launch your restaurant faster
              </h1>
              <p className="mt-4 text-sm leading-7 text-slate-600">
                Send your store details once. Ops reviews the application, creates the merchant
                account, and activates your restaurant in the selected city.
              </p>

              <div className="mt-8 grid gap-3">
                <article className="rounded-3xl border border-amber-100 bg-amber-50/80 p-4">
                  <p className="text-sm font-semibold text-amber-950">Fast review</p>
                  <p className="mt-2 text-sm leading-6 text-amber-900">
                    Multi-step form with city-safe approval, cleaner ops review, and merchant
                    activation in the right market.
                  </p>
                </article>
                <article className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-950">WhatsApp-ready operations</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Your contact details can be reused for support, order workflows, and launch
                    coordination.
                  </p>
                </article>
                <article className="rounded-3xl border border-emerald-100 bg-emerald-50/80 p-4">
                  <p className="text-sm font-semibold text-emerald-950">Referral upside</p>
                  <p className="mt-2 text-sm leading-6 text-emerald-800">
                    Referred restaurants can trigger partner promotion credits after approval.
                  </p>
                </article>
              </div>

              <div className="mt-8 rounded-[28px] border border-slate-200 bg-slate-950 px-5 py-5 text-white">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/65">
                  What you should have ready
                </p>
                <ul className="mt-4 space-y-3 text-sm text-white/85">
                  <li>Business name, owner details, phone, email, and WhatsApp contact</li>
                  <li>Store address, neighborhood, opening hours, prep time, and delivery radius</li>
                  <li>Logo, cover image, ID / registration details, and payout instructions</li>
                </ul>
              </div>
            </section>
          </aside>

          <section className="rounded-[34px] border border-slate-200 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur sm:p-8">
            <div className="border-b border-slate-200 pb-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                    Restaurant application
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                    These fields go directly into the merchant approval workflow. Fill them once,
                    then let ops complete the account setup and activation.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <p className="font-semibold text-slate-950">Approval path</p>
                  <p className="mt-1">Review, account creation, launch checks, activation</p>
                </div>
              </div>
            </div>

            <ApplyForm
              cityId={initialCityId}
              referralCode={referralCode}
              prefillMerchantType="restaurant"
            />
          </section>
        </div>
      </section>
    </main>
  );
}
