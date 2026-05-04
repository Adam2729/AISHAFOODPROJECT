"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  adminKey: string;
  fetchError?: string;
  summary: {
    totalReviews: number;
    avgRating: number;
    ratingCounts: {
      1: number;
      2: number;
      3: number;
      4: number;
      5: number;
    };
    tagsTop: Array<{ tag: string; count: number }>;
  };
  worstBusinesses: Array<{
    businessId: string;
    businessName: string;
    avgRating: number;
    reviewsCount: number;
    complaints30d: number;
    acceptanceRate30d: number;
  }>;
  latest: Array<{
    reviewId: string;
    businessId: string;
    businessName: string;
    rating: number;
    tags: string[];
    comment: string;
    source: string;
    createdAt?: string;
    isHidden: boolean;
  }>;
};

function formatDateTime(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export default function ReputationPanel({
  adminKey,
  summary,
  worstBusinesses,
  latest,
  fetchError,
}: Props) {
  const router = useRouter();
  const [loadingReviewId, setLoadingReviewId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const oneStarRate =
    Number(summary.totalReviews || 0) > 0
      ? Number((Number(summary.ratingCounts?.[1] || 0) / Number(summary.totalReviews || 1)).toFixed(4))
      : 0;
  const topTagsLabel = (summary.tagsTop || [])
    .slice(0, 5)
    .map((row) => `${row.tag} (${row.count})`)
    .join(", ");

  async function moderateReview(reviewId: string, action: "hide" | "unhide") {
    if (loadingReviewId) return;
    setLoadingReviewId(reviewId);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/admin/reviews/moderate?key=${encodeURIComponent(adminKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId,
          action,
          moderationNote: action === "hide" ? "hidden_from_ops_reputation_panel" : "restored_from_ops_reputation_panel",
          confirm: "MODERATE",
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not moderate review."
        );
      }
      setSuccess(action === "hide" ? "Review hidden." : "Review unhidden.");
      router.refresh();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not moderate review.");
    } finally {
      setLoadingReviewId("");
    }
  }

  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold">Reputation</h2>
      {fetchError ? <p className="mt-2 text-sm text-red-600">{fetchError}</p> : null}
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mt-2 text-sm text-emerald-700">{success}</p> : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <MetricTile label="Avg Rating (30d)" value={Number(summary.avgRating || 0).toFixed(2)} />
        <MetricTile label="Reviews (30d)" value={String(Number(summary.totalReviews || 0))} />
        <MetricTile label="1-star Rate" value={`${(oneStarRate * 100).toFixed(2)}%`} />
        <MetricTile label="Top Tags" value={topTagsLabel || "-"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <article className="rounded-lg border border-slate-200 p-3">
          <h3 className="text-sm font-semibold">Worst Businesses</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-2">Business</th>
                  <th className="pb-2">Avg</th>
                  <th className="pb-2">Reviews</th>
                  <th className="pb-2">Complaints</th>
                  <th className="pb-2">Accept rate</th>
                </tr>
              </thead>
              <tbody>
                {worstBusinesses.length ? (
                  worstBusinesses.map((row) => (
                    <tr key={row.businessId} className="border-t border-slate-100">
                      <td className="py-2">{row.businessName}</td>
                      <td className="py-2">{Number(row.avgRating || 0).toFixed(2)}</td>
                      <td className="py-2">{Number(row.reviewsCount || 0)}</td>
                      <td className="py-2">{Number(row.complaints30d || 0)}</td>
                      <td className="py-2">{(Number(row.acceptanceRate30d || 0) * 100).toFixed(2)}%</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-3 text-center text-slate-500">
                      No worst-business rows for this window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="rounded-lg border border-slate-200 p-3">
          <h3 className="text-sm font-semibold">Latest Reviews</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-2">Time</th>
                  <th className="pb-2">Business</th>
                  <th className="pb-2">Rating</th>
                  <th className="pb-2">Comment</th>
                  <th className="pb-2">Tags</th>
                  <th className="pb-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {latest.length ? (
                  latest.map((row) => (
                    <tr key={row.reviewId} className="border-t border-slate-100 align-top">
                      <td className="py-2">{formatDateTime(row.createdAt)}</td>
                      <td className="py-2">{row.businessName}</td>
                      <td className="py-2">{row.rating}</td>
                      <td className="py-2">{row.comment || "-"}</td>
                      <td className="py-2">{Array.isArray(row.tags) && row.tags.length ? row.tags.join(", ") : "-"}</td>
                      <td className="py-2">
                        <button
                          type="button"
                          disabled={Boolean(loadingReviewId)}
                          onClick={() => moderateReview(row.reviewId, row.isHidden ? "unhide" : "hide")}
                          className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                        >
                          {loadingReviewId === row.reviewId
                            ? "Saving..."
                            : row.isHidden
                            ? "Unhide"
                            : "Hide"}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="py-3 text-center text-slate-500">
                      No latest reviews in this window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </div>
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

