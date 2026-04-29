import mongoose from "mongoose";
import { type CityLean, requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import {
  DISPATCH_ASSIGNABLE_STATUSES,
  isDispatchAssignableStatus,
  type DispatchAssignableStatus,
} from "@/lib/dispatch";
import { resolveOperationalOrderDeliveryMode } from "@/lib/deliveryPolicy";
import { dbConnect } from "@/lib/mongodb";
import { isFinalStatus, isOrderStatus } from "@/lib/orderStatus";
import { City } from "@/models/City";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type DispatchQueueAggregateRow = {
  _id: mongoose.Types.ObjectId;
  orderNumber?: string;
  businessId?: mongoose.Types.ObjectId | null;
  businessName?: string;
  customerName?: string;
  phone?: string | null;
  address?: string;
  status?: DispatchAssignableStatus;
  createdAt?: Date | null;
  deliveryFeeToCustomer?: number;
  total?: number;
  dispatch?: {
    assignedDriverId?: mongoose.Types.ObjectId | null;
    assignedDriverName?: string | null;
    assignedAt?: Date | null;
    driverDispatchStatus?: string | null;
    currentOfferDriverId?: mongoose.Types.ObjectId | null;
    offerExpiresAt?: Date | null;
  };
  deliverySnapshot?: {
    mode?: string | null;
  };
  merchantDelivery?: {
    assignedAt?: Date | null;
    riderName?: string | null;
    riderPhone?: string | null;
  };
  business?: {
    deliveryType?: string | null;
  }[];
};

type DispatchQueueAggregateResult = {
  rows: DispatchQueueAggregateRow[];
  total: Array<{ count?: number }>;
};

export type DispatchStatusFilter = DispatchAssignableStatus | "all";

export type DispatchQueueRow = {
  orderId: string;
  orderNumber: string;
  businessId: string | null;
  businessName: string;
  customerName: string;
  phone: string | null;
  address: string;
  status: DispatchAssignableStatus;
  createdAt: Date | null;
  deliveryFeeToCustomer: number;
  total: number;
  assignedDriverId: string | null;
  assignedDriverName: string | null;
  assignedAt: Date | null;
  driverDispatchStatus: string | null;
  currentOfferDriverId: string | null;
  offerExpiresAt: Date | null;
};

function createApiError(code: string, message: string, status: number): ApiError {
  const error = new Error(message) as ApiError;
  error.code = code;
  error.status = status;
  return error;
}

export function parseDispatchStatusFilter(value: unknown): DispatchStatusFilter {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "all") return "all";
  if (isDispatchAssignableStatus(normalized)) return normalized;
  throw createApiError(
    "VALIDATION_ERROR",
    "status must be one of accepted, preparing, ready, out_for_delivery, or all.",
    400
  );
}

export function parseIntegerParam(
  value: unknown,
  options: { defaultValue: number; min: number; max: number; label: string }
) {
  const raw = String(value ?? "").trim();
  if (!raw) return options.defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < options.min || parsed > options.max) {
    throw createApiError(
      "VALIDATION_ERROR",
      `${options.label} must be an integer between ${options.min} and ${options.max}.`,
      400
    );
  }
  return parsed;
}

export function sanitizeDispatchNote(value: unknown, max = 200) {
  return String(value || "").trim().slice(0, max);
}

export function sameObjectId(left: unknown, right: unknown) {
  if (!left || !right) return false;
  return String(left) === String(right);
}

export function ensureDispatchableOrderStatus(statusInput: unknown): DispatchAssignableStatus {
  const status = String(statusInput || "").trim();
  if (isDispatchAssignableStatus(status)) return status;
  if (isOrderStatus(status) && isFinalStatus(status)) {
    throw createApiError("INVALID_STATE", "Delivered or cancelled orders cannot be assigned.", 409);
  }
  throw createApiError(
    "INVALID_STATE",
    "Only accepted, preparing, ready, or out_for_delivery orders are dispatchable.",
    409
  );
}

export function ensurePlatformDispatchOrder(
  order: {
    deliverySnapshot?: { mode?: string | null } | null;
    dispatch?: { assignedDriverId?: unknown } | null;
    merchantDelivery?: {
      assignedAt?: unknown;
      riderName?: string | null;
      riderPhone?: string | null;
    } | null;
  },
  business?: { deliveryType?: string | null } | null
) {
  const mode = resolveOperationalOrderDeliveryMode(order, business);
  if (mode !== "platform_driver") {
    throw createApiError(
      "INVALID_DELIVERY_MODEL",
      "Order is configured for merchant-managed delivery and cannot use platform dispatch.",
      409
    );
  }
}

export async function resolveDispatchSelectedCity(req: Request, explicitCityId?: string | null) {
  const normalizedCityId = String(explicitCityId || "").trim();
  if (!normalizedCityId) {
    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity(selectedCity);
    return selectedCity;
  }

  if (!mongoose.Types.ObjectId.isValid(normalizedCityId)) {
    throw createApiError("VALIDATION_ERROR", "Valid cityId is required.", 400);
  }

  await dbConnect();
  const selectedCity = await City.findById(new mongoose.Types.ObjectId(normalizedCityId)).lean<CityLean | null>();
  if (!selectedCity) {
    throw createApiError("NOT_FOUND", "City not found.", 404);
  }
  requireActiveCity(selectedCity);
  return selectedCity;
}

