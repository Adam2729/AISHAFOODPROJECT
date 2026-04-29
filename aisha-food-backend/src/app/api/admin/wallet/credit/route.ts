import mongoose from "mongoose";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { dbConnect } from "@/lib/mongodb";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { PaymentEvent } from "@/models/PaymentEvent";
import { Wallet } from "@/models/Wallet";

type ApiError = Error & { status?: number; code?: string };

type CreditWalletBody = {
  phone?: string;
  amount?: number;
  reason?: string;
};

function normalizeString(value: unknown, maxLength = 280) {
  return String(value || "").trim().slice(0, maxLength);
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    await dbConnect();
    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity(selectedCity);

    const body = await readJson<CreditWalletBody>(req);
    const phone = normalizePhone(String(body.phone || ""));
    const amount = Number(body.amount || 0);
    const reason = normalizeString(body.reason, 280) || null;

    if (!phone) {
      return fail("VALIDATION_ERROR", "Valid phone is required.", 400);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return fail("VALIDATION_ERROR", "amount must be greater than zero.", 400);
    }

    const cityObjectId = new mongoose.Types.ObjectId(String(selectedCity._id));
    const phoneHash = phoneToHash(phone);
    const existing = await Wallet.findOne({
      phoneHash,
      cityId: cityObjectId,
    })
      .select("_id balance currency")
      .lean<{ _id: mongoose.Types.ObjectId; balance?: number | null; currency?: string | null } | null>();

    const wallet = await Wallet.findOneAndUpdate(
      {
        phoneHash,
        cityId: cityObjectId,
      },
      {
        $setOnInsert: {
          phoneHash,
          cityId: cityObjectId,
          currency: selectedCity.currency,
          isActive: true,
        },
        $inc: {
          balance: amount,
        },
      },
      {
        upsert: true,
        returnDocument: "after",
      }
    ).lean<{
      _id: mongoose.Types.ObjectId;
      balance?: number | null;
      currency?: string | null;
    } | null>();

    try {
      await PaymentEvent.create({
        orderId: null,
        cityId: cityObjectId,
        method: "wallet",
        status: "authorized",
        amount,
        provider: "wallet_admin_credit",
        reference: `wallet:${phoneHash.slice(0, 12)}`,
        notes: reason,
        createdBy: "admin",
      });
    } catch (paymentEventError) {
      await Wallet.updateOne(
        {
          phoneHash,
          cityId: cityObjectId,
        },
        {
          $setOnInsert: {
            currency: existing?.currency || selectedCity.currency,
            isActive: true,
          },
          $inc: {
            balance: -amount,
          },
        },
        {
          upsert: true,
        }
      ).catch(() => null);
      throw paymentEventError;
    }

    return ok({
      wallet: {
        phoneHash,
        cityId: String(selectedCity._id),
        balance: Number(wallet?.balance || 0),
        currency: String(wallet?.currency || selectedCity.currency || ""),
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not credit wallet.",
      err.status || 500
    );
  }
}
