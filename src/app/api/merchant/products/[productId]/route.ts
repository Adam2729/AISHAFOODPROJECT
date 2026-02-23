import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { Product } from "@/models/Product";

type ApiError = Error & { status?: number; code?: string };

type PatchBody = {
  name?: string;
  price?: number;
  category?: string;
  description?: string;
  imageUrl?: string;
  isAvailable?: boolean;
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const session = requireMerchantSession(req);
    const { productId } = await params;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return fail("VALIDATION_ERROR", "Invalid productId.");
    }

    const body = await readJson<PatchBody>(req);
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update.name = String(body.name || "").trim();
    if (body.price !== undefined) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price < 0) return fail("VALIDATION_ERROR", "Invalid price.");
      update.price = price;
    }
    if (body.category !== undefined) update.category = String(body.category || "").trim();
    if (body.description !== undefined) update.description = String(body.description || "").trim();
    if (body.imageUrl !== undefined) update.imageUrl = String(body.imageUrl || "").trim();
    if (body.isAvailable !== undefined) update.isAvailable = Boolean(body.isAvailable);

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);
    const product = await Product.findOneAndUpdate(
      { _id: productId, businessId: new mongoose.Types.ObjectId(session.businessId) },
      { $set: update },
      { new: true }
    );
    if (!product) return fail("NOT_FOUND", "Product not found.", 404);
    return ok({ product });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not update product.", err.status || 500);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const session = requireMerchantSession(req);
    const { productId } = await params;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return fail("VALIDATION_ERROR", "Invalid productId.");
    }

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);
    const result = await Product.deleteOne({
      _id: productId,
      businessId: new mongoose.Types.ObjectId(session.businessId),
    });
    if (!result.deletedCount) return fail("NOT_FOUND", "Product not found.", 404);
    return ok({ deleted: true });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not delete product.", err.status || 500);
  }
}
