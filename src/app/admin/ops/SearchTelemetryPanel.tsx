"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  adminKey: string;
  searches: number;
  zeroResults: number;
  noResultRate: number;
  topSource: {
    source: string;
    count: number;
    noResultRate: number;
  };
  topQueries: Array<{
    queryHash: string;
    count: number;
  }>;
  bySource: Array<{
    source: string;
    count: number;
    noResultRate: number;
  }>;
  opportunities: Array<{
    businessId: string;
    businessName: string;
    impressions: number;
    menuQualityScore: number;
    paused: boolean;
    pausedReason: string;
  }>;
};

export default function SearchTelemetryPanel({
  adminKey,
  searches,
  zeroResults,
  noResultRate,
  topSource,
  topQueries,
  bySource,
  opportunities,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function pauseBusiness(businessId: string) {
    if (loading) return;
    setLoading(businessId);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/admin/businesses/pause?key=${encodeURIComponent(adminKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          paused: true,
          reason: "search_opportunity_low_menu_quality",
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not pause business."
        );
      }
      setSuccess("Business paused.");
      router.refresh();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not pause business.");
    } finally {
      setLoading("");
    }
  }

  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold">Search Telemetry</h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <MetricTile label="Searches Today" value={String(Number(searches || 0))} />
        <MetricTile label="Zero Results" value={String(Number(zeroResults || 0))} />
        <MetricTile
          label="No Result Rate"
          value={`${(Number(noResultRate || 0) * 100).toFixed(2)}%`}
        />
      </div>

      <div className="mt-2 text-xs text-slate-600">
        Top source: {topSource.source} ({topSource.count}) | no-result rate:{" "}
        {(Number(topSource.noResultRate || 0) * 100).toFixed(2)}%
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mt-2 text-sm text-emerald-700">{success}</p> : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <article className="rounded-lg border border-slate-200 p-3">
          <h3 className="text-sm font-semibold">Top Query Hashes</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-2">Query Hash</th>
                  <th className="pb-2">Count</th>
                </tr>
              </thead>
              <tbody>
                {topQueries.length ? (
                  topQueries.map((row) => (
                    <tr key={row.queryHash} className="border-t border-slate-100">
                      <td className="py-2 font-mono text-xs">{row.queryHash}</td>
                      <td className="py-2">{row.count}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={2} className="py-3 text-center text-slate-500">
                      No queries found in this window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="rounded-lg border border-slate-200 p-3">
          <h3 className="text-sm font-semibold">By Source</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-2">Source</th>
                  <th className="pb-2">Count</th>
                  <th className="pb-2">No-result rate</th>
                </tr>
              </thead>
              <tbody>
                {bySource.length ? (
                  bySource.map((row) => (
                    <tr key={row.source} className="border-t border-slate-100">
                      <td className="py-2">{row.source}</td>
                      <td className="py-2">{row.count}</td>
                      <td className="py-2">{(Number(row.noResultRate || 0) * 100).toFixed(2)}%</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="py-3 text-center text-slate-500">
                      No source data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </div>

      <article className="mt-4 rounded-lg border border-slate-200 p-3">
        <h3 className="text-sm font-semibold">Opportunity Businesses (7d impressions)</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Business</th>
                <th className="pb-2">Impressions</th>
                <th className="pb-2">Menu Score</th>
                <th className="pb-2">Paused</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.length ? (
                opportunities.map((row) => (
                  <tr key={row.businessId} className="border-t border-slate-100">
                    <td className="py-2">
                      <div>{row.businessName}</div>
                      {row.pausedReason ? (
                        <div className="text-xs text-red-600">{row.pausedReason}</div>
                      ) : null}
                    </td>
                    <td className="py-2">{row.impressions}</td>
                    <td className="py-2">{row.menuQualityScore}</td>
                    <td className="py-2">{row.paused ? "yes" : "no"}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={`/admin/businesses?key=${encodeURIComponent(adminKey)}`}
                          className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                        >
                          Open merchant
                        </a>
                        <button
                          type="button"
                          disabled={Boolean(loading)}
                          onClick={() => pauseBusiness(row.businessId)}
                          className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700"
                        >
                          {loading === row.businessId ? "Pausing..." : "Pause"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-slate-500">
                    No opportunity businesses found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-lg border border-slate-200 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </article>
  );
}
