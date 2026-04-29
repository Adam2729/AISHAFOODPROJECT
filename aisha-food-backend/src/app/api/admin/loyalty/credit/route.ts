import mongoose from "mongoose";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getOrCreateCustomerLoyalty } from "@/lib/customerLoyalty";
import { requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { dbConnect } from "@/lib/mongodb";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { CustomerLoyalty } from "@/models/CustomerLoyalty";
import { LoyaltyEvent } from "@/models/LoyaltyEvent";
import { PaymentEvent } from "@/models/PaymentEvent";
import { Wallet } from "@/models/Wallet";

type ApiError = Error & { status?: number; code?: string };

type ManualCreditBody = {
  phone?: string;
  points?: number;
  walletAmount?: number;
  reason?: string;
};

function normalizeReason(value: unknown) {
  return String(value || "").trim().slice(0, 280) || null;
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    await dbConnect();

    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity(selectedCity);

    const body = await readJson<ManualCreditBody>(req);
    const phone = normalizePhone(String(body.phone || ""));
    const points = Math.max(0, Number(body.points || 0));
    const walletAmount = Math.max(0, Number(body.walletAmount || 0));
    const reason = normalizeReason(body.reason);

    if (!phone) {
      return fail("VALIDATION_ERROR", "Valid phone is required.", 400);
    }
    if (points <= 0 && walletAmount <= 0) {
      return fail("VALIDATION_ERROR", "points or walletAmount must be greater than zero.", 400);
    }

    const cityId = new mongoose.Types.ObjectId(String(selectedCity._id));
    const phoneHash = phoneToHash(phone);
    const loyalty = await getOrCreateCustomerLoyalty({ cityId, phoneHash });

    await Promise.all([
      CustomerLoyalty.updateOne(
        { _id: loyalty._id, cityId, phoneHash },
        {
          $inc: { points },
          $set: { isActive: true },
        }
      ),
      walletAmount > 0
        ? Wallet.findOneAndUpdate(
            {
              phoneHash,
              cityId,
            },
            {
              $setOnInsert: {
                phoneHash,
                cityId,
                currency: selectedCity.currency,
                isActive: true,
              },
              $inc: { balance: walletAmount },
            },
            { upsert: true, returnDocument: "after" }
          )
        : Promise.resolve(),
    ]);

    if (walletAmount > 0) {
      await PaymentEvent.create({
        orderId: null,
        cityId,
        method: "wallet",
        status: "authorized",
        amount: walletAmount,
        provider: "loyalty_manual_credit",
        reference: `loyalty:${phoneHash.slice(0, 12)}`,
        notes: reason,
        createdBy: "admin",
      });
    }

    await LoyaltyEvent.create({
      cityId,
      phoneHash,
      eventType: "manual_credit",
      points,
      walletAmount,
      orderId: null,
      referralId: null,
      notes: reason,
    });

    const wallet = await Wallet.findOne({ phoneHash, cityId })
      .select("balance")
      .lean<{ balance?: number | null } | null>();
    const refreshed = await CustomerLoyalty.findById(loyalty._id)
      .select("points lifetimeOrders lifetimeSpend referralCode")
      .lean<{
        points?: number | null;
        lifetimeOrders?: number | null;
        lifetimeSpend?: number | null;
        referralCode?: string | null;
      } | null>();

    return ok({
      cityId: String(selectedCity._id),
      phoneHash,
      loyalty: {
        points: Number(refreshed?.points || 0),
        lifetimeOrders: Number(refreshed?.lifetimeOrders || 0),
        lifetimeSpend: Number(refreshed?.lifetimeSpend || 0),
        referralCode: String(refreshed?.referralCode || "").trim() || null,
      },
      walletBalance: Number(wallet?.balance || 0),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not credit loyalty.",
      err.status || 500
    );
  }
}
