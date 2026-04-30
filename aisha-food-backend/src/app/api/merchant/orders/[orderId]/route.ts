import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { getBoolSetting, getNumberSetting } from "@/lib/appSettings";
import { Order } from "@/models/Order";
import { Settlement } from "@/models/Settlement";
import { SettlementAudit } from "@/models/SettlementAudit";
import { Business } from "@/models/Business";
import { BusinessAudit } from "@/models/BusinessAudit";
import { Customer } from "@/models/Customer";
import { PromoRedemption } from "@/models/PromoRedemption";
import { PromoSpendEvent } from "@/models/PromoSpendEvent";
import { Product } from "@/models/Product";
import { RiderPayout } from "@/models/RiderPayout";
import {
  applyReferralReward,
  awardOrderLoyalty,
  getOrCreateCustomerLoyalty,
} from "@/lib/customerLoyalty";
import { getWeekKey } from "@/lib/geo";
import { roundCurrency } from "@/lib/money";
import { canTransition, isFinalStatus, isOrderStatus, type OrderStatus } from "@/lib/orderStatus";
import { isOtpExpired, verifyOtp } from "@/lib/deliveryOtp";
import { evaluateDriverIncentives } from "@/lib/driverIncentives";
import { logRequest } from "@/lib/logger";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { getCityByIdOrDefault } from "@/lib/city";
import { resolveOperationalOrderDeliveryMode } from "@/lib/deliveryPolicy";
import { startAutomaticDriverDispatch } from "@/lib/driverDispatchOffers";
import {
  queueCustomerOrderConfirmedNotification,
  queueOrderDeliveredNotifications,
  queueOutForDeliveryNotifications,
  settleNotificationWrites,
} from "@/lib/notificationEvents";
import {
  buildOrderEvent,
  buildOrderEventPush,
  getCancellationSummary,
  isMerchantCancellationReasonCode,
  type MerchantCancellationReasonCode,
} from "@/lib/orderOperations";

type ApiError = Error & { status?: number; code?: string };

type PatchBody = {
  status?: string;
  cancelReason?: string;
  cancelReasonCode?: string;
  cancelNote?: string;
  deliveryOtp?: string;
};

type OrderLean = {
  _id: mongoose.Types.ObjectId;
  orderNumber?: string;
  cityId?: mongoose.Types.ObjectId | null;
  businessId: mongoose.Types.ObjectId;
  businessName: string;
  status: OrderStatus;
  phoneHash?: string;
  benefitsApplied?: boolean;
  createdAt: Date;
  subtotal: number;
  total: number;
  payment?: {
    method?: string | null;
    status?: string | null;
    provider?: string | null;
    reference?: string | null;
    paidAt?: Date | null;
  };
  paymentStatus?: string | null;
  commissionAmount: number;
  deliveryFeeToCustomer?: number;
  riderPayoutExpectedAtOrderTime?: number;
  items: Array<{
    productId: mongoose.Types.ObjectId;
    qty: number;
  }>;
  discount?: {
    source?: "promo" | "wallet" | null;
    code?: string | null;
    promoId?: mongoose.Types.ObjectId | null;
    amount?: number;
    subtotalBefore?: number;
    subtotalAfter?: number;
  };
  referral?: {
    usedCode?: string | null;
    referrerPhoneHash?: string | null;
    appliedNewCustomerBonus?: number | null;
  };
  settlement?: {
    weekKey?: string;
    counted?: boolean;
    collectedAt?: Date | null;
  };
  sla?: {
    firstActionAt?: Date | null;
    deliveredAt?: Date | null;
    firstActionMinutes?: number | null;
    totalMinutes?: number | null;
  };
  statusTimestamps?: {
    acceptedAt?: Date | null;
  };
  dispatch?: {
    assignedDriverId?: mongoose.Types.ObjectId | null;
  };
  deliveryProof?: {
    required?: boolean;
    otpHash?: string | null;
    otpCreatedAt?: Date | null;
    failedAttempts?: number | null;
    lastFailedAt?: Date | null;
    verifiedAt?: Date | null;
    verifiedBy?: "customer_code" | "admin_override" | null;
  };
};

type BusinessSlaState = {
  _id: mongoose.Types.ObjectId;
  paused?: boolean;
  health?: {
    slowAcceptCount30d?: number;
    cancelsCount30d?: number;
  };
};

