import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import {
  normalizeProductCategory,
  normalizeProductSizeInput,
} from "@/lib/productCatalog";
import {
  cleanProductImageUrl,
  isUploadFile,
  saveUploadedProductImage,
} from "@/lib/productImageUpload";
import { Product } from "@/models/Product";

type ApiError = Error & { status?: number; code?: string };

type PatchBody = {
  name?: string;
  price?: number;
  category?: string;
  description?: string;
  imageUrl?: string;
  imageFile?: File | null;
  removeImage?: boolean;
  isAvailable?: boolean;
  unavailableReason?: "out_of_stock" | "busy" | "closed" | null;
  hasImageUrl?: boolean;
  quantityValue?: number | string;
  quantityUnit?: string;
  displaySize?: string;
};

function parseBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return fallback;
  return ["true", "1", "yes", "on"].includes(text);
}

function textField(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

async function readPatchBody(req: Request): Promise<PatchBody> {
  const contentType = String(req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("multipart/form-data")) {
    return readJson<PatchBody>(req);
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
    hasImageUrl: form.has("imageUrl"),
    imageFile: isUploadFile(imageFileValue) && imageFileValue.size > 0 ? imageFileValue : null,
    removeImage: parseBoolean(textField(form, "removeImage"), false),
    isAvailable: form.has("isAvailable") ? parseBoolean(textField(form, "isAvailable"), true) : undefined,
    unavailableReason: (textField(form, "unavailableReason") || null) as PatchBody["unavailableReason"],
    quantityValue: textField(form, "quantityValue"),
    quantityUnit: textField(form, "quantityUnit"),
    displaySize: textField(form, "displaySize"),
  };
}

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

    const body = await readPatchBody(req);
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = String(body.name || "").trim();
      if (!name) return fail("VALIDATION_ERROR", "Product name is required.");
      update.name = name;
    }
    if (body.price !== undefined) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price <= 0) {
        return fail("VALIDATION_ERROR", "Product price must be greater than zero.");
      }
      update.price = price;
    }
    if (body.category !== undefined) update.category = normalizeProductCategory(body.category);
    if (body.description !== undefined) update.description = String(body.description || "").trim();
    if (
      body.quantityValue !== undefined ||
      body.quantityUnit !== undefined ||
      body.displaySize !== undefined
    ) {
      const sizeInput = normalizeProductSizeInput({
        quantityValue: body.quantityValue,
        quantityUnit: body.quantityUnit,
        displaySize: body.displaySize,
      });
      if (!sizeInput.ok) return fail(sizeInput.code, sizeInput.message, 400);
      update.quantityValue = sizeInput.quantityValue;
      update.quantityUnit = sizeInput.quantityUnit;
      update.displaySize = sizeInput.displaySize;
    }
    if (body.isAvailable !== undefined) {
      const nextIsAvailable = Boolean(body.isAvailable);
      update.isAvailable = nextIsAvailable;
      update.unavailableUpdatedAt = new Date();
      update.unavailableReason = nextIsAvailable ? null : body.unavailableReason || "out_of_stock";
      update.stockHint = nextIsAvailable ? "in_stock" : "out";
    }

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);

    if (body.imageFile) {
      const uploadedImage = await saveUploadedProductImage({
        businessId: session.businessId,
        file: body.imageFile,
      });
      update.imageUrl = uploadedImage.imageUrl;
      update.imageSource = "upload";
      update.imageUpdatedAt = new Date();
    } else if (body.removeImage) {
      update.imageUrl = "";
      update.imageSource = null;
      update.imageUpdatedAt = new Date();
    } else if (body.imageUrl !== undefined || body.hasImageUrl) {
      const imageUrl = cleanProductImageUrl(body.imageUrl);
      update.imageUrl = imageUrl;
      update.imageSource = imageUrl ? "external" : null;
      update.imageUpdatedAt = new Date();
    }

    const product = await Product.findOneAndUpdate(
      { _id: productId, businessId: new mongoose.Types.ObjectId(session.businessId) },
      { $set: update },
      { returnDocument: "after" }
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
    const product = await Product.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(productId),
        businessId: new mongoose.Types.ObjectId(session.businessId),
      },
      {
        $set: {
          isArchived: true,
          archivedAt: new Date(),
          archivedReason: "merchant_archived",
          isAvailable: false,
          unavailableReason: "out_of_stock",
          unavailableUpdatedAt: new Date(),
          stockHint: "out",
        },
      },
      { returnDocument: "after" }
    ).lean();
    if (!product) return fail("NOT_FOUND", "Product not found.", 404);
    return ok({ deleted: true, archived: true, product });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not delete product.", err.status || 500);
  }
}
