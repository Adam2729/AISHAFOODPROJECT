"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Row = {
  businessId: string;
  businessName: string;
  type: string;
  isPaused: boolean;
  pausedReason: string;
  menuQuality: {
    menuQualityScore: number;
    productsActiveCount: number;
    productsWithImageCount: number;
    categoriesCount: number;
  };
};

type Props = {
  adminKey: string;
  minProductsRequired: number;
  minScore: number;
  pauseEnabled: boolean;
  pauseThreshold: number;
  autoHideEnabled: boolean;
  autoHideDays: number;
  autoHideNeverSoldEnabled: boolean;
  autoHideLastRunAt: string | null;
  autoHideLastScanned: number;
  autoHideLastHidden: number;
  avgScore: number;
  belowMinScoreCount: number;
  belowPauseThresholdCount: number;
  listAtRisk: Row[];
};

export default function MenuQualityControlsPanel({
  adminKey,
  minProductsRequired,
  minScore,
  pauseEnabled,
  pauseThreshold,
  autoHideEnabled,
  autoHideDays,
  autoHideNeverSoldEnabled,
  autoHideLastRunAt,
  autoHideLastScanned,
  autoHideLastHidden,
  avgScore,
  belowMinScoreCount,
  belowPauseThresholdCount,
  listAtRisk,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [minProductsDraft, setMinProductsDraft] = useState(String(minProductsRequired));
  const [minScoreDraft, setMinScoreDraft] = useState(String(minScore));
  const [pauseEnabledDraft, setPauseEnabledDraft] = useState(pauseEnabled);
  const [pauseThresholdDraft, setPauseThresholdDraft] = useState(String(pauseThreshold));
  const [autoHideEnabledDraft, setAutoHideEnabledDraft] = useState(autoHideEnabled);
  const [autoHideDaysDraft, setAutoHideDaysDraft] = useState(String(autoHideDays));
  const [autoHideNeverSoldDraft, setAutoHideNeverSoldDraft] = useState(autoHideNeverSoldEnabled);

  useEffect(() => {
    setMinProductsDraft(String(minProductsRequired));
    setMinScoreDraft(String(minScore));
    setPauseEnabledDraft(pauseEnabled);
    setPauseThresholdDraft(String(pauseThreshold));
    setAutoHideEnabledDraft(autoHideEnabled);
    setAutoHideDaysDraft(String(autoHideDays));
    setAutoHideNeverSoldDraft(autoHideNeverSoldEnabled);
  }, [
    minProductsRequired,
    minScore,
    pauseEnabled,
    pauseThreshold,
    autoHideEnabled,
    autoHideDays,
    autoHideNeverSoldEnabled,
  ]);

  async function postJson(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) {
      throw new Error(
        (typeof json?.error === "string" ? json.error : json?.error?.message) || "Request failed."
      );
    }
  }

  async function saveSettings() {
    if (loading) return;
    const minProducts = Number(minProductsDraft);
    const nextMinScore = Number(minScoreDraft);
    const nextPauseThreshold = Number(pauseThresholdDraft);
    const nextAutoHideDays = Number(autoHideDaysDraft);
    if (!Number.isFinite(minProducts) || minProducts < 1) {
      setError("min_products_required invalido.");
      return;
    }
    if (!Number.isFinite(nextMinScore) || nextMinScore < 0 || nextMinScore > 100) {
      setError("menu_quality_min_score invalido.");
      return;
    }
    if (!Number.isFinite(nextPauseThreshold) || nextPauseThreshold < 0 || nextPauseThreshold > 100) {
      setError("menu_quality_pause_threshold invalido.");
      return;
    }
    if (!Number.isFinite(nextAutoHideDays) || nextAutoHideDays < 1) {
      setError("auto_hide_days invalido.");
      return;
    }

    setLoading("save-settings");
    setError("");
    setSuccess("");
    try {
      await Promise.all([
        postJson(`/api/admin/settings/number?key=${encodeURIComponent(adminKey)}`, {
          key: "min_products_required",
          value: Math.round(minProducts),
        }),
        postJson(`/api/admin/settings/number?key=${encodeURIComponent(adminKey)}`, {
          key: "menu_quality_min_score",
          value: Math.round(nextMinScore),
        }),
        postJson(`/api/admin/settings/number?key=${encodeURIComponent(adminKey)}`, {
          key: "menu_quality_pause_threshold",
          value: Math.round(nextPauseThreshold),
        }),
        postJson(`/api/admin/settings/number?key=${encodeURIComponent(adminKey)}`, {
          key: "auto_hide_days",
          value: Math.round(nextAutoHideDays),
        }),
        postJson(`/api/admin/settings/bool?key=${encodeURIComponent(adminKey)}`, {
          key: "menu_quality_pause_enabled",
          value: Boolean(pauseEnabledDraft),
        }),
        postJson(`/api/admin/settings/bool?key=${encodeURIComponent(adminKey)}`, {
          key: "auto_hide_enabled",
          value: Boolean(autoHideEnabledDraft),
        }),
        postJson(`/api/admin/settings/bool?key=${encodeURIComponent(adminKey)}`, {
          key: "auto_hide_never_sold_enabled",
          value: Boolean(autoHideNeverSoldDraft),
        }),
      ]);
      setSuccess("Menu quality settings updated.");
      router.refresh();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not save settings.");
    } finally {
      setLoading("");
    }
  }

  async function runRecomputeNow() {
    if (loading) return;
    setLoading("recompute");
    setError("");
    setSuccess("");
    try {
      await postJson(`/api/admin/jobs/menu-quality-recompute?key=${encodeURIComponent(adminKey)}`, {});
      setSuccess("Menu quality recompute job finished.");
      router.refresh();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not run recompute job.");
    } finally {
      setLoading("");
    }
  }

  async function runAutoHideNow() {
    if (loading) return;
    setLoading("auto-hide");
    setError("");
    setSuccess("");
    try {
      await postJson(`/api/admin/jobs/auto-hide-products?key=${encodeURIComponent(adminKey)}`, {});
      setSuccess("Auto-hide job finished.");
      router.refresh();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Could not run auto-hide job.");
    } finally {
      setLoading("");
    }
  }

  async function pauseBusinessForLowQuality(businessId: string) {
    if (loading) return;
    setLoading(`pause:${businessId}`);
    setError("");
    setSuccess("");
    try {
      await postJson(`/api/admin/businesses/pause?key=${encodeURIComponent(adminKey)}`, {
        businessId,
        paused: true,
        reason: "menu_quality_low",
      });
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
      <h2 className="text-lg font-semibold">Menu Quality</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <MetricTile label="Avg Score" value={String(Number(avgScore || 0).toFixed(2))} />
        <MetricTile label="Below Min Score" value={String(Number(belowMinScoreCount || 0))} />
        <MetricTile
          label="Below Pause Threshold"
          value={String(Number(belowPauseThresholdCount || 0))}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <article className="rounded-lg border border-slate-200 p-3">
          <h3 className="text-sm font-semibold">Quality Settings</h3>
          <div className="mt-2 grid gap-2 text-sm">
            <label>
              Min products required
              <input
                value={minProductsDraft}
                onChange={(e) => setMinProductsDraft(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                inputMode="numeric"
              />
            </label>
            <label>
              Min score
              <input
                value={minScoreDraft}
                onChange={(e) => setMinScoreDraft(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                inputMode="numeric"
              />
            </label>
            <label>
              Pause threshold
              <input
                value={pauseThresholdDraft}
                onChange={(e) => setPauseThresholdDraft(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                inputMode="numeric"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={pauseEnabledDraft}
                onChange={(e) => setPauseEnabledDraft(e.target.checked)}
              />
              Auto-pause low quality businesses
            </label>
          </div>
        </article>

        <article className="rounded-lg border border-slate-200 p-3">
          <h3 className="text-sm font-semibold">Auto-Hide Products</h3>
          <div className="mt-2 grid gap-2 text-sm">
            <label>
              Auto-hide days
              <input
                value={autoHideDaysDraft}
                onChange={(e) => setAutoHideDaysDraft(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                inputMode="numeric"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoHideEnabledDraft}
                onChange={(e) => setAutoHideEnabledDraft(e.target.checked)}
              />
              Auto-hide enabled
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoHideNeverSoldDraft}
                onChange={(e) => setAutoHideNeverSoldDraft(e.target.checked)}
              />
              Hide never-sold old products
            </label>
            <p className="text-xs text-slate-500">
              Last run: {autoHideLastRunAt || "-"} | scanned: {autoHideLastScanned} | hidden:{" "}
              {autoHideLastHidden}
            </p>
          </div>
        </article>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={Boolean(loading)}
          onClick={saveSettings}
          className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
        >
          {loading === "save-settings" ? "Saving..." : "Save Settings"}
        </button>
        <button
          type="button"
          disabled={Boolean(loading)}
          onClick={runRecomputeNow}
          className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold"
        >
          {loading === "recompute" ? "Running..." : "Recompute Now"}
        </button>
        <button
          type="button"
          disabled={Boolean(loading)}
          onClick={runAutoHideNow}
          className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold"
        >
          {loading === "auto-hide" ? "Running..." : "Run Auto-Hide Now"}
        </button>
      </div>

      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mt-2 text-sm text-emerald-700">{success}</p> : null}

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-2">Business</th>
              <th className="pb-2">Type</th>
              <th className="pb-2">Score</th>
              <th className="pb-2">Active</th>
              <th className="pb-2">Images</th>
              <th className="pb-2">Categories</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {listAtRisk.length ? (
              listAtRisk.map((row) => (
                <tr key={row.businessId} className="border-t border-slate-100">
                  <td className="py-2">
                    <div className="font-medium">{row.businessName}</div>
                    {row.isPaused ? (
                      <div className="text-xs text-red-600">
                        paused: {row.pausedReason || "manual"}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2">{row.type}</td>
                  <td className="py-2">{row.menuQuality.menuQualityScore}</td>
                  <td className="py-2">{row.menuQuality.productsActiveCount}</td>
                  <td className="py-2">{row.menuQuality.productsWithImageCount}</td>
                  <td className="py-2">{row.menuQuality.categoriesCount}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={`/admin/businesses?key=${encodeURIComponent(adminKey)}`}
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                      >
                        Open merchant page
                      </a>
                      <button
                        type="button"
                        disabled={Boolean(loading)}
                        onClick={() => pauseBusinessForLowQuality(row.businessId)}
                        className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700"
                      >
                        {loading === `pause:${row.businessId}` ? "Pausing..." : "Pause business"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="py-3 text-center text-slate-500">
                  No at-risk menu quality businesses.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