type CustomerLean = {
  _id: mongoose.Types.ObjectId;
  phoneHash: string;
  referralCode?: string | null;
  walletCreditRdp?: number;
  ordersCount?: number;
  deliveredCount?: number;
  firstOrderAt?: Date | null;
  firstDeliveredAt?: Date | null;
};

function getStatusEvent(nextStatus: OrderStatus) {
  switch (nextStatus) {
    case "accepted":
      return buildOrderEvent({
        type: "accepted",
        label: "Order accepted",
        actor: "merchant",
      });
    case "preparing":
      return buildOrderEvent({
        type: "preparing",
        label: "Preparing started",
        actor: "merchant",
      });
    case "ready":
      return buildOrderEvent({
        type: "ready",
        label: "Ready for pickup",
        actor: "merchant",
      });
    case "out_for_delivery":
      return buildOrderEvent({
        type: "out_for_delivery",
        label: "Out for delivery",
        actor: "merchant",
      });
    default:
      return null;
  }
}

function getDeliveredEvent(proofVerifiedNow: boolean) {
  return buildOrderEvent({
    type: "otp_verified",
    label: proofVerifiedNow ? "OTP verified" : "Delivery confirmed",
    detail: proofVerifiedNow
      ? "Customer delivery code was verified."
      : "Delivery was confirmed without a new OTP verification step.",
    actor: "merchant",
  });
}

function isDuplicateError(error: unknown) {
  const code = String((error as { code?: number | string })?.code || "");
  const message = String((error as { message?: string })?.message || "");
  return code === "11000" || /E11000/.test(message);
}

async function ensureCustomerReferralCode(
  phoneHash: string,
  cityId?: mongoose.Types.ObjectId | null
) {
  const customer = await Customer.findOne({ phoneHash }).lean<CustomerLean | null>();
  if (!customer || customer.referralCode) return customer;
  if (!cityId) return customer;

  try {
    const loyalty = await getOrCreateCustomerLoyalty({ cityId, phoneHash });
    if (loyalty?.referralCode) {
      await Customer.updateOne(
        { _id: customer._id, referralCode: { $in: [null, ""] } },
        { $set: { referralCode: loyalty.referralCode } }
      );
    }
  } catch (error: unknown) {
    if (!isDuplicateError(error)) throw error;
  }

  return Customer.findById(customer._id).lean<CustomerLean | null>();
}

