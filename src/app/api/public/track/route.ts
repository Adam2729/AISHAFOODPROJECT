/* eslint-disable @typescript-eslint/no-explicit-any */
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { Order } from "@/models/Order";

export async function GET(req: Request) {
  try {
    const orderNumber = new URL(req.url).searchParams.get("orderNumber")?.trim() || "";
    if (!orderNumber) return fail("VALIDATION_ERROR", "orderNumber is required.");

    await dbConnect();
    const order = await Order.findOne({ orderNumber }).lean();
    if (!order) return fail("NOT_FOUND", "Order not found.", 404);

    return ok({
      order: {
        orderNumber: (order as any).orderNumber,
        status: (order as any).status,
        paymentStatus: (order as any).payment?.status || (order as any).paymentStatus || "unpaid",
        total: (order as any).total,
        businessName: (order as any).businessName,
        createdAt: (order as any).createdAt,
      },
    });
  } catch {
    return fail("SERVER_ERROR", "Could not track order.", 500);
  }
}
