import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireAdminKey } from "@/lib/adminAuth";
import { MerchantApplication } from "@/models/MerchantApplication";

type ApiError = Error & { status?: number; code?: string };

type QueryParams = {
  cityId?: string | null;
  status?: string | null;
  q?: string | null;
  limit?: string | null;
  cursor?: string | null;
};

function parseCursor(raw: string | null) {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as { createdAt?: string; _id?: string };
    if (!parsed.createdAt || !parsed._id) return null;
    return {
      createdAt: new Date(parsed.createdAt),
      _id: new mongoose.Types.ObjectId(String(parsed._id)),
    };
  } catch {
    return null;
  }
}

function buildCursor(doc: { createdAt?: Date; _id: mongoose.Types.ObjectId }) {
  return Buffer.from(
    JSON.stringify({
      createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
      _id: String(doc._id),
    })
  ).toString("base64");
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const url = new URL(req.url);
    const params: QueryParams = {
      cityId: url.searchParams.get("cityId"),
      status: url.searchParams.get("status"),
      q: url.searchParams.get("q"),
      limit: url.searchParams.get("limit"),
      cursor: url.searchParams.get("cursor"),
    };

    const filter: Record<string, unknown> = {};
    if (params.cityId && mongoose.Types.ObjectId.isValid(String(params.cityId))) {
      filter.cityId = new mongoose.Types.ObjectId(String(params.cityId));
    }
    if (params.status && ["pending", "needs_info", "approved", "rejected"].includes(params.status)) {
      filter.status = params.status;
    }
    if (params.q) {
      const regex = new RegExp(String(params.q).trim(), "i");
      filter.$or = [
        { businessName: regex },
        { ownerName: regex },
        { phone: regex },
        { email: regex },
        { whatsapp: regex },
      ];
    }

    const limit = Math.max(1, Math.min(200, Number(params.limit || 50)));
    const cursor = parseCursor(params.cursor || null);
    const andClauses: Record<string, unknown>[] = [];
    if (filter.$or) {
      andClauses.push({ $or: filter.$or });
      delete filter.$or;
    }
    if (cursor) {
      andClauses.push({
        $or: [
          { createdAt: { $lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
        ],
      });
    }
    const query = { ...filter, ...(andClauses.length ? { $and: andClauses } : {}) };

    const rows = await MerchantApplication.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean<{
        _id: mongoose.Types.ObjectId;
        cityId: mongoose.Types.ObjectId;
        businessName: string;
        ownerName: string;
        phone: string;
        email?: string;
        merchantType?: string;
        deliveryType?: string;
        deliveryModePreference?: string;
        area?: string;
        address?: string;
        cuisineType?: string;
        storeCategory?: string;
        payoutMethod?: string;
        logoUrl?: string;
        coverImageUrl?: string;
        notes?: string;
        whatsapp?: string;
        status: string;
        createdAt?: Date;
        approvedAt?: Date;
        rejectedAt?: Date;
        createdBusinessId?: mongoose.Types.ObjectId | null;
      }[]>();

    let nextCursor: string | undefined;
    if (rows.length > limit) {
      const last = rows[limit - 1];
      nextCursor = buildCursor(last);
      rows.splice(limit);
    }

    return ok({
      rows: rows.map((row) => ({
        _id: String(row._id),
        cityId: String(row.cityId),
        businessName: row.businessName,
        ownerName: row.ownerName,
        phone: row.phone,
        email: String(row.email || ""),
        whatsapp: String(row.whatsapp || ""),
        merchantType: String(row.merchantType || "restaurant"),
        deliveryType: String(row.deliveryType || "own_driver"),
        deliveryModePreference: String(row.deliveryModePreference || ""),
        area: String(row.area || ""),
        address: String(row.address || ""),
        cuisineType: String(row.cuisineType || ""),
        storeCategory: String(row.storeCategory || ""),
        payoutMethod: String(row.payoutMethod || ""),
        logoUrl: String(row.logoUrl || ""),
        coverImageUrl: String(row.coverImageUrl || ""),
        notes: String(row.notes || ""),
        status: row.status,
        createdAt: row.createdAt || null,
        approvedAt: row.approvedAt || null,
        rejectedAt: row.rejectedAt || null,
        createdBusinessId: row.createdBusinessId ? String(row.createdBusinessId) : null,
      })),
      nextCursor,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not list merchant applications.", err.status || 500);
  }
}
