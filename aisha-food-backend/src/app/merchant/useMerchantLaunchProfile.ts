"use client";

import { useEffect, useState } from "react";
import {
  buildMarketFormattingProfile,
  type MarketFormattingProfile,
} from "@/lib/marketFormatting";

type MerchantContextResponse = {
  ok?: boolean;
  business?: Record<string, unknown> | null;
};

const FALLBACK_MARKET = buildMarketFormattingProfile(null);

export function useMerchantLaunchProfile() {
  const [market, setMarket] = useState<MarketFormattingProfile>(FALLBACK_MARKET);
  const [deliveryType, setDeliveryType] = useState<"own_driver" | "platform_driver">("own_driver");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/merchant/context", { cache: "no-store" });
        const json = (await response.json().catch(() => null)) as MerchantContextResponse | null;
        if (!response.ok || !json?.ok || !json.business || cancelled) return;
        setMarket(buildMarketFormattingProfile(json.business));
        setDeliveryType(
          String(json.business.deliveryType || "").trim() === "platform_driver"
            ? "platform_driver"
            : "own_driver"
        );
      } catch {
        // keep fallback profile
      }
    }

    load().catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    market,
    deliveryType,
    usingPlatformDriver: deliveryType === "platform_driver",
  };
}
