/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { Business } from "@/models/Business";
import { Product } from "@/models/Product";
import { computeSubscriptionStatus } from "@/lib/subscription";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ businessId: string }> }
) {
  try {
    const { businessId } = await params;
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("INVALID_BUSINESS_ID", "Invalid businessId.");
    }

    await dbConnect();
    const business = await Business.findById(businessId).lean();
    if (!business || !business.isActive) {
      return fail("NOT_FOUND", "Business not found.", 404);
    }
    const subscription = computeSubscriptionStatus((business as any).subscription || {});
    if (subscription.status === "suspended") {
      return fail("BUSINESS_SUSPENDED", "Business is not available right now.", 403);
    }

    const products = await Product.find({ businessId, isAvailable: true })
      .sort({ category: 1, name: 1 })
      .lean();

    return ok({
      business: {
        id: String((business as any)._id),
        name: (business as any).name,
        type: (business as any).type,
        address: (business as any).address,
        phone: (business as any).phone,
        logoUrl: (business as any).logoUrl || "",
      },
      products: products.map((p: any) => ({
        id: String(p._id),
        name: p.name,
        category: p.category,
        description: p.description,
        price: p.price,
        imageUrl: p.imageUrl,
        isAvailable: p.isAvailable,
      })),
    });
  } catch {
    return fail("SERVER_ERROR", "Could not load menu.", 500);
  }
}
