/* eslint-disable @typescript-eslint/no-explicit-any */
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";

export async function GET(req: Request) {
  try {
    const orderNumber = new URL(req.url).searchParams.get("orderNumber")?.trim() || "";
    if (!orderNumber) return fail("VALIDATION_ERROR", "orderNumber is required.");

    await dbConnect();
    const order = await Order.findOne({ orderNumber }).lean();
    if (!order) return fail("NOT_FOUND", "Order not found.", 404);
    const business = await Business.findById((order as any).businessId).select("name whatsapp phone").lean();
    const contact = {
      whatsapp: String((business as any)?.whatsapp || ""),
      phone: String((business as any)?.phone || ""),
      businessName: String((business as any)?.name || (order as any).businessName || ""),
    };

    return ok({
      order: {
        orderNumber: (order as any).orderNumber,
        status: (order as any).status,
        paymentStatus: (order as any).payment?.status || (order as any).paymentStatus || "unpaid",
        total: (order as any).total,
        businessName: (order as any).businessName,
        createdAt: (order as any).createdAt,
        contact,
      },
      contact,
    });
  } catch {
    return fail("SERVER_ERROR", "Could not track order.", 500);
  }
}
