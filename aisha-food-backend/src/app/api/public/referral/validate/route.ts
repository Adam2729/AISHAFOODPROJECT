import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { findReferralOwnerByCode } from "@/lib/customerLoyalty";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";

type ApiError = Error & { status?: number; code?: string };

type ValidateReferralBody = {
  code?: string;
  phone?: string;
};

function normalizeReferralCode(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 24);
}

export async function POST(req: Request) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity(selectedCity);

    const body = await readJson<ValidateReferralBody>(req);
    const code = normalizeReferralCode(body.code);
    const phone = normalizePhone(String(body.phone || ""));

    if (!code) {
      return ok({
        valid: false,
        reason: "MISSING_CODE",
      });
    }
    if (!phone) {
      return ok({
        valid: false,
        reason: "MISSING_PHONE",
      });
    }

    const owner = await findReferralOwnerByCode({
      cityId: selectedCity._id,
      code,
    });
    if (!owner?.phoneHash) {
      return ok({
        valid: false,
        reason: "INVALID_CODE",
      });
    }
    if (owner.phoneHash === phoneToHash(phone)) {
      return ok({
        valid: false,
        reason: "SELF_REFERRAL",
      });
    }

    return ok({
      valid: true,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not validate referral code.",
      err.status || 500
    );
  }
}
