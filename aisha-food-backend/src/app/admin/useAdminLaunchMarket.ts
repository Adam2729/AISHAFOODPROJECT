"use client";

import { useEffect, useState } from "react";
import {
  buildMarketFormattingProfile,
  type MarketFormattingProfile,
} from "@/lib/marketFormatting";

type LaunchContextResponse = {
  ok?: boolean;
  market?: Record<string, unknown> | null;
};

const FALLBACK_MARKET = buildMarketFormattingProfile(null);

export function useAdminLaunchMarket(authenticated: boolean | null) {
  const [market, setMarket] = useState<MarketFormattingProfile>(FALLBACK_MARKET);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/admin/launch-context", { cache: "no-store" });
        const json = (await response.json().catch(() => null)) as LaunchContextResponse | null;
        if (!response.ok || !json?.ok || !json.market || cancelled) return;
        setMarket(buildMarketFormattingProfile(json.market));
      } catch {
        // keep fallback profile
      }
    }

    load().catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  return market;
}
