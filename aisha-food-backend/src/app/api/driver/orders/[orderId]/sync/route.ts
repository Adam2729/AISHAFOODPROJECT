import mongoose from "mongoose";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import { requireDriverCityContext } from "@/lib/driverContext";
import { DriverAudit } from "@/models/DriverAudit";
import { POST as acceptDriverOrder } from "@/app/api/driver/orders/[orderId]/accept/route";
import { POST as rejectDriverOrder } from "@/app/api/driver/orders/[orderId]/reject/route";
import { POST as timeoutDriverOffer } from "@/app/api/driver/orders/[orderId]/offer-timeout/route";
import { POST as arrivedRestaurant } from "@/app/api/driver/orders/[orderId]/arrived-restaurant/route";
import { POST as pickedUpOrder } from "@/app/api/driver/orders/[orderId]/picked-up/route";
import { POST as markOnTheWay } from "@/app/api/driver/orders/[orderId]/on-the-way/route";
import { POST as arrivedCustomer } from "@/app/api/driver/orders/[orderId]/arrived-customer/route";
import { POST as collectPayment } from "@/app/api/driver/orders/[orderId]/payment/route";
import { POST as saveProof } from "@/app/api/driver/orders/[orderId]/proof/route";
import { POST as deliverOrder } from "@/app/api/driver/orders/[orderId]/delivered/route";

type ApiError = Error & { status?: number; code?: string };

type SyncAction =
  | "accept"
  | "reject"
  | "offer_timeout"
  | "arrived_restaurant"
  | "picked_up"
  | "on_the_way"
  | "arrived_customer"
  | "payment"
  | "proof"
  | "delivered";

type SyncBody = {
  syncId?: string;
  action?: string;
  payload?: Record<string, unknown>;
};

const SYNC_ACTIONS = new Set<SyncAction>([
  "accept",
  "reject",
  "offer_timeout",
  "arrived_restaurant",
  "picked_up",
  "on_the_way",
  "arrived_customer",
  "payment",
  "proof",
  "delivered",
]);

function normalizeSyncAction(value: unknown): SyncAction | null {
  const action = String(value || "").trim().toLowerCase();
  return SYNC_ACTIONS.has(action as SyncAction) ? (action as SyncAction) : null;
}

function cloneHeaders(headers: Headers) {
  const next = new Headers();
  headers.forEach((value, key) => next.set(key, value));
  next.set("content-type", "application/json");
  return next;
}

function buildDelegatedRequest(req: Request, body: Record<string, unknown>) {
  return new Request(req.url, {
    method: "POST",
    headers: cloneHeaders(req.headers),
    body: JSON.stringify(body),
  });
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

    const body = await readJson<SyncBody>(req);
    const syncId = String(body.syncId || "").trim();
    const action = normalizeSyncAction(body.action);
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};

    if (!syncId) {
      return fail("VALIDATION_ERROR", "syncId is required.", 400);
    }
    if (!action) {
      return fail("VALIDATION_ERROR", "action is invalid.", 400);
    }

    const existingAudit = await DriverAudit.findOne({
      cityId: new mongoose.Types.ObjectId(String(city._id)),
      driverId: new mongoose.Types.ObjectId(String(driver._id)),
      orderId: new mongoose.Types.ObjectId(orderId),
      action: "SYNC_ACTION_APPLIED",
      "meta.syncId": syncId,
    })
      .select("_id meta")
      .lean<{ _id: mongoose.Types.ObjectId; meta?: Record<string, unknown> } | null>();

    if (existingAudit) {
      return ok({
        syncId,
        action,
        synced: true,
        idempotent: true,
        orderId,
      });
    }

    let response: Response;
    switch (action) {
      case "accept":
        response = await acceptDriverOrder(buildDelegatedRequest(req, {}), context);
        break;
      case "reject":
        response = await rejectDriverOrder(
          buildDelegatedRequest(req, {
            reason: payload.reason,
            note: payload.note,
          }),
          context
        );
        break;
      case "offer_timeout":
        response = await timeoutDriverOffer(buildDelegatedRequest(req, {}), context);
        break;
      case "arrived_restaurant":
        response = await arrivedRestaurant(buildDelegatedRequest(req, {}), context);
        break;
      case "picked_up":
        response = await pickedUpOrder(buildDelegatedRequest(req, {}), context);
        break;
      case "on_the_way":
        response = await markOnTheWay(buildDelegatedRequest(req, {}), context);
        break;
      case "arrived_customer":
        response = await arrivedCustomer(buildDelegatedRequest(req, {}), context);
        break;
      case "payment":
        response = await collectPayment(
          buildDelegatedRequest(req, {
            method: payload.method,
            provider: payload.provider,
            reference: payload.reference,
            note: payload.note,
          }),
          context
        );
        break;
      case "proof":
        response = await saveProof(
          buildDelegatedRequest(req, {
            note: payload.note,
            photoUrl: payload.photoUrl,
          }),
          context
        );
        break;
      case "delivered":
        response = await deliverOrder(
          buildDelegatedRequest(req, {
            deliveryOtp: payload.deliveryOtp,
            proofNote: payload.proofNote,
            photoUrl: payload.photoUrl,
            proof: payload.proof,
          }),
          context
        );
        break;
      default:
        return fail("VALIDATION_ERROR", "Unsupported sync action.", 400);
    }

    const payloadJson = await response.clone().json().catch(() => null);
    if (!response.ok || !payloadJson?.ok) {
      return response;
    }

    await DriverAudit.create({
      cityId: new mongoose.Types.ObjectId(String(city._id)),
      driverId: new mongoose.Types.ObjectId(String(driver._id)),
      orderId: new mongoose.Types.ObjectId(orderId),
      action: "SYNC_ACTION_APPLIED",
      meta: {
        syncId,
        action,
        syncedAt: new Date(),
      },
    });

    return ok({
      syncId,
      action,
      synced: true,
      idempotent: false,
      orderId,
      result: payloadJson.data ?? null,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not sync pending driver action.",
      err.status || 500
    );
  }
}
