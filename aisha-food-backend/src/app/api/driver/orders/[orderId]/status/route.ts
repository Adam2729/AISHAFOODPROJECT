import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { cityCode } from "@/lib/city";
import { requireDriverCityContext } from "@/lib/driverContext";
import {
  queueOrderDeliveredNotifications,
  queueOutForDeliveryNotifications,
  settleNotificationWrites,
} from "@/lib/notificationEvents";
import { canTransition, isOrderStatus } from "@/lib/orderStatus";
import {
  finalizeDeliveredOrder,
  type DeliveryFinalizationOrder,
} from "@/lib/finalizeDeliveredOrder";
import { DispatchAudit } from "@/models/DispatchAudit";
import { DriverAudit } from "@/models/DriverAudit";
import { Driver } from "@/models/Driver";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  action?: string;
  status?: string;
  note?: string;
  deliveryOtp?: string;
  proofNote?: string;
  photoUrl?: string;
  proof?: {
    note?: string;
    photoUrl?: string;
  };
};

type DriverOrderLean = DeliveryFinalizationOrder & {
  dispatch?: {
    assignedDriverId?: mongoose.Types.ObjectId | null;
    pickupConfirmedAt?: Date | null;
    deliveredConfirmedAt?: Date | null;
  };
  deliveryProof?: DeliveryFinalizationOrder["deliveryProof"] & {
    note?: string | null;
    photoUrl?: string | null;
    capturedAt?: Date | null;
    capturedByDriverId?: mongoose.Types.ObjectId | null;
    otpLast4?: string | null;
  };
};

function normalizeAction(input: Body) {
  const actionRaw = String(input.action || "").trim().toLowerCase();
  if (actionRaw === "delivered_attempt" || actionRaw === "confirm_handoff") return "delivered";
  if (actionRaw) return actionRaw;
  const status = String(input.status || "").trim().toLowerCase();
  if (status === "out_for_delivery") return "picked_up";
  if (status === "delivered_attempt") return "delivered";
  if (status === "delivered") return "delivered";
  return "";
}

function normalizeNote(value: unknown, max = 280) {
  return String(value || "").trim().slice(0, max);
}

function normalizeProofInput(body: Body) {
  const note = normalizeNote(body.proof?.note ?? body.proofNote, 280);
  const photoUrl = normalizeNote(body.proof?.photoUrl ?? body.photoUrl, 500);
  return {
    note,
    photoUrl,
    hasProof: Boolean(note || photoUrl),
  };
}

function hasExistingDeliveryProof(order: DriverOrderLean) {
  return Boolean(
    order.deliveryProof?.capturedAt ||
      String(order.deliveryProof?.note || "").trim() ||
      String(order.deliveryProof?.photoUrl || "").trim()
  );
}

async function captureDeliveryProof(input: {
  orderId: mongoose.Types.ObjectId;
  cityId: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  proof: ReturnType<typeof normalizeProofInput>;
  capturedAt: Date;
}) {
  if (!input.proof.hasProof) return;
  await Order.updateOne(
    {
      _id: input.orderId,
      cityId: input.cityId,
      "dispatch.assignedDriverId": input.driverId,
    },
    {
      $set: {
        "deliveryProof.note": input.proof.note || null,
        "deliveryProof.photoUrl": input.proof.photoUrl || null,
        "deliveryProof.capturedAt": input.capturedAt,
        "deliveryProof.capturedByDriverId": input.driverId,
      },
    }
  );
}

async function writeRejectedAudit({
  cityId,
  driverId,
  orderId,
  action,
  currentStatus,
  reason,
  note,
}: {
  cityId: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId;
  action: string;
  currentStatus: string;
  reason: string;
  note: string;
}) {
  await DriverAudit.create({
    cityId,
    driverId,
    orderId,
    action: "STATUS_UPDATE_REJECTED",
    meta: {
      action,
      currentStatus,
      reason,
      note: note || null,
    },
  });
}

