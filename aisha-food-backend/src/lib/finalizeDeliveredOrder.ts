import mongoose from "mongoose";
import { Order } from "@/models/Order";
import { Settlement } from "@/models/Settlement";
import { SettlementAudit } from "@/models/SettlementAudit";
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
import { isOtpExpired, verifyOtp } from "@/lib/deliveryOtp";
import { evaluateDriverIncentives } from "@/lib/driverIncentives";
import { getCityByIdOrDefault } from "@/lib/city";
import { resolveOperationalOrderDeliveryMode } from "@/lib/deliveryPolicy";

type ApiError = Error & { status?: number; code?: string };

function apiError(status: number, code: string, message: string): ApiError {
  const error = new Error(message) as ApiError;
  error.status = status;
  error.code = code;
  return error;
}

export type DeliveryFinalizationOrder = {
  _id: mongoose.Types.ObjectId;
  orderNumber?: string;
  cityId?: mongoose.Types.ObjectId | null;
  businessId: mongoose.Types.ObjectId;
  businessName: string;
  status: string;
  phoneHash?: string;
  benefitsApplied?: boolean;
  createdAt: Date;
  subtotal: number;
  total: number;
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
    deliveredConfirmedAt?: Date | null;
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

export type FinalizeDeliveredOrderOptions = {
  order: DeliveryFinalizationOrder;
  deliveryOtp: string;
  shouldSetAcceptedAt?: boolean;
  routeTag: string;
  driverDeliveredConfirmedAt?: Date | null;
};

export type FinalizeDeliveredOrderResult = {
  updated: Record<string, unknown>;
  weekKey: string;
  now: Date;
  assignedDriverId: mongoose.Types.ObjectId | null;
  idempotent: boolean;
};

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

export async function finalizeDeliveredOrder({
  order: existing,
  deliveryOtp,
  shouldSetAcceptedAt = false,
  routeTag,
  driverDeliveredConfirmedAt = null,
}: FinalizeDeliveredOrderOptions): Promise<FinalizeDeliveredOrderResult> {
  const proofRequired = existing.deliveryProof?.required !== false;
  const alreadyVerified = Boolean(existing.deliveryProof?.verifiedAt);
  if (proofRequired && !alreadyVerified) {
    const otpCreatedAt = existing.deliveryProof?.otpCreatedAt || existing.createdAt;
    if (isOtpExpired(otpCreatedAt)) {
      throw apiError(
        409,
        "DELIVERY_OTP_EXPIRED",
        "El codigo de entrega vencio. Solicita soporte para finalizar."
      );
    }
    const storedOtpHash = String(existing.deliveryProof?.otpHash || "").trim();
    if (!deliveryOtp || !storedOtpHash || !verifyOtp(deliveryOtp, storedOtpHash)) {
      await Order.updateOne(
        { _id: existing._id },
        {
          $inc: { "deliveryProof.failedAttempts": 1 },
          $set: { "deliveryProof.lastFailedAt": new Date() },
        }
      ).catch(() => null);
      throw apiError(409, "DELIVERY_OTP_INVALID", "Codigo de entrega invalido.");
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
    throw apiError(409, "SETTLEMENT_LOCKED", "Settlement is locked and cannot be modified.");
  }

  const updateSet: Record<string, unknown> = {
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
  };

  if (driverDeliveredConfirmedAt && !existing.dispatch?.deliveredConfirmedAt) {
    updateSet["dispatch.deliveredConfirmedAt"] = driverDeliveredConfirmedAt;
  }

  const updated = await Order.findOneAndUpdate(
    {
      _id: existing._id,
      businessId: existing.businessId,
      "settlement.counted": false,
    },
    { $set: updateSet },
    { returnDocument: "after" }
  );

  if (!updated) {
    const latest = await Order.findById(existing._id).lean<Record<string, unknown> | null>();
    if (latest) {
      return {
        updated: latest,
        weekKey,
        now,
        assignedDriverId: existing.dispatch?.assignedDriverId || null,
        idempotent: true,
      };
    }
    throw apiError(404, "NOT_FOUND", "Order not found.");
  }

  const settlementUpdate = {
    $setOnInsert: {
      cityId: existing.cityId || null,
      businessId: existing.businessId,
      businessName: existing.businessName,
      weekKey,
      status: "pending",
    },
    $inc: {
      ordersCount: Number(existing.settlement?.counted ? 0 : 1),
      grossSubtotal: Number(existing.settlement?.counted ? 0 : Number(existing.subtotal || 0)),
      feeTotal: Number(existing.settlement?.counted ? 0 : Number(existing.commissionAmount || 0)),
    },
  };

  try {
    await Settlement.findOneAndUpdate(
      {
        businessId: existing.businessId,
        weekKey,
        status: { $ne: "locked" },
      },
      settlementUpdate,
      {
        upsert: true,
        returnDocument: "after",
      }
    );
  } catch (error: unknown) {
    const message = String((error as { message?: string })?.message || "");
    const code = String((error as { code?: number | string })?.code || "");
    if (code === "11000" || /E11000/.test(message)) {
      const lockedLatest = await Settlement.findOne({
        businessId: existing.businessId,
        weekKey,
        status: "locked",
      })
        .select("_id")
        .lean();
      if (lockedLatest) {
        throw apiError(409, "SETTLEMENT_LOCKED", "Settlement is locked and cannot be modified.");
      }
    }
    throw error;
  }

  if (!existing.settlement?.counted) {
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
          route: routeTag,
          action: "counted",
          orderId: String(existing._id),
          businessId: String(existing.businessId),
          weekKey,
          error: auditError instanceof Error ? auditError.message : "Failed to write audit event",
          timestamp: new Date().toISOString(),
        })
      );
    }
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
        route: routeTag,
        orderId: String(existing._id),
        businessId: String(existing.businessId),
        weekKey,
        deliveryMode: resolveOperationalOrderDeliveryMode(existing),
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
        route: routeTag,
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
    ).lean<DeliveryFinalizationOrder | null>();

    if (finalized && finalized.phoneHash) {
      const customerNow = new Date();
      const currentCustomer = await Customer.findOne({ phoneHash: finalized.phoneHash }).lean<CustomerLean | null>();
      if (!currentCustomer) {
        await Customer.create({
          phoneHash: finalized.phoneHash,
          cityId: finalized.cityId || null,
          walletCreditRdp: 0,
          ordersCount: 1,
          deliveredCount: 1,
          firstOrderAt: customerNow,
          firstDeliveredAt: customerNow,
        });
      } else {
        await Customer.updateOne(
          { _id: currentCustomer._id },
          {
            $inc: { ordersCount: 1, deliveredCount: 1 },
            $set: {
              firstOrderAt: currentCustomer.firstOrderAt || customerNow,
              firstDeliveredAt: currentCustomer.firstDeliveredAt || customerNow,
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
              route: routeTag,
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
        route: routeTag,
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
        route: routeTag,
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

  return {
    updated: updated.toObject ? (updated.toObject() as Record<string, unknown>) : (updated as unknown as Record<string, unknown>),
    weekKey,
    now,
    assignedDriverId,
    idempotent: false,
  };
}
