import { fail, ok, readJson } from "@/lib/apiResponse";
import { dbConnect } from "@/lib/mongodb";
import { AccountDeletionRequest } from "@/models/AccountDeletionRequest";

type ApiError = Error & { status?: number; code?: string };

type DeleteRequestBody = {
  name?: string;
  email_or_phone?: string;
  accountType?: string;
  reason?: string;
};

const ACCOUNT_TYPES = new Set(["customer", "driver", "merchant"]);

function normalizeBody(body: DeleteRequestBody) {
  return {
    name: String(body?.name || "").trim(),
    email_or_phone: String(body?.email_or_phone || "").trim(),
    accountType: String(body?.accountType || "").trim().toLowerCase(),
    reason: String(body?.reason || "").trim(),
  };
}

export async function POST(req: Request) {
  try {
    const body = normalizeBody(await readJson<DeleteRequestBody>(req));

    if (!body.name) {
      return fail("VALIDATION_ERROR", "Name is required.", 400);
    }
    if (!body.email_or_phone) {
      return fail("VALIDATION_ERROR", "Email or phone is required.", 400);
    }
    if (!ACCOUNT_TYPES.has(body.accountType)) {
      return fail("VALIDATION_ERROR", "accountType is invalid.", 400);
    }

    await dbConnect();

    const created = await AccountDeletionRequest.create({
      name: body.name,
      email_or_phone: body.email_or_phone,
      accountType: body.accountType,
      reason: body.reason,
      status: "pending",
    });

    return ok(
      {
        request: {
          id: String(created._id),
          status: String(created.status || "pending"),
          createdAt: created.createdAt || null,
        },
        message: "Account deletion request received.",
      },
      201
    );
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not create account deletion request.",
      err.status || 500
    );
  }
}