async function maybeApplySlaAutoPause(
  businessId: mongoose.Types.ObjectId,
  orderId: mongoose.Types.ObjectId
) {
  try {
    const [enabled, slowAcceptThreshold, cancelThreshold, business] = await Promise.all([
      getBoolSetting("sla_auto_pause_enabled", false),
      getNumberSetting("sla_slow_accept_threshold", 10),
      getNumberSetting("sla_cancel_threshold", 10),
      Business.findById(businessId)
        .select("paused health.slowAcceptCount30d health.cancelsCount30d")
        .lean<BusinessSlaState | null>(),
    ]);

    if (!enabled || !business || business.paused) return;

    const slowAccept = Number(business.health?.slowAcceptCount30d || 0);
    const cancels = Number(business.health?.cancelsCount30d || 0);
    if (slowAccept < slowAcceptThreshold && cancels < cancelThreshold) return;

    const now = new Date();
    const pausedReason = `SLA auto-pause: slowAccept=${slowAccept} cancels=${cancels}`;
    const pauseUpdate = await Business.updateOne(
      { _id: businessId, paused: { $ne: true } },
      {
        $set: {
          paused: true,
          pausedReason,
          pausedAt: now,
        },
      }
    );

    if ((pauseUpdate.modifiedCount || 0) < 1) return;

    try {
      await BusinessAudit.create({
        businessId,
        action: "PAUSED",
        meta: {
          auto: true,
          slowAccept,
          cancels,
          thresholds: {
            slowAcceptThreshold,
            cancelThreshold,
          },
        },
      });
    } catch (auditError: unknown) {
      console.error(
        JSON.stringify({
          type: "business_audit_write_error",
          route: "merchant.orders.patch",
          action: "sla_auto_pause",
          businessId: String(businessId),
          orderId: String(orderId),
          error: auditError instanceof Error ? auditError.message : "Failed to write business audit event",
          timestamp: new Date().toISOString(),
        })
      );
    }
  } catch (error: unknown) {
    console.error(
      JSON.stringify({
        type: "sla_auto_pause_error",
        route: "merchant.orders.patch",
        businessId: String(businessId),
        orderId: String(orderId),
        error: error instanceof Error ? error.message : "Failed to evaluate SLA auto-pause",
        timestamp: new Date().toISOString(),
      })
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const startedAt = Date.now();
  const finish = (
    response: ReturnType<typeof ok> | ReturnType<typeof fail>,
    status: number,
    extra?: Record<string, unknown>
  ) => {
    logRequest(req, {
      route: "merchant.orders.patch",
      status,
      durationMs: Date.now() - startedAt,
      extra,
    });
    return response;
  };

  try {
    await assertNotInMaintenance();

    const session = requireMerchantSession(req);
    const { orderId } = await params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return finish(fail("VALIDATION_ERROR", "Invalid orderId."), 400, { orderId });
    }

    const body = await readJson<PatchBody>(req);
    const requestedStatus = String(body.status || "").trim();
    const legacyCancelReason = String(body.cancelReason || "").trim().slice(0, 280);
    const cancelReasonCodeRaw = String(body.cancelReasonCode || "").trim();
    const cancelNote = String(body.cancelNote || "").trim().slice(0, 280);
    const deliveryOtp = String(body.deliveryOtp || "").trim().slice(0, 12);
    if (!requestedStatus) return finish(fail("VALIDATION_ERROR", "status is required."), 400, { orderId });
    if (!isOrderStatus(requestedStatus)) return finish(fail("VALIDATION_ERROR", "Invalid status."), 400, { orderId });
    const nextStatus: OrderStatus = requestedStatus;
    const cancelReasonCode: MerchantCancellationReasonCode | null =
      isMerchantCancellationReasonCode(cancelReasonCodeRaw)
        ? cancelReasonCodeRaw
        : null;

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);

    const existing = await Order.findOne({
      _id: new mongoose.Types.ObjectId(orderId),
      businessId: new mongoose.Types.ObjectId(session.businessId),
    }).lean<OrderLean | null>();
    if (!existing) return finish(fail("NOT_FOUND", "Order not found.", 404), 404, { orderId, businessId: session.businessId });

    if (!isOrderStatus(existing.status)) {
      return finish(fail("INVALID_STATE", "Order has invalid current status.", 400), 400, {
        orderId,
        businessId: session.businessId,
      });
    }
    if (
      existing.status === "delivered" &&
      nextStatus === "delivered" &&
      Boolean(existing.deliveryProof?.verifiedAt)
    ) {
      const latest = await Order.findById(existing._id).lean();
      return finish(ok({ order: latest || existing }), 200, {
        orderId,
        businessId: session.businessId,
        status: "delivered",
        idempotent: true,
      });
    }
    if (existing.settlement?.counted && nextStatus !== "delivered") {
      return finish(
        fail("COUNTED_FINAL", "Delivered orders cannot change status.", 409),
        409,
        {
          orderId,
          businessId: session.businessId,
          status: existing.status,
          counted: true,
        }
      );
    }
    if (isFinalStatus(existing.status)) {
      return finish(fail("INVALID_TRANSITION", "Cannot change a final order status.", 400), 400, {
        orderId,
        businessId: session.businessId,
      });
    }
    if (!canTransition(existing.status, nextStatus)) {
      return finish(fail("INVALID_TRANSITION", `Cannot move from ${existing.status} to ${nextStatus}.`, 400), 400, {
        orderId,
        businessId: session.businessId,
      });
    }
    const normalizedPaymentMethod = String((existing as { payment?: { method?: string | null } })?.payment?.method || "")
      .trim()
      .toLowerCase();
    const normalizedPaymentStatus = String(
      (existing as { payment?: { status?: string | null }; paymentStatus?: string | null })?.payment?.status ||
        existing.paymentStatus ||
        "pending"
    )
      .trim()
      .toLowerCase();
    if (
      normalizedPaymentMethod === "paytech" &&
      ["accepted", "preparing", "ready", "out_for_delivery"].includes(nextStatus) &&
      normalizedPaymentStatus !== "paid"
    ) {
      return finish(
        fail(
          "PAYMENT_PENDING",
          "PayTech orders can only move forward after online payment is confirmed.",
          409
        ),
        409,
        {
          orderId,
          businessId: session.businessId,
          paymentMethod: normalizedPaymentMethod,
          paymentStatus: normalizedPaymentStatus,
        }
      );
    }
    if (nextStatus === "cancelled" && !cancelReasonCode && !legacyCancelReason) {
      return finish(
        fail("VALIDATION_ERROR", "Cancellation reason is required.", 400),
        400,
        {
          orderId,
          businessId: session.businessId,
        }
      );
    }
    const shouldSetAcceptedAt =
      existing.status === "new" &&
      nextStatus !== "new" &&
      !existing.statusTimestamps?.acceptedAt;
    const cancellationReasonForStorage =
      cancelReasonCode || (legacyCancelReason ? "other" : null);
    const cancellationNoteForStorage =
      cancelNote || (!cancelReasonCode ? legacyCancelReason : "");
    const cancellationSummary = cancellationReasonForStorage
      ? getCancellationSummary({
          reason: cancellationReasonForStorage,
          note: cancellationNoteForStorage,
        })
      : null;
    const statusEvent = getStatusEvent(nextStatus);

    if (nextStatus === "delivered") {
      const proofRequired = existing.deliveryProof?.required !== false;
      const alreadyVerified = Boolean(existing.deliveryProof?.verifiedAt);
      if (proofRequired && !alreadyVerified) {
        const otpCreatedAt = existing.deliveryProof?.otpCreatedAt || existing.createdAt;
        if (isOtpExpired(otpCreatedAt)) {
          return finish(
            fail(
              "DELIVERY_OTP_EXPIRED",
              "El codigo de entrega vencio. Solicita soporte para finalizar.",
              409
            ),
            409,
            { orderId, businessId: session.businessId }
          );
        }
        const storedOtpHash = String(existing.deliveryProof?.otpHash || "").trim();
        if (!deliveryOtp || !storedOtpHash || !verifyOtp(deliveryOtp, storedOtpHash)) {
          await Order.updateOne(
            { _id: existing._id, businessId: existing.businessId },
            {
              $inc: { "deliveryProof.failedAttempts": 1 },
              $set: { "deliveryProof.lastFailedAt": new Date() },
            }
          ).catch(() => null);
          return finish(
            fail("DELIVERY_OTP_INVALID", "Codigo de entrega invalido.", 409),
            409,
            { orderId, businessId: session.businessId }
          );
        }
      }

      const weekKey = getWeekKey(new Date(existing.createdAt));
      const now = new Date();
      const createdAtMs = new Date(existing.createdAt).getTime();
      const firstActionMinutes = Math.max(0, Math.round((Date.now() - createdAtMs) / 60000));
      const totalMinutes = Math.max(0, Math.round((Date.now() - createdAtMs) / 60000));
      const lockedSettlement = await Settlement.findOne({
        businessId: existing.businessId,
        weekKey,
        status: "locked",
      })
        .select("_id")
        .lean();
      if (lockedSettlement) {
        return finish(
          fail("SETTLEMENT_LOCKED", "Settlement is locked and cannot be modified.", 409),
          409,
          {
            orderId,
            businessId: session.businessId,
            weekKey,
          }
        );
      }

      const proofVerifiedNow = !existing.deliveryProof?.verifiedAt;
      const deliveredEvent = getDeliveredEvent(proofVerifiedNow);
      const updated = await Order.findOneAndUpdate(
        {
          _id: existing._id,
          businessId: existing.businessId,
          "settlement.counted": false,
        },
        {
          $set: {
            status: "delivered",
            "settlement.weekKey": weekKey,
            "settlement.status": "pending",
            "settlement.counted": true,
            ...(!existing.sla?.firstActionAt
              ? {
                  "sla.firstActionAt": now,
                  "sla.firstActionMinutes": firstActionMinutes,
                }
              : {}),
            ...(!existing.sla?.deliveredAt
              ? {
                  "sla.deliveredAt": now,
                  "sla.totalMinutes": totalMinutes,
                }
              : {}),
            ...(shouldSetAcceptedAt
              ? {
                  "statusTimestamps.acceptedAt": now,
                }
              : {}),
            ...(!existing.deliveryProof?.verifiedAt
              ? {
                  "deliveryProof.verifiedAt": now,
                  "deliveryProof.verifiedBy": "customer_code",
                  "deliveryProof.failedAttempts": 0,
                }
              : {}),
          },
          ...buildOrderEventPush(deliveredEvent),
        },
        { returnDocument: "after" }
      );

      if (!updated) {
        const latest = await Order.findById(existing._id).lean();
        if (latest) return finish(ok({ order: latest }), 200, { orderId, businessId: session.businessId, status: nextStatus });
        return finish(fail("NOT_FOUND", "Order not found.", 404), 404, { orderId, businessId: session.businessId });
      }

      const settlementQuery = {
        businessId: existing.businessId,
        weekKey,
      } as const;

      const settlementUpdate = {
        $setOnInsert: {
          cityId: existing.cityId || null,
          businessId: existing.businessId,
          businessName: existing.businessName,
          weekKey,
          status: "pending",
        },
        $inc: {
          ordersCount: 1,
          grossSubtotal: Number(existing.subtotal || 0),
          feeTotal: Number(existing.commissionAmount || 0),
        },
      };

      const settlementWriteQuery = {
        ...settlementQuery,
        status: { $ne: "locked" },
      };
      try {
        await Settlement.findOneAndUpdate(
          {
            ...settlementWriteQuery,
          },
          settlementUpdate,
          {
            upsert: true,
            returnDocument: "after",
          }
        );
      } catch (e: unknown) {
        const msg = String((e as { message?: string })?.message || "");
        const code = String((e as { code?: number | string })?.code || "");
        if (code === "11000" || /E11000/.test(msg)) {
          const lockedLatest = await Settlement.findOne({
            businessId: existing.businessId,
            weekKey,
            status: "locked",
          })
            .select("_id")
            .lean();
          if (lockedLatest) {
            return finish(
              fail("SETTLEMENT_LOCKED", "Settlement is locked and cannot be modified.", 409),
              409,
              {
                orderId,
                businessId: session.businessId,
                weekKey,
              }
            );
          }
          throw e;
        } else {
          throw e;
        }
      }

      try {
        await SettlementAudit.create({
          businessId: existing.businessId,
          weekKey,
          action: "ORDER_COUNTED",
          orderId: updated._id,
          amount: Number(existing.commissionAmount || 0),
          meta: {
            subtotal: Number(existing.subtotal || 0),
          },
        });
      } catch (auditError: unknown) {
        console.error(
          JSON.stringify({
            type: "audit_write_error",
            route: "merchant.orders.patch",
            action: "counted",
            orderId: String(existing._id),
            businessId: String(existing.businessId),
            weekKey,
            error: auditError instanceof Error ? auditError.message : "Failed to write audit event",
            timestamp: new Date().toISOString(),
          })
        );
      }
      const assignedDriverId = existing.dispatch?.assignedDriverId || null;
      try {
        const city = await getCityByIdOrDefault(existing.cityId || null);
        const deliveryMode = resolveOperationalOrderDeliveryMode(existing);
        const supportsPayouts =
          city.deliveryFeeModel === "customerPays" &&
          (city.riderPayoutModel === "perDelivery" ||
            city.riderModel === "freelance" ||
            city.riderModel === "hybrid");
        const payoutAmount = roundCurrency(Number(existing.riderPayoutExpectedAtOrderTime || 0));
        const deliveryFeeCharged = roundCurrency(Number(existing.deliveryFeeToCustomer || 0));
        if (
          deliveryMode === "platform_driver" &&
          supportsPayouts &&
          assignedDriverId &&
          payoutAmount > 0
        ) {
          const payoutWeekKey = getWeekKey(new Date());
          const platformMargin = roundCurrency(Math.max(0, deliveryFeeCharged - payoutAmount));
          await RiderPayout.updateOne(
            { orderId: updated._id },
            {
              $setOnInsert: {
                cityId: city._id,
                orderId: updated._id,
                driverId: assignedDriverId,
                driverRef: null,
                businessId: existing.businessId,
                weekKey: payoutWeekKey,
                amount: payoutAmount,
                deliveryFeeCharged,
                platformMargin,
                status: "pending",
              },
            },
            { upsert: true }
          );
        }
      } catch (payoutError: unknown) {
        console.error(
          JSON.stringify({
            type: "rider_payout_create_error",
            route: "merchant.orders.patch",
            orderId: String(existing._id),
            businessId: String(existing.businessId),
            weekKey,
            error: payoutError instanceof Error ? payoutError.message : "Failed to create rider payout",
            timestamp: new Date().toISOString(),
          })
        );
      }
      try {
        if (existing.cityId && assignedDriverId) {
          await evaluateDriverIncentives({
            cityId: existing.cityId,
            driverId: assignedDriverId,
            date: now,
          });
        }
      } catch (incentiveError: unknown) {
        console.error(
          JSON.stringify({
            type: "driver_incentive_evaluation_error",
            route: "merchant.orders.patch",
            orderId: String(existing._id),
            businessId: String(existing.businessId),
            cityId: existing.cityId ? String(existing.cityId) : null,
            driverId: assignedDriverId ? String(assignedDriverId) : null,
            error:
              incentiveError instanceof Error
                ? incentiveError.message
                : "Failed to evaluate driver incentives",
            timestamp: new Date().toISOString(),
          })
        );
      }

      try {
        const finalized = await Order.findOneAndUpdate(
          {
            _id: existing._id,
            businessId: existing.businessId,
            benefitsApplied: { $ne: true },
          },
          { $set: { benefitsApplied: true } },
          { returnDocument: "after" }
        ).lean<OrderLean | null>();

        if (finalized && finalized.phoneHash) {
          const now = new Date();
          const currentCustomer = await Customer.findOne({ phoneHash: finalized.phoneHash }).lean<CustomerLean | null>();
          if (!currentCustomer) {
            await Customer.create({
              phoneHash: finalized.phoneHash,
              cityId: finalized.cityId || null,
              walletCreditRdp: 0,
              ordersCount: 1,
              deliveredCount: 1,
              firstOrderAt: now,
              firstDeliveredAt: now,
            });
          } else {
            await Customer.updateOne(
              { _id: currentCustomer._id },
              {
                $inc: { ordersCount: 1, deliveredCount: 1 },
                $set: {
                  firstOrderAt: currentCustomer.firstOrderAt || now,
                  firstDeliveredAt: currentCustomer.firstDeliveredAt || now,
                },
              }
            );
          }
          await ensureCustomerReferralCode(finalized.phoneHash, finalized.cityId || existing.cityId || null);

          const discountSource = finalized.discount?.source || null;
          const discountAmount = Number(finalized.discount?.amount || 0);

          if (discountSource === "wallet" && discountAmount > 0) {
            await Customer.updateOne(
              { phoneHash: finalized.phoneHash, walletCreditRdp: { $gte: discountAmount } },
              { $inc: { walletCreditRdp: -discountAmount } }
            );
          }

          if (
            discountSource === "promo" &&
            discountAmount > 0 &&
            finalized.discount?.code &&
            finalized.discount?.promoId &&
            finalized.discount?.subtotalBefore != null &&
            finalized.discount?.subtotalAfter != null
          ) {
            // Promo eligibility and budget are enforced at checkout/create time.
            // Delivery finalization writes exactly one redemption record per order.
            try {
              await PromoRedemption.create({
                promoId: finalized.discount.promoId,
                code: String(finalized.discount.code || "").toUpperCase(),
                businessId: finalized.businessId,
                weekKey: finalized.settlement?.weekKey || weekKey,
                phoneHash: finalized.phoneHash,
                orderId: finalized._id,
                subtotalBefore: Number(finalized.discount.subtotalBefore || 0),
                discountAmount,
                subtotalAfter: Number(finalized.discount.subtotalAfter || 0),
              });
            } catch (redemptionError: unknown) {
              if (!isDuplicateError(redemptionError)) throw redemptionError;
            }

            try {
              await PromoSpendEvent.create({
                weekKey: finalized.settlement?.weekKey || weekKey,
                orderId: finalized._id,
                promoId: finalized.discount.promoId,
                code: String(finalized.discount.code || "").toUpperCase(),
                businessId: finalized.businessId,
                amount: discountAmount,
              });
            } catch (spendEventError: unknown) {
              if (!isDuplicateError(spendEventError)) throw spendEventError;
            }
          }

          if (finalized.cityId) {
            try {
              await awardOrderLoyalty({
                cityId: finalized.cityId,
                phoneHash: finalized.phoneHash,
                orderId: finalized._id,
                orderTotal: Number(finalized.total || 0),
              });
              if (finalized.referral?.usedCode) {
                await applyReferralReward({
                  cityId: finalized.cityId,
                  referrerCode: String(finalized.referral.usedCode || ""),
                  referredPhoneHash: finalized.phoneHash,
                  orderId: finalized._id,
                });
              }
            } catch (loyaltyError: unknown) {
              console.error(
                JSON.stringify({
                  type: "customer_loyalty_finalize_error",
                  route: "merchant.orders.patch",
                  orderId: String(finalized._id),
                  businessId: String(finalized.businessId),
                  cityId: String(finalized.cityId),
                  phoneHash: finalized.phoneHash,
                  error:
                    loyaltyError instanceof Error
                      ? loyaltyError.message
                      : "Failed to apply customer loyalty rewards",
                  timestamp: new Date().toISOString(),
                })
              );
            }
          }
        }
      } catch (benefitsError: unknown) {
        console.error(
          JSON.stringify({
            type: "order_benefits_finalize_error",
            route: "merchant.orders.patch",
            action: "delivered_finalize",
            orderId: String(existing._id),
            businessId: String(existing.businessId),
            error: benefitsError instanceof Error ? benefitsError.message : "Failed to finalize order benefits",
            timestamp: new Date().toISOString(),
          })
        );
      }

      try {
        const soldProductIds = (Array.isArray(existing.items) ? existing.items : [])
          .map((item) => String(item?.productId || "").trim())
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
          .map((id) => new mongoose.Types.ObjectId(id));
        if (soldProductIds.length) {
          await Product.updateMany(
            {
              _id: { $in: soldProductIds },
              businessId: existing.businessId,
            },
            {
              $set: {
                lastSoldAt: now,
                stockHint: "in_stock",
              },
            }
          );
        }
      } catch (productUpdateError: unknown) {
        console.error(
          JSON.stringify({
            type: "product_last_sold_update_error",
            route: "merchant.orders.patch",
            action: "delivered_finalize",
            orderId: String(existing._id),
            businessId: String(existing.businessId),
            error:
              productUpdateError instanceof Error
                ? productUpdateError.message
                : "Failed to update lastSoldAt on products",
            timestamp: new Date().toISOString(),
          })
        );
      }

      await settleNotificationWrites(
        "merchant.orders.patch.delivered",
        [
          queueOrderDeliveredNotifications({
            orderId: updated._id,
            orderNumber: existing.orderNumber || null,
            businessId: existing.businessId,
            cityId: existing.cityId || null,
            driverId: existing.dispatch?.assignedDriverId || null,
            customerPhoneHash: existing.phoneHash || null,
            deliveryMode: resolveOperationalOrderDeliveryMode(existing),
            source: "merchant.orders.patch",
          }),
        ],
        {
          orderId: String(updated._id),
          businessId: String(existing.businessId),
        }
      );

      return finish(ok({ order: updated }), 200, {
        orderId,
        businessId: session.businessId,
        status: nextStatus,
      });
    }

    const now = new Date();
    const cancellationEvent =
      nextStatus === "cancelled" && cancellationSummary
        ? buildOrderEvent({
            type: "cancelled",
            label: "Order cancelled",
            detail: cancellationSummary.summary,
            actor: "merchant",
          })
        : null;
    const updated = await Order.findOneAndUpdate(
      {
        _id: existing._id,
        businessId: existing.businessId,
        status: existing.status,
      },
      {
        $set: {
          status: nextStatus,
          ...(nextStatus === "cancelled"
            ? {
                cancelReason: cancellationSummary?.summary || "Cancelled by merchant",
                cancellation: {
                  reason: cancellationReasonForStorage || "other",
                  note: cancellationNoteForStorage || "",
                  cancelledAt: now,
                  cancelledBy: "merchant",
                },
              }
            : {
                cancellation: {
                  reason: null,
                  note: "",
                  cancelledAt: null,
                  cancelledBy: null,
                },
              }
          ),
          ...(nextStatus !== "cancelled"
            ? { cancelReason: "" }
            : {}),
          ...(!existing.sla?.firstActionAt
            ? {
                "sla.firstActionAt": now,
                "sla.firstActionMinutes": Math.max(
                  0,
                  Math.round((Date.now() - new Date(existing.createdAt).getTime()) / 60000)
                ),
              }
            : {}),
          ...(shouldSetAcceptedAt
            ? {
                "statusTimestamps.acceptedAt": now,
              }
            : {}),
        },
        ...(cancellationEvent
          ? buildOrderEventPush(cancellationEvent)
          : statusEvent
            ? buildOrderEventPush(statusEvent)
            : {}),
      },
      { returnDocument: "after" }
    );
    if (!updated) return finish(fail("CONFLICT", "Order was updated by another process. Retry.", 409), 409, {
      orderId,
      businessId: session.businessId,
    });

    if (nextStatus === "cancelled") {
      try {
        await Business.updateOne(
          { _id: existing.businessId },
          {
            $inc: { "health.cancelsCount30d": 1 },
            $set: { "health.lastHealthUpdateAt": new Date() },
          }
        );
        await maybeApplySlaAutoPause(existing.businessId, existing._id);
      } catch (healthError: unknown) {
        console.error(
          JSON.stringify({
            type: "business_health_update_error",
            route: "merchant.orders.patch",
            action: "cancelled",
            businessId: String(existing.businessId),
            orderId: String(existing._id),
            error: healthError instanceof Error ? healthError.message : "Failed to update cancel counter",
            timestamp: new Date().toISOString(),
          })
        );
      }
    }

    if ((nextStatus === "accepted" || nextStatus === "preparing") && existing.status === "new") {
      const acceptLatencyMin = (Date.now() - new Date(existing.createdAt).getTime()) / 60000;
      if (acceptLatencyMin > 5) {
        try {
          await Business.updateOne(
            { _id: existing.businessId },
            {
              $inc: { "health.slowAcceptCount30d": 1 },
              $set: { "health.lastHealthUpdateAt": new Date() },
            }
          );
          await maybeApplySlaAutoPause(existing.businessId, existing._id);
        } catch (healthError: unknown) {
          console.error(
            JSON.stringify({
              type: "business_health_update_error",
              route: "merchant.orders.patch",
              action: "slow_accept",
              businessId: String(existing.businessId),
              orderId: String(existing._id),
              error: healthError instanceof Error ? healthError.message : "Failed to update slow accept counter",
              timestamp: new Date().toISOString(),
            })
          );
        }
      }
    }

    const notificationWrites: Array<Promise<unknown>> = [];
    const deliveryMode = resolveOperationalOrderDeliveryMode(existing);

    if (
      deliveryMode === "platform_driver" &&
      existing.cityId &&
      ["accepted", "preparing", "ready"].includes(nextStatus) &&
      !existing.dispatch?.assignedDriverId
    ) {
      startAutomaticDriverDispatch({
        orderId: updated._id,
        cityId: existing.cityId,
        actor: "merchant",
        source: "merchant.orders.patch.auto_dispatch",
        note: `status:${nextStatus}`,
      }).catch((dispatchError: unknown) => {
        console.error(
          JSON.stringify({
            type: "merchant_auto_dispatch_error",
            route: "merchant.orders.patch",
            orderId: String(updated._id),
            businessId: String(existing.businessId),
            cityId: String(existing.cityId),
            error:
              dispatchError instanceof Error
                ? dispatchError.message
                : "Failed to start automatic driver dispatch",
            timestamp: new Date().toISOString(),
          })
        );
      });
    }

    if (
      existing.status === "new" &&
      ["accepted", "preparing", "ready", "out_for_delivery", "delivered"].includes(nextStatus)
    ) {
      notificationWrites.push(
        queueCustomerOrderConfirmedNotification({
          orderId: updated._id,
          orderNumber: existing.orderNumber || null,
          businessId: existing.businessId,
          cityId: existing.cityId || null,
          driverId: existing.dispatch?.assignedDriverId || null,
          customerPhoneHash: existing.phoneHash || null,
          deliveryMode,
          source: "merchant.orders.patch",
        })
      );
    }

    if (nextStatus === "out_for_delivery") {
      notificationWrites.push(
        queueOutForDeliveryNotifications({
          orderId: updated._id,
          orderNumber: existing.orderNumber || null,
          businessId: existing.businessId,
          cityId: existing.cityId || null,
          driverId: existing.dispatch?.assignedDriverId || null,
          customerPhoneHash: existing.phoneHash || null,
          deliveryMode,
          source: "merchant.orders.patch",
        })
      );
    }

    await settleNotificationWrites("merchant.orders.patch", notificationWrites, {
      orderId: String(updated._id),
      businessId: String(existing.businessId),
      nextStatus,
    });

    return finish(ok({ order: updated }), 200, {
      orderId,
      businessId: session.businessId,
      status: nextStatus,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return finish(fail(err.code || "SERVER_ERROR", err.message || "Could not update order.", err.status || 500), err.status || 500, {
      error: err.message || "Could not update order.",
    });
  }
}
