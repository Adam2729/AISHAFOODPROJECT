import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { ENV_BASE_LOCATION, ENV_MAX_RADIUS_KM, ENV_NODE_ENV } from "@/lib/env";

type HealthEnv = "production" | "preview" | "development";

function detectEnv(): HealthEnv {
  const vercelEnv = String(process.env.VERCEL_ENV || "").toLowerCase();
  if (vercelEnv === "preview") return "preview";
  if (ENV_NODE_ENV === "production") return "production";
  return "development";
}

export async function GET() {
  try {
    await dbConnect();
    const dbName = mongoose.connection?.name || "unknown";

    return NextResponse.json({
      ok: true,
      env: detectEnv(),
      db: {
        connected: mongoose.connection?.readyState === 1,
        name: dbName,
      },
      baseLocation: {
        lat: ENV_BASE_LOCATION.lat,
        lng: ENV_BASE_LOCATION.lng,
      },
      maxRadiusKm: ENV_MAX_RADIUS_KM,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        env: detectEnv(),
        db: { connected: false, name: "unknown" },
        baseLocation: {
          lat: ENV_BASE_LOCATION.lat,
          lng: ENV_BASE_LOCATION.lng,
        },
        maxRadiusKm: ENV_MAX_RADIUS_KM,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
