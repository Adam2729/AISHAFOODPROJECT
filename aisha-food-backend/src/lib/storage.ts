import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type ApiError = Error & { status?: number; code?: string };

export type UploadType = "merchant_logo" | "product_image";

type SaveUploadInput = {
  businessId: string;
  file: File;
  uploadType: UploadType;
  requestUrl?: string;
};

const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

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

function normalizeBaseUrl(value: unknown) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function resolveUploadFolder(uploadType: UploadType) {
  return uploadType === "merchant_logo" ? "merchants" : "products";
}

function resolvePublicBaseUrl(requestUrl?: string) {
  const explicit = normalizeBaseUrl(process.env.PUBLIC_API_BASE_URL);
  if (explicit) return explicit;

  try {
    return new URL(String(requestUrl || "")).origin.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export function imageUploadsEnabled() {
  return String(process.env.IMAGE_UPLOADS_DISABLED || "").trim().toLowerCase() !== "true";
}

export function isAllowedImageMimeType(mimeType: unknown) {
  return ALLOWED_IMAGE_TYPES.has(String(mimeType || "").trim().toLowerCase());
}

export function getUploadPublicUrl(relativePath: string, requestUrl?: string) {
  const normalizedPath = String(relativePath || "").trim();
  if (!normalizedPath) return "";
  if (/^https?:\/\//i.test(normalizedPath)) return normalizedPath;

  const baseUrl = resolvePublicBaseUrl(requestUrl);
  if (!baseUrl) return normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
  return `${baseUrl}${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`;
}

export async function saveUploadedImage({
  businessId,
  file,
  uploadType,
  requestUrl,
}: SaveUploadInput) {
  if (!imageUploadsEnabled()) {
    throw apiError(
      503,
      "UPLOAD_UNAVAILABLE",
      "Image uploads are not enabled right now. Try again later."
    );
  }

  if (!file?.size) {
    throw apiError(400, "INVALID_IMAGE_FILE", "Uploaded image file is empty.");
  }
  if (file.size > UPLOAD_MAX_BYTES) {
    throw apiError(413, "IMAGE_TOO_LARGE", "Image must be 5MB or smaller.");
  }

  const mimeType = String(file.type || "").trim().toLowerCase();
  const extension = ALLOWED_IMAGE_TYPES.get(mimeType);
  if (!extension) {
    throw apiError(400, "INVALID_IMAGE_TYPE", "Image must be jpg, png, or webp.");
  }

  const businessSegment = cleanSegment(businessId) || "business";
  const folder = resolveUploadFolder(uploadType);
  const uploadDir = path.join(process.cwd(), "public", "uploads", folder, businessSegment);
  await mkdir(uploadDir, { recursive: true });

  const fileName = `${Date.now()}-${randomUUID().slice(0, 12)}.${extension}`;
  await writeFile(path.join(uploadDir, fileName), Buffer.from(await file.arrayBuffer()));

  const relativePath = `/uploads/${folder}/${businessSegment}/${fileName}`;

  return {
    relativePath,
    imageUrl: getUploadPublicUrl(relativePath, requestUrl),
    bytes: file.size,
    mimeType,
    storageFolder: folder,
  };
}
