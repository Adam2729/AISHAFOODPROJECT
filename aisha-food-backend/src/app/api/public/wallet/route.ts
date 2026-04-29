import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { dbConnect } from "@/lib/mongodb";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { Wallet } from "@/models/Wallet";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    await dbConnect();
    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity(selectedCity);

    const url = new URL(req.url);
    const phone = normalizePhone(String(url.searchParams.get("phone") || ""));
    if (!phone) {
      return fail("VALIDATION_ERROR", "Valid phone is required.", 400);
    }

    const cityObjectId = new mongoose.Types.ObjectId(String(selectedCity._id));
    const phoneHash = phoneToHash(phone);
    const wallet = await Wallet.findOneAndUpdate(
      {
        phoneHash,
        cityId: cityObjectId,
      },
      {
        $setOnInsert: {
          phoneHash,
          cityId: cityObjectId,
          balance: 0,
          currency: selectedCity.currency,
          isActive: true,
        },
      },
      {
        upsert: true,
        new: true,
      }
    ).lean<{
      balance?: number | null;
      currency?: string | null;
    } | null>();

    return ok({
      cityId: String(selectedCity._id),
      balance: Number(wallet?.balance || 0),
      currency: String(wallet?.currency || selectedCity.currency || ""),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load wallet.",
      err.status || 500
    );
  }
}
