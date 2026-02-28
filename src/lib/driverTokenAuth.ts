import mongoose from "mongoose";
import { verifyDriverLinkToken } from "@/lib/driverLink";
import { Driver } from "@/models/Driver";

type DriverLean = {
  _id: mongoose.Types.ObjectId;
  name: string;
  isActive: boolean;
  zoneLabel?: string;
};

type ApiError = Error & { status?: number; code?: string };

export async function requireDriverFromToken(req: Request): Promise<DriverLean> {
  const token = String(new URL(req.url).searchParams.get("token") || "").trim();
  if (!token) {
    const err = new Error("Driver token is required.") as ApiError;
    err.status = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }

  const payload = verifyDriverLinkToken(token);
  if (!payload || !mongoose.Types.ObjectId.isValid(payload.driverId)) {
    const err = new Error("Invalid or expired driver token.") as ApiError;
    err.status = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }

  const driver = await Driver.findById(payload.driverId)
    .select("_id name isActive zoneLabel")
    .lean<DriverLean | null>();
  if (!driver || !driver.isActive) {
    const err = new Error("Driver not available.") as ApiError;
    err.status = 403;
    err.code = "DRIVER_NOT_AVAILABLE";
    throw err;
  }
  return driver;
}