export async function fetchDispatchQueue(input: {
  cityId: mongoose.Types.ObjectId | string;
  statusFilter: DispatchStatusFilter;
  assigned: boolean;
  limit: number;
  skip: number;
}) {
  await dbConnect();
  const cityObjectId =
    input.cityId instanceof mongoose.Types.ObjectId
      ? input.cityId
      : new mongoose.Types.ObjectId(String(input.cityId));
  const statuses =
    input.statusFilter === "all" ? [...DISPATCH_ASSIGNABLE_STATUSES] : [input.statusFilter];

  const assignmentMatch = input.assigned ? { $ne: null, $exists: true } : null;

  const [result] = await Order.aggregate<DispatchQueueAggregateResult>([
    {
      $match: {
        cityId: cityObjectId,
        status: { $in: statuses },
        "dispatch.assignedDriverId": assignmentMatch,
      },
    },
    {
      $lookup: {
        from: "businesses",
        localField: "businessId",
        foreignField: "_id",
        as: "business",
      },
    },
    {
      $addFields: {
        _businessDeliveryType: {
          $ifNull: [{ $first: "$business.deliveryType" }, "own_driver"],
        },
        _hasMerchantDeliveryAssignment: {
          $or: [
            { $ne: ["$merchantDelivery.assignedAt", null] },
            {
              $gt: [
                {
                  $strLenCP: {
                    $trim: {
                      input: { $ifNull: ["$merchantDelivery.riderName", ""] },
                    },
                  },
                },
                0,
              ],
            },
            {
              $gt: [
                {
                  $strLenCP: {
                    $trim: {
                      input: { $ifNull: ["$merchantDelivery.riderPhone", ""] },
                    },
                  },
                },
                0,
              ],
            },
          ],
        },
      },
    },
    {
      $addFields: {
        _dispatchManaged: {
          $cond: [
            { $ne: ["$dispatch.assignedDriverId", null] },
            true,
            {
              $cond: [
                "$_hasMerchantDeliveryAssignment",
                false,
                {
                  $or: [
                    { $eq: ["$deliverySnapshot.mode", "platform_driver"] },
                    { $eq: ["$_businessDeliveryType", "platform_driver"] },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
    {
      $match: {
        _dispatchManaged: true,
      },
    },
    {
      $addFields: {
        _dispatchPriority: {
          $cond: [{ $eq: ["$status", "ready"] }, 0, 1],
        },
      },
    },
    {
      $facet: {
        rows: [
          {
            $sort: {
              _dispatchPriority: 1,
              createdAt: 1,
            },
          },
          { $skip: input.skip },
          { $limit: input.limit },
          {
            $project: {
              orderNumber: 1,
              businessId: 1,
              businessName: 1,
              customerName: 1,
              phone: 1,
              address: 1,
              status: 1,
              createdAt: 1,
              deliveryFeeToCustomer: 1,
              total: 1,
              dispatch: {
                assignedDriverId: "$dispatch.assignedDriverId",
                assignedDriverName: "$dispatch.assignedDriverName",
                assignedAt: "$dispatch.assignedAt",
                driverDispatchStatus: "$dispatch.driverDispatchStatus",
                currentOfferDriverId: "$dispatch.currentOfferDriverId",
                offerExpiresAt: "$dispatch.offerExpiresAt",
              },
            },
          },
        ],
        total: [{ $count: "count" }],
      },
    },
  ]);

  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const total = Number(result?.total?.[0]?.count || 0);

  return {
    total,
    rows: rows.map((row) => ({
      orderId: String(row._id),
      orderNumber: String(row.orderNumber || ""),
      businessId: row.businessId ? String(row.businessId) : null,
      businessName: String(row.businessName || ""),
      customerName: String(row.customerName || ""),
      phone: row.phone ? String(row.phone) : null,
      address: String(row.address || ""),
      status: ensureDispatchableOrderStatus(row.status),
      createdAt: row.createdAt || null,
      deliveryFeeToCustomer: Number(row.deliveryFeeToCustomer || 0),
      total: Number(row.total || 0),
      assignedDriverId: row.dispatch?.assignedDriverId ? String(row.dispatch.assignedDriverId) : null,
      assignedDriverName: String(row.dispatch?.assignedDriverName || "").trim() || null,
      assignedAt: row.dispatch?.assignedAt || null,
      driverDispatchStatus: String(row.dispatch?.driverDispatchStatus || "").trim() || null,
      currentOfferDriverId: row.dispatch?.currentOfferDriverId
        ? String(row.dispatch.currentOfferDriverId)
        : null,
      offerExpiresAt: row.dispatch?.offerExpiresAt || null,
    })),
  };
}

export function serializeDispatchMeta(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Date) return value;
  if (value instanceof mongoose.Types.ObjectId) return String(value);
  if (Array.isArray(value)) return value.map((item) => serializeDispatchMeta(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        serializeDispatchMeta(nested),
      ])
    );
  }
  return value;
}
