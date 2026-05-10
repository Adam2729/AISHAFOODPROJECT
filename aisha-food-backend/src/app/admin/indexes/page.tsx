import Link from "next/link";
import { getAdminPageContext } from "@/lib/adminPageContext";

type SearchParams = Record<string, string | string[] | undefined>;

type IndexCheckRow = {
  collection: string;
  label: string;
  key: Record<string, 1 | -1>;
  unique: boolean;
  present: boolean;
};

type IndexesResponse = {
  ok?: boolean;
  allPassed?: boolean;
  checks?: IndexCheckRow[];
  checkedAt?: string;
  error?: { message?: string } | string;
};

function pickError(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

async function fetchJson<T>(
  url: string,
  requestHeaders?: HeadersInit
): Promise<{ ok: boolean; data: T | null; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", headers: requestHeaders });
    const json = (await res.json().catch(() => null)) as
      | (T & { ok?: boolean; error?: { message?: string } | string })
      | null;
    if (!res.ok || !json?.ok) {
      return {
        ok: false,
        data: null,
        error: pickError(json?.error, `HTTP ${res.status}`),
      };
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

export default async function AdminIndexesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const nextHref = "/admin/indexes";
  const { baseUrl, adminRequestHeaders, hasAdminSession, transitionalAdminKey } =
    await getAdminPageContext(params);

  if (!hasAdminSession && !transitionalAdminKey) {
    return (
      <main className="mx-auto min-h-screen max-w-6xl p-6">
        <h1 className="text-2xl font-bold">Indexes</h1>
        <p className="mt-2 text-sm text-red-600">
          Index verification requires a secure admin browser session.
        </p>
        <Link
          href={`/admin/access?next=${encodeURIComponent(nextHref)}`}
          className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin access
        </Link>
      </main>
    );
  }

  const indexesReq = await fetchJson<IndexesResponse>(
    `${baseUrl}/api/admin/indexes`,
    adminRequestHeaders
  );
  const checks = Array.isArray(indexesReq.data?.checks) ? indexesReq.data?.checks || [] : [];
  const passedCount = checks.filter((row) => row.present).length;

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Required Indexes</h1>
          <p className="text-sm text-slate-600">
            Review database index health without opening raw JSON API responses.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin"
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Admin Home
          </Link>
          <Link
            href="/admin/ops"
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Ops Center
          </Link>
          <Link
            href={nextHref}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Refresh
          </Link>
        </div>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <article className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Overall</p>
            <p className="mt-1 text-xl font-bold">
              {indexesReq.data?.allPassed ? "Passed" : "Needs attention"}
            </p>
          </article>
          <article className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Present</p>
            <p className="mt-1 text-xl font-bold">{passedCount}</p>
          </article>
          <article className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Checked</p>
            <p className="mt-1 text-xl font-bold">{checks.length}</p>
          </article>
        </div>
        {indexesReq.data?.checkedAt ? (
          <p className="mt-3 text-xs text-slate-500">
            Checked at: {new Date(indexesReq.data.checkedAt).toLocaleString()}
          </p>
        ) : null}
        {indexesReq.ok ? null : (
          <p className="mt-3 text-sm text-red-600">{indexesReq.error}</p>
        )}
      </section>

      <section className="mt-5 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Collection</th>
              <th className="px-4 py-3 font-semibold">Label</th>
              <th className="px-4 py-3 font-semibold">Unique</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Key</th>
            </tr>
          </thead>
          <tbody>
            {checks.length ? (
              checks.map((row) => (
                <tr key={row.label} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.collection}</td>
                  <td className="px-4 py-3">{row.label}</td>
                  <td className="px-4 py-3">{row.unique ? "Yes" : "No"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        row.present
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {row.present ? "Present" : "Missing"}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">
                    {JSON.stringify(row.key)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-center text-slate-500">
                  No index checks available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
