import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import {
  buildCityScopedFilter,
  getDefaultCity,
  isBusinessWithinCityCoverage,
  isDefaultCity,
  requireActiveCity,
  resolveCityFromRequest,
} from "@/lib/city";
import { Business } from "@/models/Business";
import { Product } from "@/models/Product";

type ProductLean = {
  _id: mongoose.Types.ObjectId;
  name?: string;
  description?: string;
  price?: number;
  category?: string;
  imageUrl?: string;
  createdAt?: Date | string;
};

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function slugifyCategory(value: unknown) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return normalized || "otros";
}

function normalizeCategoryName(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "Otros";
  return text;
}

function computeTags(createdAt: unknown) {
  let raw: Date | null = null;
  if (createdAt instanceof Date) raw = new Date(createdAt.getTime());
  else if (typeof createdAt === "string" || typeof createdAt === "number") raw = new Date(createdAt);
  if (!raw || Number.isNaN(raw.getTime())) return [];
  const days = (Date.now() - raw.getTime()) / (1000 * 60 * 60 * 24);
  return days <= 14 ? ["new"] : [];
}

export async function GET(req: Request) {
  try {
    await assertNotInMaintenance();
    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity(selectedCity);
    const defaultCity = await getDefaultCity();
    const includeUnassigned = isDefaultCity(selectedCity, defaultCity._id);
    await dbConnect();

    const url = new URL(req.url);
    const businessId = String(url.searchParams.get("businessId") || "").trim();

    const businessFilter: Record<string, unknown> = {
      isActive: true,
      ...buildCityScopedFilter(selectedCity._id, { includeUnassigned }),
    };
    if (businessId) {
      if (!mongoose.Types.ObjectId.isValid(businessId)) {
        return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
      }
      businessFilter._id = new mongoose.Types.ObjectId(businessId);
    }

    const business = await Business.findOne(businessFilter)
      .select("_id name location")
      .sort({ "performance.score": -1, createdAt: -1 })
      .lean<{
        _id: mongoose.Types.ObjectId;
        name?: string;
        location?: { coordinates?: [number, number] };
      } | null>();

    if (!business) {
      return ok({
        data: {
          business: null,
          categories: [],
          items: [],
        },
      });
    }
    const bLng = Number(business.location?.coordinates?.[0]);
    const bLat = Number(business.location?.coordinates?.[1]);
    if (!Number.isFinite(bLat) || !Number.isFinite(bLng) || !isBusinessWithinCityCoverage(selectedCity, bLat, bLng)) {
      return ok({
        data: {
          business: null,
          categories: [],
          items: [],
        },
      });
    }

    const products = await Product.find({
      businessId: business._id,
      isAvailable: true,
    })
      .select("name description price category imageUrl createdAt")
      .sort({ category: 1, name: 1 })
      .lean<ProductLean[]>();

    const categoriesMap = new Map<string, { slug: string; name: string }>();
    const items = products.map((product, index) => {
      const categoryName = normalizeCategoryName(product.category);
      const categorySlug = slugifyCategory(categoryName);
      if (!categoriesMap.has(categorySlug)) {
        categoriesMap.set(categorySlug, {
          slug: categorySlug,
          name: categoryName,
        });
      }

      const tags = computeTags(product.createdAt);
      if (index < 3 && !tags.includes("featured")) {
        tags.push("featured");
      }

      return {
        _id: String(product._id),
        name: String(product.name || "Producto"),
        description: String(product.description || ""),
        price: toNumber(product.price, 0),
        categorySlug,
        imageUrl: String(product.imageUrl || ""),
        tags,
      };
    });

    return ok({
      data: {
        business: {
          id: String(business._id),
          name: String(business.name || "Aisha Food"),
        },
        categories: Array.from(categoriesMap.values()),
        items,
      },
    });
  } catch (error: unknown) {
    const err = error as Error & { status?: number; code?: string };
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load menu.", err.status || 500);
  }
}
