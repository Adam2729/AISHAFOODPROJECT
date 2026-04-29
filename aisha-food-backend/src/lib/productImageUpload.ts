import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type ApiError = Error & { status?: number; code?: string };

const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

function apiError(status: number, code: string, message: string): ApiError {
  const error = new Error(message) as ApiError;
  error.status = status;
  error.code = code;
  return error;
}

function cleanSegment(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function productImageUploadsEnabled() {
  return String(process.env.PRODUCT_IMAGE_UPLOADS_DISABLED || "").trim().toLowerCase() !== "true";
}

export function cleanProductImageUrl(value: unknown) {
  const imageUrl = String(value || "").trim();
  if (!imageUrl) return "";
  if (imageUrl.startsWith("/uploads/products/")) return imageUrl;

  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw apiError(400, "INVALID_IMAGE_URL", "Image URL must be a valid http or https URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw apiError(400, "INVALID_IMAGE_URL", "Image URL must use http or https.");
  }

  return parsed.toString();
}

export function isUploadFile(value: FormDataEntryValue | null): value is File {
  return Boolean(
    value &&
      typeof value === "object" &&
      "arrayBuffer" in value &&
      "size" in value &&
      "type" in value
  );
}

export async function saveUploadedProductImage(input: {
  businessId: string;
  file: File;
}) {
  if (!productImageUploadsEnabled()) {
    throw apiError(
      503,
      "UPLOAD_UNAVAILABLE",
      "Product image upload is not enabled. Use an image URL instead."
    );
  }

  const file = input.file;
  if (!file.size) {
    throw apiError(400, "INVALID_IMAGE_FILE", "Uploaded image file is empty.");
  }
  if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
    throw apiError(413, "IMAGE_TOO_LARGE", "Product image must be 5MB or smaller.");
  }

  const extension = ALLOWED_IMAGE_TYPES.get(String(file.type || "").toLowerCase());
  if (!extension) {
    throw apiError(400, "INVALID_IMAGE_TYPE", "Product image must be jpg, png, or webp.");
  }

  const businessSegment = cleanSegment(input.businessId) || "business";
  const uploadDir = path.join(process.cwd(), "public", "uploads", "products", businessSegment);
  await mkdir(uploadDir, { recursive: true });

  const fileName = `${Date.now()}-${randomUUID()}.${extension}`;
  await writeFile(path.join(uploadDir, fileName), Buffer.from(await file.arrayBuffer()));

  return {
    imageUrl: `/uploads/products/${businessSegment}/${fileName}`,
    imageSource: "upload" as const,
    bytes: file.size,
    mimeType: file.type,
  };
}
