import mongoose from "mongoose";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { Business } from "@/models/Business";

export type MerchantAnalyticsRange = "7d" | "30d" | "90d";

type MerchantAnalyticsBusiness = {
  _id: mongoose.Types.ObjectId;
  name?: string;
  hours?: {
    timezone?: string | null;
  } | null;
};

export function parseMerchantAnalyticsRange(raw: string | null): MerchantAnalyticsRange {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "7d" || value === "30d" || value === "90d") return value;
  return "30d";
}

function rangeDays(range: MerchantAnalyticsRange) {
  if (range === "7d") return 7;
  if (range === "90d") return 90;
  return 30;
}

export function getMerchantAnalyticsWindow(
  range: MerchantAnalyticsRange,
  now = new Date()
) {
  const endDate = new Date(now);
  const startDate = new Date(now);
  startDate.setUTCHours(0, 0, 0, 0);
  startDate.setUTCDate(startDate.getUTCDate() - (rangeDays(range) - 1));
  return {
    days: rangeDays(range),
    startDate,
    endDate,
  };
}

function formatDatePart(
  date: Date,
  timezone: string,
  part: "year" | "month" | "day"
) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    [part]: "2-digit",
  });
  const matched = formatter
    .formatToParts(date)
    .find((item) => item.type === part);
  return matched?.value || "00";
}

export function formatDateKey(date: Date, timezone: string) {
  const yearFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
  });
  const year = yearFormatter
    .formatToParts(date)
    .find((item) => item.type === "year")?.value || "0000";
  const month = formatDatePart(date, timezone, "month");
  const day = formatDatePart(date, timezone, "day");
  return `${year}-${month}-${day}`;
}

export function buildFilledDateSeries(
  range: MerchantAnalyticsRange,
  timezone: string,
  rows: Array<{ date: string; revenue?: number; orders?: number }>,
  now = new Date()
) {
  const { days } = getMerchantAnalyticsWindow(range, now);
  const rowMap = new Map(rows.map((row) => [String(row.date || ""), row]));
  const output: Array<{ date: string; revenue: number; orders: number }> = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - offset);
    const key = formatDateKey(date, timezone);
    const row = rowMap.get(key);
    output.push({
      date: key,
      revenue: Number(row?.revenue || 0),
      orders: Number(row?.orders || 0),
    });
  }

  return output;
}

export function buildFilledHourSeries(rows: Array<{ hour: number; orders?: number }>) {
  const rowMap = new Map(rows.map((row) => [Number(row.hour), row]));
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    orders: Number(rowMap.get(hour)?.orders || 0),
  }));
}

export async function resolveMerchantAnalyticsContext(req: Request) {
  const session = requireMerchantSession(req);
  const url = new URL(req.url);
  const requestedBusinessId = String(url.searchParams.get("businessId") || "").trim();
  const businessId = requestedBusinessId || session.businessId;
  const range = parseMerchantAnalyticsRange(url.searchParams.get("range"));

  if (!mongoose.Types.ObjectId.isValid(session.businessId)) {
    const err = new Error("Invalid merchant session.") as Error & {
      status?: number;
      code?: string;
    };
    err.status = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }

  if (requestedBusinessId) {
    if (!mongoose.Types.ObjectId.isValid(requestedBusinessId)) {
      const err = new Error("Invalid businessId.") as Error & {
        status?: number;
        code?: string;
      };
      err.status = 400;
      err.code = "VALIDATION_ERROR";
      throw err;
    }
    if (String(requestedBusinessId) !== String(session.businessId)) {
      const err = new Error("Merchant cannot access another business.") as Error & {
        status?: number;
        code?: string;
      };
      err.status = 403;
      err.code = "BUSINESS_SCOPE_DENIED";
      throw err;
    }
  }

  await requireMerchantBusinessAvailable(session.businessId);
  const business = await Business.findById(session.businessId)
    .select("name hours.timezone")
    .lean<MerchantAnalyticsBusiness | null>();
  if (!business?._id) {
    const err = new Error("Business not found.") as Error & {
      status?: number;
      code?: string;
    };
    err.status = 404;
    err.code = "BUSINESS_NOT_FOUND";
    throw err;
  }

  const { startDate, endDate } = getMerchantAnalyticsWindow(range);
  return {
    businessId: new mongoose.Types.ObjectId(String(businessId)),
    business,
    range,
    startDate,
    endDate,
    timezone: String(business.hours?.timezone || "UTC"),
  };
}
