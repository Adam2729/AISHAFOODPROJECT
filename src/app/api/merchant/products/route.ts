import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { Product } from "@/models/Product";

type ApiError = Error & { status?: number; code?: string };

type ProductBody = {
  name?: string;
  price?: number;
  category?: string;
  description?: string;
  imageUrl?: string;
  isAvailable?: boolean;
};

export async function GET(req: Request) {
  try {
    const session = requireMerchantSession(req);
    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);
    const products = await Product.find({ businessId: new mongoose.Types.ObjectId(session.businessId) })
      .sort({ createdAt: -1 })
      .lean();
    return ok({ products });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load products.", err.status || 500);
  }
}

export async function POST(req: Request) {
  try {
    const session = requireMerchantSession(req);
    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);
    const body = await readJson<ProductBody>(req);
    const name = String(body.name || "").trim();
    const price = Number(body.price);
    if (!name || !Number.isFinite(price) || price < 0) {
      return fail("VALIDATION_ERROR", "name and valid price are required.");
    }

    const created = await Product.create({
      businessId: new mongoose.Types.ObjectId(session.businessId),
      name,
      price,
      category: String(body.category || "").trim(),
      description: String(body.description || "").trim(),
      imageUrl: String(body.imageUrl || "").trim(),
      isAvailable: body.isAvailable !== false,
    });
    return ok({ product: created }, 201);
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not create product.", err.status || 500);
  }
}
