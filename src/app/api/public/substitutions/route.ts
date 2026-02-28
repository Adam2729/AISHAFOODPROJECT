import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { Business } from "@/models/Business";
import { Product } from "@/models/Product";

type ProductLean = {
  _id: mongoose.Types.ObjectId;
  name?: string;
  price?: number;
  imageUrl?: string;
  category?: string;
};

function toNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(req: Request) {
  try {
    await assertNotInMaintenance();
    const url = new URL(req.url);
    const businessId = String(url.searchParams.get("businessId") || "").trim();
    const productId = String(url.searchParams.get("productId") || "").trim();
    if (!mongoose.Types.ObjectId.isValid(businessId) || !mongoose.Types.ObjectId.isValid(productId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId or productId.", 400);
    }

    await dbConnect();
    const business = await Business.findById(new mongoose.Types.ObjectId(businessId))
      .select("type isActive")
      .lean();
    if (!business || !business.isActive) {
      return fail("NOT_FOUND", "Business not found.", 404);
    }
    if (String((business as { type?: string }).type || "") !== "colmado") {
      return fail("VALIDATION_ERROR", "Substitutions only available for colmado.", 400);
    }

    const original = await Product.findOne({
      _id: new mongoose.Types.ObjectId(productId),
      businessId: new mongoose.Types.ObjectId(businessId),
    })
      .select("name price category")
      .lean<ProductLean | null>();
    if (!original) {
      return fail("NOT_FOUND", "Product not found.", 404);
    }

    const originalPrice = Math.max(0, toNumber(original.price));
    const minPrice = Math.max(0, originalPrice * 0.75);
    const maxPrice = originalPrice * 1.25;
    const category = String(original.category || "").trim();

    const baseFilter: Record<string, unknown> = {
      businessId: new mongoose.Types.ObjectId(businessId),
      isAvailable: true,
      _id: { $ne: new mongoose.Types.ObjectId(productId) },
    };
    if (category) {
      baseFilter.category = category;
    }

    let alternatives = await Product.find({
      ...baseFilter,
      price: { $gte: minPrice, $lte: maxPrice },
    })
      .select("name price imageUrl category")
      .sort({ price: 1, name: 1 })
      .limit(6)
      .lean<ProductLean[]>();

    if (alternatives.length < 6) {
      const extra = await Product.find(baseFilter)
        .select("name price imageUrl category")
        .limit(24)
        .lean<ProductLean[]>();
      const existing = new Set(alternatives.map((row) => String(row._id)));
      const sortedExtra = extra
        .filter((row) => !existing.has(String(row._id)))
        .sort((a, b) => {
          const diffA = Math.abs(toNumber(a.price) - originalPrice);
          const diffB = Math.abs(toNumber(b.price) - originalPrice);
          if (diffA !== diffB) return diffA - diffB;
          return String(a.name || "").localeCompare(String(b.name || ""), "es");
        });
      alternatives = alternatives.concat(sortedExtra.slice(0, Math.max(0, 6 - alternatives.length)));
    }

    return ok({
      alternatives: alternatives.map((row) => ({
        productId: String(row._id),
        name: String(row.name || "Producto"),
        price: Math.max(0, toNumber(row.price)),
        imageUrl: String(row.imageUrl || ""),
        category: String(row.category || ""),
      })),
    });
  } catch {
    return fail("SERVER_ERROR", "Could not load substitutions.", 500);
  }
}
