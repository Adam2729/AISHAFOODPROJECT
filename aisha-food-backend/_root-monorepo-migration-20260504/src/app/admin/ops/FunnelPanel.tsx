"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  adminKey: string;
  totals: {
    business_view: number;
    add_to_cart: number;
    checkout_start: number;
    order_success: number;
    order_fail: number;
  };
  rates: {
    viewToAddRate: number;
    addToCheckoutRate: number;
    checkoutToOrderRate: number;
  };
  bySource: Array<{
    source: string;
    business_view: number;
    add_to_cart: number;
    checkout_start: number;
    order_success: number;
    order_fail: number;
    viewToAddRate: number;
    addToCheckoutRate: number;
    checkoutToOrderRate: number;
  }>;
  topDropoffBusinesses: Array<{
    businessId: string;
    businessName: string;
    businessType: string;
    menuQualityScore: number;
    trustBadge: string;
    paused: boolean;
    pausedReason: string;
    business_view: number;
    add_to_cart: number;
    checkout_start: number;
    order_success: number;
    order_fail: number;
    viewToAddRate: number;
    addToCheckoutRate: number;
    checkoutToOrderRate: number;
  }>;
  topFailCodes: Array<{
    failCode: string;
    count: number;
  }>;
};

export default function FunnelPanel({
  adminKey,
  totals,
  rates,
  bySource,
  topDropoffBusinesses,
  topFailCodes,
}: Props) {
  const router = useRouter();
  const [loadingBusinessId, setLoadingBusinessId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function pauseBusiness(businessId: string) {
    if (loadingBusinessId) return;
    setLoadingBusinessId(businessId);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/admin/businesses/pause?key=${encodeURIComponent(adminKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          paused: true,
          reason: "funnel_dropoff_investigation",
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
      setLoadingBusinessId("");
    }
  }

  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold">Conversion Funnel</h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-5">
        <MetricTile label="Views" value={String(Number(totals.business_view || 0))} />
        <MetricTile label="Add to Cart" value={String(Number(totals.add_to_cart || 0))} />
        <MetricTile label="Checkout" value={String(Number(totals.checkout_start || 0))} />
        <MetricTile label="Order Success" value={String(Number(totals.order_success || 0))} />
        <MetricTile label="Order Fail" value={String(Number(totals.order_fail || 0))} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <MetricTile
          label="View to Add"
          value={`${(Number(rates.viewToAddRate || 0) * 100).toFixed(2)}%`}
        />
        <MetricTile
          label="Add to Checkout"
          value={`${(Number(rates.addToCheckoutRate || 0) * 100).toFixed(2)}%`}
        />
        <MetricTile
          label="Checkout to Order"
          value={`${(Number(rates.checkoutToOrderRate || 0) * 100).toFixed(2)}%`}
        />
      </div>

      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mt-2 text-sm text-emerald-700">{success}</p> : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <article className="rounded-lg border border-slate-200 p-3">
          <h3 className="text-sm font-semibold">Top Fail Codes</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-2">Fail Code</th>
                  <th className="pb-2">Count</th>
                </tr>
              </thead>
              <tbody>
                {topFailCodes.length ? (
                  topFailCodes.map((row) => (
                    <tr key={row.failCode} className="border-t border-slate-100">
                      <td className="py-2 font-mono text-xs">{row.failCode}</td>
                      <td className="py-2">{row.count}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={2} className="py-3 text-center text-slate-500">
                      No fail codes in this window.
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
                  <th className="pb-2">Views</th>
                  <th className="pb-2">Checkout to Order</th>
                </tr>
              </thead>
              <tbody>
                {bySource.length ? (
                  bySource.map((row) => (
                    <tr key={row.source} className="border-t border-slate-100">
                      <td className="py-2">{row.source}</td>
                      <td className="py-2">{row.business_view}</td>
                      <td className="py-2">
                        {(Number(row.checkoutToOrderRate || 0) * 100).toFixed(2)}%
                      </td>
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
        <h3 className="text-sm font-semibold">Top Dropoff Businesses</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Business</th>
                <th className="pb-2">Trust</th>
                <th className="pb-2">Menu Score</th>
                <th className="pb-2">Views</th>
                <th className="pb-2">Checkout to Order</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {topDropoffBusinesses.length ? (
                topDropoffBusinesses.map((row) => (
                  <tr key={row.businessId} className="border-t border-slate-100">
                    <td className="py-2">
                      <div>{row.businessName}</div>
                      {row.pausedReason ? (
                        <div className="text-xs text-red-600">{row.pausedReason}</div>
                      ) : null}
                    </td>
                    <td className="py-2">{row.trustBadge}</td>
                    <td className="py-2">{row.menuQualityScore}</td>
                    <td className="py-2">{row.business_view}</td>
                    <td className="py-2">
                      {(Number(row.checkoutToOrderRate || 0) * 100).toFixed(2)}%
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={`/admin/audit?key=${encodeURIComponent(adminKey)}`}
                          className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                        >
                          Audit
                        </a>
                        <a
                          href={`/admin/businesses?key=${encodeURIComponent(adminKey)}`}
                          className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                        >
                          Merchant Page
                        </a>
                        <button
                          type="button"
                          disabled={Boolean(loadingBusinessId)}
                          onClick={() => pauseBusiness(row.businessId)}
                          className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700"
                        >
                          {loadingBusinessId === row.businessId ? "Pausing..." : "Pause"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-3 text-center text-slate-500">
                    No dropoff businesses for this window.
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
