import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { getMarketConfig } from "@/lib/marketConfig";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import {
  normalizeProductCategory,
  normalizeProductSizeInput,
} from "@/lib/productCatalog";
import {
  cleanProductImageUrl,
  isUploadFile,
  productImageUploadsEnabled,
  saveUploadedProductImage,
} from "@/lib/productImageUpload";
import { Business } from "@/models/Business";
import { City } from "@/models/City";
import { Product } from "@/models/Product";
import { ProductCategory } from "@/models/ProductCategory";

type ApiError = Error & { status?: number; code?: string };

type ProductBody = {
  name?: string;
  price?: number;
  category?: string;
  description?: string;
  imageUrl?: string;
  imageFile?: File | null;
  isAvailable?: boolean;
  unavailableReason?: "out_of_stock" | "busy" | "closed" | null;
  quantityValue?: number | string;
  quantityUnit?: string;
  displaySize?: string;
};

type BusinessLean = {
  _id: mongoose.Types.ObjectId;
  name?: string;
  cityId?: mongoose.Types.ObjectId | null;
  hours?: {
    timezone?: string | null;
  } | null;
  type?: string;
  merchantType?: string;
  cuisineType?: string;
  storeCategory?: string;
};

function parseBoolean(value: unknown, fallback = true) {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return fallback;
  return ["true", "1", "yes", "on"].includes(text);
}

function textField(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

async function readProductBody(req: Request): Promise<ProductBody> {
  const contentType = String(req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("multipart/form-data")) {
    return readJson<ProductBody>(req);
  }

  const form = await req.formData();
  const imageFileValue =
    form.get("imageFile") || form.get("image") || form.get("file") || null;
  return {
    name: textField(form, "name"),
    price: Number(textField(form, "price")),
    category: textField(form, "category"),
    description: textField(form, "description"),
    imageUrl: textField(form, "imageUrl"),
    imageFile: isUploadFile(imageFileValue) && imageFileValue.size > 0 ? imageFileValue : null,
    isAvailable: parseBoolean(textField(form, "isAvailable"), true),
    unavailableReason: (textField(form, "unavailableReason") || null) as ProductBody["unavailableReason"],
    quantityValue: textField(form, "quantityValue"),
    quantityUnit: textField(form, "quantityUnit"),
    displaySize: textField(form, "displaySize"),
  };
}

type CityLean = {
  _id: mongoose.Types.ObjectId;
  code?: string;
  slug?: string;
  name?: string;
  country?: string;
  currency?: string;
  supportWhatsAppE164?: string;
  paymentMethods?: string[];
};

export async function GET(req: Request) {
  try {
    const session = requireMerchantSession(req);
    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);
    const businessId = new mongoose.Types.ObjectId(session.businessId);
    const [products, business] = await Promise.all([
      Product.find({ businessId, isArchived: { $ne: true } }).sort({ createdAt: -1 }).lean(),
      Business.findById(businessId)
        .select("name cityId type merchantType cuisineType storeCategory hours.timezone")
        .lean<BusinessLean | null>(),
    ]);

    if (!business) {
      return fail("NOT_FOUND", "Business not found.", 404);
    }

    const city =
      business.cityId && mongoose.Types.ObjectId.isValid(String(business.cityId))
        ? await City.findById(business.cityId)
            .select("code slug name country currency supportWhatsAppE164 paymentMethods")
            .lean<CityLean | null>()
        : null;
    const market = getMarketConfig(city);
    const storedCategories = await ProductCategory.find({
      businessId,
      isArchived: { $ne: true },
    })
      .sort({ name: 1 })
      .lean<Array<{ _id: mongoose.Types.ObjectId; name?: string; isArchived?: boolean }>>();
    const categoryNames = new Set(
      storedCategories.map((category) => normalizeProductCategory(category.name)).filter(Boolean)
    );
    for (const product of products as Array<{ category?: string; isArchived?: boolean }>) {
      if (product.isArchived) continue;
      const category = normalizeProductCategory(product.category);
      if (category) categoryNames.add(category);
    }

    return ok({
      products,
      categories: Array.from(categoryNames)
        .sort((a, b) => a.localeCompare(b, market.defaultLanguage === "fr" ? "fr" : "es"))
        .map((name) => {
          const stored = storedCategories.find(
            (category) => normalizeProductCategory(category.name) === name
          );
          return {
            id: stored ? String(stored._id) : "",
            name,
            isArchived: false,
            source: stored ? "stored" : "product",
          };
        }),
      business: {
        id: String(business._id),
        name: String(business.name || ""),
        type: String(business.type || "restaurant"),
        merchantType: String(business.merchantType || business.type || "restaurant"),
        cuisineType: String(business.cuisineType || ""),
        storeCategory: String(business.storeCategory || ""),
        cityId: city ? String(city._id) : null,
        cityCode: String(city?.code || ""),
        cityName: String(city?.name || ""),
        country: String(city?.country || market.countryName),
        marketCode: market.marketCode,
        defaultLanguage: market.defaultLanguage,
        currencyCode: market.currencyCode,
        currencyDisplay: market.currencyDisplay,
        supportWhatsApp: market.supportWhatsApp,
        paymentMethods: market.paymentMethods,
        timezone: String(business.hours?.timezone || market.defaultTimezone),
        productImageUploadsEnabled: productImageUploadsEnabled(),
      },
    });
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
    const body = await readProductBody(req);
    const name = String(body.name || "").trim();
    const category = normalizeProductCategory(body.category);
    const description = String(body.description || "").trim();
    const price = Number(body.price);
    if (!name) {
      return fail("VALIDATION_ERROR", "Product name is required.");
    }
    if (!Number.isFinite(price) || price <= 0) {
      return fail("VALIDATION_ERROR", "Product price must be greater than zero.");
    }
    const sizeInput = normalizeProductSizeInput({
      quantityValue: body.quantityValue,
      quantityUnit: body.quantityUnit,
      displaySize: body.displaySize,
    });
    if (!sizeInput.ok) {
      return fail(sizeInput.code, sizeInput.message, 400);
    }

    const uploadedImage = body.imageFile
      ? await saveUploadedProductImage({
          businessId: session.businessId,
          file: body.imageFile,
        })
      : null;
    const imageUrl = uploadedImage?.imageUrl || cleanProductImageUrl(body.imageUrl);
    const imageSource = uploadedImage ? "upload" : imageUrl ? "external" : null;

    const created = await Product.create({
      businessId: new mongoose.Types.ObjectId(session.businessId),
      name,
      price,
      category,
      description,
      quantityValue: sizeInput.quantityValue,
      quantityUnit: sizeInput.quantityUnit,
      displaySize: sizeInput.displaySize,
      imageUrl,
      imageSource,
      imageUpdatedAt: imageUrl ? new Date() : null,
      isAvailable: body.isAvailable !== false,
      unavailableReason: body.isAvailable === false ? body.unavailableReason || "out_of_stock" : null,
      unavailableUpdatedAt: new Date(),
      stockHint: body.isAvailable === false ? "out" : "in_stock",
    });
    return ok({ product: created }, 201);
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not create product.", err.status || 500);
  }
}
