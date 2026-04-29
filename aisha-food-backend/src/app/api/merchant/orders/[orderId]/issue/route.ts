import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { assertNotInMaintenance } from "@/lib/maintenance";
import {
  buildOrderEvent,
  getIssueSummary,
  isMerchantIssueType,
  type MerchantIssueType,
} from "@/lib/orderOperations";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type ReportIssueBody = {
  issueType?: string;
  note?: string;
};

type OrderLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  status?: string | null;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    await assertNotInMaintenance();

    const session = requireMerchantSession(req);
    const { orderId } = await params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Invalid orderId.", 400);
    }

    const body = await readJson<ReportIssueBody>(req);
    const issueTypeRaw = String(body.issueType || "").trim();
    const note = String(body.note || "").trim().slice(0, 280);
    if (!isMerchantIssueType(issueTypeRaw)) {
      return fail("VALIDATION_ERROR", "Valid issueType is required.", 400);
    }
    const issueType: MerchantIssueType = issueTypeRaw;

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);
    const businessObjectId = new mongoose.Types.ObjectId(session.businessId);
    const orderObjectId = new mongoose.Types.ObjectId(orderId);
    const order = await Order.findOne({
      _id: orderObjectId,
      businessId: businessObjectId,
    })
      .select("_id businessId status")
      .lean<OrderLean | null>();
    if (!order) return fail("NOT_FOUND", "Order not found.", 404);
    if (["delivered", "cancelled"].includes(String(order.status || "").trim())) {
      return fail("INVALID_STATE", "Issues can only be reported on active orders.", 409);
    }

    const summary = getIssueSummary({ issueType, note });
    const now = new Date();
    const updated = await Order.findOneAndUpdate(
      { _id: orderObjectId, businessId: businessObjectId },
      {
        $push: {
          merchantIssues: {
            $each: [
              {
                issueType,
                note,
                createdBy: "merchant",
                createdAt: now,
              },
            ],
            $slice: -20,
          },
          orderEvents: {
            $each: [
              buildOrderEvent({
                type: "issue_reported",
                label: "Issue reported",
                detail: summary.summary,
                actor: "merchant",
                createdAt: now,
              }),
            ],
            $slice: -40,
          },
        },
      },
      { returnDocument: "after" }
    ).lean();

    return ok({
      order: updated,
      latestIssue: {
        issueType,
        label: summary.issueLabel,
        note: note || null,
        createdAt: now,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not report order issue.",
      err.status || 500
    );
  }
}
