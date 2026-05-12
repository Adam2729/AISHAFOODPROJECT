import Link from "next/link";

type Section = {
  title: string;
  body?: string[];
  bullets?: string[];
};

type PublicInfoPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  updatedLabel?: string;
  sections: Section[];
  children?: React.ReactNode;
};

const footerLinks = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/delete-account", label: "Delete Account" },
  { href: "/support", label: "Support" },
];

export default function PublicInfoPage({
  eyebrow,
  title,
  description,
  updatedLabel = "Updated for launch readiness",
  sections,
  children,
}: PublicInfoPageProps) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#ffedd5_0%,#fff7ed_32%,#ffffff_76%)] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-5 py-8 sm:px-6 sm:py-10 lg:px-8">
        <header className="rounded-[28px] border border-orange-100 bg-white/95 p-6 shadow-[0_24px_80px_-40px_rgba(249,115,22,0.45)] sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-700">
                {eyebrow}
              </p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
                {title}
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600 sm:text-base">
                {description}
              </p>
            </div>
            <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-medium text-orange-900">
              {updatedLabel}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            {footerLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-2xl border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:border-orange-300 hover:text-orange-700"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </header>

        <section className="mt-8 grid gap-5">
          {sections.map((section) => (
            <article
              key={section.title}
              className="rounded-[24px] border border-slate-200 bg-white/96 p-6 shadow-sm"
            >
              <h2 className="text-xl font-semibold text-slate-950">{section.title}</h2>
              {section.body?.map((paragraph) => (
                <p key={paragraph} className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
                  {paragraph}
                </p>
              ))}
              {section.bullets?.length ? (
                <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-600 sm:text-base">
                  {section.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-3">
                      <span className="mt-2 h-2 w-2 rounded-full bg-orange-500" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </section>

        {children ? <div className="mt-8">{children}</div> : null}

        <footer className="mt-8 rounded-[24px] border border-slate-200 bg-slate-950 px-6 py-5 text-sm text-slate-200">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-white">OranjeEats Support</p>
              <p className="mt-1 text-slate-300">support@oranjeeats.com</p>
            </div>
            <p className="max-w-2xl text-slate-400">
              These public pages are provided for customer, merchant, and driver transparency across
              Bamako launch operations and future market expansion.
            </p>
          </div>
        </footer>
      </div>
    </main>
  );
}
