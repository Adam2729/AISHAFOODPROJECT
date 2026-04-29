import Link from "next/link";
import { getDefaultCity } from "@/lib/city";
import { buildMarketFormattingProfile } from "@/lib/marketFormatting";

export default async function HomePage() {
  const defaultCity = await getDefaultCity();
  const market = buildMarketFormattingProfile(defaultCity);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#fef3c7_0%,#fff7ed_28%,#ffffff_72%)]">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-8 px-6 py-12">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-amber-700">
            Live launch market
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-950">
            Aisha Food for {defaultCity.name}, {defaultCity.country}
          </h1>
          <p className="mt-4 text-base text-slate-600">
            Browse restaurants and shops, apply as a merchant, or open the secure operator tools.
            Launch defaults are aligned to {market.currencyDisplay} and {market.defaultTimezone}.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/restaurants"
            className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white"
          >
            Browse Restaurants
          </Link>
          <Link
            href="/restaurant/apply"
            className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-900"
          >
            Apply as a Merchant
          </Link>
          <Link
            href="/driver/apply"
            className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-900"
          >
            Apply as a Driver
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <article className="rounded-[24px] border border-slate-200 bg-white/90 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Launch city</p>
            <p className="mt-2 text-xl font-semibold text-slate-950">{defaultCity.name}</p>
            <p className="mt-1 text-sm text-slate-500">{defaultCity.code}</p>
          </article>
          <article className="rounded-[24px] border border-slate-200 bg-white/90 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Currency</p>
            <p className="mt-2 text-xl font-semibold text-slate-950">{market.currencyDisplay}</p>
            <p className="mt-1 text-sm text-slate-500">{market.currencyCode}</p>
          </article>
          <article className="rounded-[24px] border border-slate-200 bg-white/90 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Language</p>
            <p className="mt-2 text-xl font-semibold text-slate-950">{market.defaultLanguage.toUpperCase()}</p>
            <p className="mt-1 text-sm text-slate-500">{market.defaultTimezone}</p>
          </article>
        </div>

        <div className="flex flex-wrap gap-3 text-sm text-slate-600">
          <Link href="/merchant/login" className="rounded-xl border border-slate-200 px-4 py-2">
            Merchant login
          </Link>
          <Link href="/admin/access?next=/admin" className="rounded-xl border border-slate-200 px-4 py-2">
            Admin access
          </Link>
          <Link href="/ops" className="rounded-xl border border-slate-200 px-4 py-2">
            Ops tools
          </Link>
        </div>
      </div>
    </main>
  );
}
