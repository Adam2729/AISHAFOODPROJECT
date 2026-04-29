import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  orderId?: string;
};

type CheckResult = {
  name: string;
  passed: boolean;
  status?: number;
  code?: string;
  message?: string;
};

async function runGuardCheck(
  orderId: mongoose.Types.ObjectId,
  update: Record<string, unknown>,
  expectedCode: string,
  name: string
): Promise<CheckResult> {
  try {
    await Order.findOneAndUpdate({ _id: orderId }, update, {
      returnDocument: "after",
    });
    return {
      name,
      passed: false,
    };
  } catch (error: unknown) {
    const err = error as ApiError & {
      cause?: { code?: string; status?: number; message?: string };
      reason?: { code?: string; status?: number; message?: string };
    };
    const status = Number(err.status || err.cause?.status || err.reason?.status || 0);
    const code = String(err.code || err.cause?.code || err.reason?.code || "");
    const message = String(err.message || err.cause?.message || err.reason?.message || "");
    const normalizedMessage = message.toLowerCase();
    const messageMatches =
      expectedCode === "IMMUTABLE_AFTER_DELIVERY"
        ? normalizedMessage.includes("immutable after delivery")
        : expectedCode === "COUNTED_FINAL"
          ? normalizedMessage.includes("cannot change status")
          : false;

    return {
      name,
      passed: (status === 409 && code === expectedCode) || messageMatches,
      status,
      code,
      message,
    };
  }
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const isVercelProd = String(process.env.VERCEL_ENV || "").trim() === "production";
    if (isVercelProd) {
      return fail("FORBIDDEN", "QA test route is disabled in production.", 403);
    }

    const body = await readJson<Body>(req);
    const orderIdRaw = String(body.orderId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(orderIdRaw)) {
      return fail("VALIDATION_ERROR", "Invalid orderId.", 400);
    }

    await dbConnect();
    const orderId = new mongoose.Types.ObjectId(orderIdRaw);
    const order = await Order.findById(orderId).select("_id status settlement.counted").lean();
    if (!order) {
      return fail("NOT_FOUND", "Order not found.", 404);
    }
    if (!(order.status === "delivered" || Boolean(order.settlement?.counted))) {
      return fail("INVALID_STATE", "Order must be delivered or counted for guard checks.", 400);
    }

    const checks = await Promise.all([
      runGuardCheck(
        orderId,
        { $set: { subtotal: 999999 } },
        "IMMUTABLE_AFTER_DELIVERY",
        "subtotal_immutable"
      ),
      runGuardCheck(
        orderId,
        { $set: { commissionAmount: 12345 } },
        "IMMUTABLE_AFTER_DELIVERY",
        "commission_immutable"
      ),
      runGuardCheck(
        orderId,
        { $set: { "items.0.unitPrice": 777 } },
        "IMMUTABLE_AFTER_DELIVERY",
        "items_immutable"
      ),
    ]);

    const passed = checks.every((check) => check.passed);
    if (!passed) {
      return fail("ASSERTION_FAILED", "One or more immutability checks failed.", 500, { checks });
    }

    return ok({
      passed: true,
      checks,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not run revenue integrity checks.",
      err.status || 500
    );
  }
}
