import { expireDriverOfferForOrder, offerNextDriverForOrder, startAutomaticDriverDispatch } from "@/lib/driverDispatchOffers";

export async function dispatchPlatformDriverOrder(input: {
  orderId: string;
  cityId: string;
  source?: string;
}) {
  return startAutomaticDriverDispatch({
    orderId: input.orderId,
    cityId: input.cityId,
    source: input.source || "auto_dispatch.launch_ready",
  });
}

export async function offerNextPlatformDriver(input: {
  orderId: string;
  cityId: string;
  source?: string;
  excludeDriverIds?: string[];
}) {
  return offerNextDriverForOrder({
    orderId: input.orderId,
    cityId: input.cityId,
    source: input.source || "auto_dispatch.offer_next",
    excludeDriverIds: input.excludeDriverIds,
  });
}

export async function retryExpiredDriverOffer(input: {
  orderId: string;
  cityId: string;
  driverId?: string | null;
  source?: string;
  reason?: string | null;
}) {
  return expireDriverOfferForOrder({
    orderId: input.orderId,
    cityId: input.cityId,
    driverId: input.driverId || null,
    source: input.source || "auto_dispatch.expire_offer",
    reason: input.reason || "offer_expired",
    triggerNext: true,
  });
}