async function updateDriverDeliveryTimestamp(
  driverId: mongoose.Types.ObjectId,
  cityId: mongoose.Types.ObjectId,
  value: Date
) {
  await Driver.updateOne(
    { _id: driverId, cityId, lastDeliveryConfirmedAt: { $exists: true } },
    { $set: { lastDeliveryConfirmedAt: value } }
  ).catch(() => null);
  await Driver.updateOne(
    { _id: driverId, cityId, lastDeliveryConfirmedAt: { $exists: false } },
    { $set: { lastDeliveryConfirmedAt: value } }
  ).catch(() => null);
}

export async function POST(
  req: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const { driver, city } = await requireDriverCityContext(req);

    const { orderId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Valid orderId is required.", 400);
    }

    const body = await readJson<Body>(req);
    const action = normalizeAction(body);
    const note = normalizeNote(body.note, 280);
    const proofInput = normalizeProofInput(body);
    const deliveryOtp = String(body.deliveryOtp || "").trim().slice(0, 12);
    if (action !== "picked_up" && action !== "delivered") {
      return fail("VALIDATION_ERROR", "action must be 'picked_up' or 'delivered'.", 400);
    }

    const cityIdObj = new mongoose.Types.ObjectId(String(city._id));
    const driverIdObj = new mongoose.Types.ObjectId(String(driver._id));
    const order = await Order.findOne({
      _id: new mongoose.Types.ObjectId(orderId),
      cityId: cityIdObj,
      "deliverySnapshot.mode": "platform_driver",
      "dispatch.assignedDriverId": driverIdObj,
    })
      .select(
        [
          "_id",
          "orderNumber",
          "businessId",
          "businessName",
          "cityId",
          "status",
          "deliverySnapshot.mode",
          "phoneHash",
          "benefitsApplied",
          "createdAt",
          "subtotal",
          "total",
          "commissionAmount",
          "deliveryFeeToCustomer",
          "riderPayoutExpectedAtOrderTime",
          "items.productId",
          "items.qty",
          "discount.source",
          "discount.code",
          "discount.promoId",
          "discount.amount",
          "discount.subtotalBefore",
          "discount.subtotalAfter",
          "referral.usedCode",
          "referral.referrerPhoneHash",
          "referral.appliedNewCustomerBonus",
          "settlement.weekKey",
          "settlement.counted",
          "settlement.collectedAt",
          "sla.firstActionAt",
          "sla.deliveredAt",
          "sla.firstActionMinutes",
          "sla.totalMinutes",
          "statusTimestamps.acceptedAt",
          "dispatch.assignedDriverId",
          "dispatch.pickupConfirmedAt",
          "dispatch.deliveredConfirmedAt",
          "deliveryProof.required",
          "deliveryProof.otpHash",
          "deliveryProof.otpCreatedAt",
          "deliveryProof.verifiedAt",
          "deliveryProof.verifiedBy",
          "deliveryProof.note",
          "deliveryProof.photoUrl",
          "deliveryProof.capturedAt",
          "deliveryProof.capturedByDriverId",
          "deliveryProof.otpLast4",
        ].join(" ")
      )
      .lean<DriverOrderLean | null>();
    if (!order) {
      return fail("NOT_FOUND", "Platform-driver order not assigned to this driver in selected city.", 404);
    }

    const currentStatus = String(order.status || "").trim();
    let changed = false;
    let nextStatus = currentStatus;
    const now = new Date();
    const setFields: Record<string, unknown> = {};
    let dispatchAction = "";

    if (action === "picked_up") {
      if (currentStatus === "delivered" || currentStatus === "cancelled") {
        await writeRejectedAudit({
          cityId: cityIdObj,
          driverId: driverIdObj,
          orderId: order._id,
          action,
          currentStatus,
          reason: "FINAL_STATUS",
          note,
        });
        return fail("STATUS_NOT_ALLOWED", "Cannot update final orders.", 409);
      }

      if (currentStatus === "out_for_delivery") {
        if (order.dispatch?.pickupConfirmedAt) {
          return ok({
            cityId: String(city._id),
            cityCode: cityCode(city),
            orderId: String(order._id),
            action,
            changed: false,
            finalized: false,
            idempotent: true,
            status: "out_for_delivery",
            dispatch: {
              pickupConfirmedAt: order.dispatch?.pickupConfirmedAt || null,
              deliveredConfirmedAt: order.dispatch?.deliveredConfirmedAt || null,
            },
          });
        }
        nextStatus = "out_for_delivery";
      } else if (isOrderStatus(currentStatus) && canTransition(currentStatus, "out_for_delivery")) {
        setFields.status = "out_for_delivery";
        nextStatus = "out_for_delivery";
        changed = true;
      } else {
        await writeRejectedAudit({
          cityId: cityIdObj,
          driverId: driverIdObj,
          orderId: order._id,
          action,
          currentStatus,
          reason: "TRANSITION_NOT_ALLOWED",
          note,
        });
        return fail("STATUS_NOT_ALLOWED", "Transition not allowed from current status.", 409);
      }

      if (!order.dispatch?.pickupConfirmedAt) {
        setFields["dispatch.pickupConfirmedAt"] = now;
        changed = true;
      }
      dispatchAction = "PICKUP_CONFIRMED";
    } else {
      if (currentStatus === "delivered" && order.deliveryProof?.verifiedAt) {
        return ok({
          cityId: String(city._id),
          cityCode: cityCode(city),
          orderId: String(order._id),
          action,
          changed: false,
          finalized: true,
          idempotent: true,
          status: "delivered",
          dispatch: {
            pickupConfirmedAt: order.dispatch?.pickupConfirmedAt || null,
            deliveredConfirmedAt: order.dispatch?.deliveredConfirmedAt || null,
          },
          deliveryProof: {
            required: order.deliveryProof?.required !== false,
            otpLast4: String(order.deliveryProof?.otpLast4 || "").trim() || null,
            verifiedAt: order.deliveryProof?.verifiedAt || null,
            note: String(order.deliveryProof?.note || "").trim() || null,
            photoUrl: String(order.deliveryProof?.photoUrl || "").trim() || null,
            capturedAt: order.deliveryProof?.capturedAt || null,
            capturedByDriverId: order.deliveryProof?.capturedByDriverId
              ? String(order.deliveryProof.capturedByDriverId)
              : null,
          },
        });
      }

      if (currentStatus === "cancelled" || currentStatus === "delivered") {
        await writeRejectedAudit({
          cityId: cityIdObj,
          driverId: driverIdObj,
          orderId: order._id,
          action,
          currentStatus,
          reason: "FINAL_STATUS",
          note,
        });
        return fail("STATUS_NOT_ALLOWED", "Cannot update final orders.", 409);
      }

      if (currentStatus !== "out_for_delivery") {
        await writeRejectedAudit({
          cityId: cityIdObj,
          driverId: driverIdObj,
          orderId: order._id,
          action,
          currentStatus,
          reason: "TRANSITION_NOT_ALLOWED",
          note,
        });
        return fail("STATUS_NOT_ALLOWED", "Must be out_for_delivery before confirming delivery.", 409);
      }

      const proofRequired = order.deliveryProof?.required !== false;
      const alreadyVerified = Boolean(order.deliveryProof?.verifiedAt);
      if (proofRequired && !alreadyVerified && !deliveryOtp) {
        await writeRejectedAudit({
          cityId: cityIdObj,
          driverId: driverIdObj,
          orderId: order._id,
          action,
          currentStatus,
          reason: "DELIVERY_OTP_REQUIRED",
          note,
        });
        return fail("DELIVERY_OTP_REQUIRED", "deliveryOtp is required to confirm delivery.", 409);
      }
      if (!proofRequired && !proofInput.hasProof && !hasExistingDeliveryProof(order)) {
        await writeRejectedAudit({
          cityId: cityIdObj,
          driverId: driverIdObj,
          orderId: order._id,
          action,
          currentStatus,
          reason: "DELIVERY_PROOF_REQUIRED",
          note,
        });
        return fail(
          "DELIVERY_PROOF_REQUIRED",
          "Proof note or photoUrl is required to confirm this delivery.",
          409
        );
      }

      try {
        const finalized = await finalizeDeliveredOrder({
          order,
          deliveryOtp,
          routeTag: "driver.orders.status",
          driverDeliveredConfirmedAt: now,
        });
        const finalizedWithOtp = Boolean(deliveryOtp);

        await captureDeliveryProof({
          orderId: order._id,
          cityId: cityIdObj,
          driverId: driverIdObj,
          proof: proofInput,
          capturedAt: now,
        });

        await DriverAudit.create({
          cityId: cityIdObj,
          driverId: driverIdObj,
          orderId: order._id,
          action: finalizedWithOtp ? "DELIVERY_OTP_VERIFIED" : "DELIVERED_CONFIRMED",
          meta: {
            note: note || null,
            fromStatus: currentStatus,
            toStatus: "delivered",
            finalized: true,
            idempotent: finalized.idempotent,
            proofCaptured: proofInput.hasProof,
          },
        });

        await DispatchAudit.create({
          cityId: cityIdObj,
          orderId: order._id,
          businessId: order.businessId,
          driverId: driverIdObj,
          action: finalizedWithOtp ? "DELIVERED_WITH_DRIVER_OTP" : "DELIVERED_CONFIRMED",
          actor: "driver",
          meta: {
            cityId: cityIdObj,
            driverId: driverIdObj,
            selectedDriverId: driverIdObj,
            note: note || (finalizedWithOtp ? "driver_otp_finalized" : "driver_delivered"),
          },
        });

        await updateDriverDeliveryTimestamp(driverIdObj, cityIdObj, now);

        await settleNotificationWrites(
          "driver.orders.status.delivered",
          [
            queueOrderDeliveredNotifications({
              orderId: order._id,
              orderNumber: order.orderNumber || null,
              businessId: order.businessId,
              cityId: cityIdObj,
              driverId: driverIdObj,
              customerPhoneHash: order.phoneHash || null,
              deliveryMode: "platform_driver",
              source: "driver.orders.status",
            }),
          ],
          {
            orderId: String(order._id),
            driverId: String(driverIdObj),
          }
        );

        const refreshed = await Order.findById(order._id)
          .select(
            "status dispatch.pickupConfirmedAt dispatch.deliveredConfirmedAt deliveryProof.required deliveryProof.otpLast4 deliveryProof.verifiedAt deliveryProof.note deliveryProof.photoUrl deliveryProof.capturedAt deliveryProof.capturedByDriverId"
          )
          .lean<{
            status?: string;
            dispatch?: {
              pickupConfirmedAt?: Date | null;
              deliveredConfirmedAt?: Date | null;
            };
            deliveryProof?: {
              required?: boolean;
              otpLast4?: string | null;
              verifiedAt?: Date | null;
              note?: string | null;
              photoUrl?: string | null;
              capturedAt?: Date | null;
              capturedByDriverId?: mongoose.Types.ObjectId | null;
            };
          } | null>();
        if (!refreshed) {
          return fail("NOT_FOUND", "Order not found after update.", 404);
        }

        return ok({
          cityId: String(city._id),
          cityCode: cityCode(city),
          orderId: String(order._id),
          action,
          changed: !finalized.idempotent,
          finalized: true,
          idempotent: finalized.idempotent,
          status: String(refreshed.status || ""),
          dispatch: {
            pickupConfirmedAt: refreshed.dispatch?.pickupConfirmedAt || null,
            deliveredConfirmedAt: refreshed.dispatch?.deliveredConfirmedAt || null,
          },
          deliveryProof: {
            required: refreshed.deliveryProof?.required !== false,
            otpLast4: String(refreshed.deliveryProof?.otpLast4 || "").trim() || null,
            verifiedAt: refreshed.deliveryProof?.verifiedAt || null,
            note: String(refreshed.deliveryProof?.note || "").trim() || null,
            photoUrl: String(refreshed.deliveryProof?.photoUrl || "").trim() || null,
            capturedAt: refreshed.deliveryProof?.capturedAt || null,
            capturedByDriverId: refreshed.deliveryProof?.capturedByDriverId
              ? String(refreshed.deliveryProof.capturedByDriverId)
              : null,
          },
        });
      } catch (error: unknown) {
        const err = error as ApiError;
        await writeRejectedAudit({
          cityId: cityIdObj,
          driverId: driverIdObj,
          orderId: order._id,
          action: deliveryOtp ? "delivered_with_otp" : "delivered",
          currentStatus,
          reason: err.code || "DELIVERY_FINALIZE_FAILED",
          note,
        }).catch(() => null);
        return fail(
          err.code || "SERVER_ERROR",
          err.message || "Could not finalize delivery.",
          err.status || 500
        );
      }
    }

    if (Object.keys(setFields).length) {
      await Order.updateOne(
        {
          _id: order._id,
          cityId: cityIdObj,
          "dispatch.assignedDriverId": driverIdObj,
        },
        { $set: setFields }
      );
    }

    const deliveredTimestampSet = Boolean(setFields["dispatch.deliveredConfirmedAt"]);

    await DriverAudit.create({
      cityId: cityIdObj,
      driverId: driverIdObj,
      orderId: order._id,
      action: "PICKED_UP",
      meta: {
        note: note || null,
        fromStatus: currentStatus,
        toStatus: nextStatus,
        changed,
        dispatchDeliveredConfirmedAtWasSet: deliveredTimestampSet,
      },
    });

    if (dispatchAction) {
      await DispatchAudit.create({
        cityId: cityIdObj,
        orderId: order._id,
        businessId: order.businessId,
        driverId: driverIdObj,
        action: dispatchAction,
        actor: "driver",
        meta: {
          cityId: cityIdObj,
          driverId: driverIdObj,
          selectedDriverId: driverIdObj,
          note: "driver_picked_up",
        },
      });
    }

    if (action === "picked_up") {
      await settleNotificationWrites(
        "driver.orders.status.picked_up",
        [
          queueOutForDeliveryNotifications({
            orderId: order._id,
            orderNumber: order.orderNumber || null,
            businessId: order.businessId,
            cityId: cityIdObj,
            driverId: driverIdObj,
            customerPhoneHash: order.phoneHash || null,
            deliveryMode: "platform_driver",
            source: "driver.orders.status",
          }),
        ],
        {
          orderId: String(order._id),
          driverId: String(driverIdObj),
        }
      );
    }

    if (deliveredTimestampSet) {
      await updateDriverDeliveryTimestamp(driverIdObj, cityIdObj, now);
    }

    const updated = await Order.findById(order._id)
      .select("status dispatch.pickupConfirmedAt dispatch.deliveredConfirmedAt")
      .lean<{
        status?: string;
        dispatch?: {
          pickupConfirmedAt?: Date | null;
          deliveredConfirmedAt?: Date | null;
        };
      } | null>();
    if (!updated) return fail("NOT_FOUND", "Order not found after update.", 404);

    return ok({
      cityId: String(city._id),
      cityCode: cityCode(city),
      orderId: String(order._id),
      action,
      changed,
      finalized: false,
      status: String(updated.status || ""),
      dispatch: {
        pickupConfirmedAt: updated.dispatch?.pickupConfirmedAt || null,
        deliveredConfirmedAt: updated.dispatch?.deliveredConfirmedAt || null,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update driver order status.",
      err.status || 500
    );
  }
}

export const PATCH = POST;
