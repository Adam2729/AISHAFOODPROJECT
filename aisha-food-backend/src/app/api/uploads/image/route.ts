import { dbConnect } from "@/lib/mongodb";
import { fail, ok } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { isUploadFile } from "@/lib/productImageUpload";
import { saveUploadedImage, type UploadType } from "@/lib/storage";

type ApiError = Error & { status?: number; code?: string };

export const runtime = "nodejs";

const UPLOAD_TYPES = new Set<UploadType>(["merchant_logo", "product_image"]);

export async function POST(req: Request) {
  try {
    const session = requireMerchantSession(req);
    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);

    const form = await req.formData();
    const uploadType = String(form.get("type") || "").trim() as UploadType;
    if (!UPLOAD_TYPES.has(uploadType)) {
      return fail("VALIDATION_ERROR", "Invalid upload type.", 400);
    }

    const fileValue = form.get("image") || form.get("file") || form.get("imageFile");
    if (!isUploadFile(fileValue) || fileValue.size < 1) {
      return fail("VALIDATION_ERROR", "Image file is required.", 400);
    }

    const uploaded = await saveUploadedImage({
      businessId: session.businessId,
      file: fileValue,
      uploadType,
      requestUrl: req.url,
    });

    return ok(
      {
        success: true,
        imageUrl: uploaded.imageUrl,
        relativePath: uploaded.relativePath,
      },
      201
    );
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not upload image.", err.status || 500);
  }
}
