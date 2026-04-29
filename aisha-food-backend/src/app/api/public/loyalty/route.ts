import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { getOrCreateCustomerLoyalty } from "@/lib/customerLoyalty";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { Wallet } from "@/models/Wallet";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity(selectedCity);

    const url = new URL(req.url);
    const phone = normalizePhone(String(url.searchParams.get("phone") || ""));
    if (!phone) {
      return fail("VALIDATION_ERROR", "Valid phone is required.", 400);
    }

    const cityId = new mongoose.Types.ObjectId(String(selectedCity._id));
    const phoneHash = phoneToHash(phone);
    const loyalty = await getOrCreateCustomerLoyalty({ cityId, phoneHash });
    const wallet = await Wallet.findOneAndUpdate(
      {
        phoneHash,
        cityId,
      },
      {
        $setOnInsert: {
          phoneHash,
          cityId,
          balance: 0,
          currency: selectedCity.currency,
          isActive: true,
        },
      },
      {
        upsert: true,
        new: true,
      }
    ).lean<{ balance?: number | null } | null>();

    return ok({
      cityId: String(selectedCity._id),
      points: Number(loyalty.points || 0),
      lifetimeOrders: Number(loyalty.lifetimeOrders || 0),
      lifetimeSpend: Number(loyalty.lifetimeSpend || 0),
      referralCode: String(loyalty.referralCode || "").trim() || null,
      walletBalance: Number(wallet?.balance || 0),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load loyalty profile.",
      err.status || 500
    );
  }
}
