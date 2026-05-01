import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { getDefaultCity } from "@/lib/city";
import { ENV_ALLOW_SEED, ENV_NODE_ENV } from "@/lib/env";
import { signDriverJwt } from "@/lib/driverAuth";
import {
  hashDriverPassword,
  normalizeDriverCredential,
  normalizeDriverEmail,
  verifyDriverPassword,
} from "@/lib/driverCredentials";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { DriverApplication } from "@/models/DriverApplication";
import { Driver } from "@/models/Driver";

type ApiError = Error & { status?: number; code?: string };

type LoginBody = {
  identifier?: string;
  phone?: string;
  email?: string;
  password?: string;
};

type DriverLoginDoc = {
  _id: mongoose.Types.ObjectId;
  name: string;
  email?: string | null;
  phoneE164?: string | null;
  cityId?: mongoose.Types.ObjectId | null;
  vehicleType?: string | null;
  isActive?: boolean;
  isBanned?: boolean;
  auth?: {
    passwordHash?: string | null;
  } | null;
};

type PendingDriverApplicationDoc = {
  _id: mongoose.Types.ObjectId;
  status?: string | null;
  passwordHash?: string | null;
};

function driverResponse(driver: DriverLoginDoc) {
  return {
    id: String(driver._id),
    name: String(driver.name || ""),
    phone: String(driver.phoneE164 || ""),
    email: String(driver.email || ""),
    vehicleType: String(driver.vehicleType || ""),
    status: driver.isActive && !driver.isBanned ? "active" : "inactive",
  };
}

function normalizeLoginInput(body: LoginBody) {
  const rawIdentifier = normalizeDriverCredential(body.identifier);
  const rawPhone = normalizeDriverCredential(body.phone);
  const rawEmail = normalizeDriverEmail(body.email);
  const identifierEmail = rawIdentifier.includes("@")
    ? normalizeDriverEmail(rawIdentifier)
    : "";
  const identifierPhone = rawIdentifier && !identifierEmail ? normalizePhone(rawIdentifier) : "";
  const phone = normalizePhone(rawPhone || identifierPhone);
  const email = rawEmail || identifierEmail;

  return {
    phone,
    email,
    password: String(body.password || ""),
  };
}

function canUseDevDemoLogin(input: { phone: string; email: string; password: string }) {
  if (ENV_NODE_ENV === "production" && !ENV_ALLOW_SEED) return false;
  if (input.password !== "1234") return false;
  return input.phone === "70000000" || input.email === "driver@aishafood.com";
}

async function findDriverForLogin(input: { phone: string; email: string }) {
  const or: Record<string, unknown>[] = [];
  if (input.phone) or.push({ phoneHash: phoneToHash(input.phone) });
  if (input.email) or.push({ email: input.email });
  if (!or.length) return null;

  return Driver.findOne({ $or: or })
    .select("_id name email phoneE164 cityId vehicleType isActive isBanned auth.passwordHash")
    .lean<DriverLoginDoc | null>();
}

async function findPendingDriverApplicationForLogin(input: {
  phone: string;
  email: string;
  password: string;
}) {
  const or: Record<string, unknown>[] = [];
  if (input.phone) or.push({ phoneHash: phoneToHash(input.phone) });
  if (input.email) or.push({ email: input.email });
  if (!or.length) return null;

  const application = await DriverApplication.findOne({
    $or: or,
    status: "pending",
  })
    .sort({ createdAt: -1 })
    .select("_id status passwordHash")
    .lean<PendingDriverApplicationDoc | null>();
  if (!application) return null;

  const applicationPasswordHash = String(application.passwordHash || "").trim();
  if (!applicationPasswordHash) return application;
  if (verifyDriverPassword(input.password, applicationPasswordHash)) {
    return application;
  }
  return null;
}

async function ensureDevDemoDriver(input: { phone: string; email: string; password: string }) {
  if (!canUseDevDemoLogin(input)) return null;

  const selectedCity = await getDefaultCity();
  const phone = input.phone || "70000000";
  const email = input.email || "driver@aishafood.com";
  const passwordHash = hashDriverPassword(input.password);

  const updated = await Driver.findOneAndUpdate(
    {
      $or: [{ phoneHash: phoneToHash(phone) }, { email }],
    },
    {
      $setOnInsert: {
        name: "Aisha Test Driver",
        cityId: new mongoose.Types.ObjectId(String(selectedCity._id)),
        phoneE164: phone,
        phoneHash: phoneToHash(phone),
        email,
        vehicleType: "bike",
        isActive: true,
        isBanned: false,
        availability: "available",
      },
      $set: {
        "auth.passwordHash": passwordHash,
        "auth.passwordSetAt": new Date(),
      },
    },
    { upsert: true, new: true }
  )
    .select("_id name email phoneE164 cityId vehicleType isActive isBanned auth.passwordHash")
    .lean<DriverLoginDoc | null>();

  return updated;
}

export async function POST(req: NextRequest) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const body = (await req.json()) as LoginBody;
    const input = normalizeLoginInput(body);
    console.log("[driver-auth-login] request body", {
      identifier: body.identifier ? "[present]" : "",
      phone: input.phone,
      email: input.email,
      passwordPresent: Boolean(input.password),
    });

    if ((!input.phone && !input.email) || !input.password) {
      return NextResponse.json({ error: "Phone or email and password are required." }, { status: 400 });
    }

    let driver = await findDriverForLogin(input);
    if (!driver) {
      const pendingApplication = await findPendingDriverApplicationForLogin(input);
      if (pendingApplication) {
        return NextResponse.json(
          { error: "Your driver account is pending approval." },
          { status: 403 }
        );
      }
      driver = await ensureDevDemoDriver(input);
    } else if (!driver.auth?.passwordHash && canUseDevDemoLogin(input)) {
      await Driver.updateOne(
        { _id: driver._id },
        {
          $set: {
            "auth.passwordHash": hashDriverPassword(input.password),
            "auth.passwordSetAt": new Date(),
          },
        }
      );
      driver = await findDriverForLogin(input);
    }

    if (!driver) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    if (!driver.isActive || driver.isBanned) {
      return NextResponse.json({ error: "Driver account is not active." }, { status: 403 });
    }

    const passwordHash = String(driver.auth?.passwordHash || "");
    if (!verifyDriverPassword(input.password, passwordHash)) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const cityId = String(driver.cityId || "");
    if (!mongoose.Types.ObjectId.isValid(cityId)) {
      return NextResponse.json({ error: "Driver city is not configured." }, { status: 409 });
    }

    const token = signDriverJwt({
      driverId: String(driver._id),
      cityId,
      ttlSec: 7 * 24 * 60 * 60,
    });

    await Driver.updateOne(
      { _id: driver._id },
      {
        $set: {
          "auth.lastLoginAt": new Date(),
          lastSeenAt: new Date(),
        },
      }
    );

    return NextResponse.json({
      token,
      driver: driverResponse(driver),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    console.error("[driver-auth-login] failed", err);
    return NextResponse.json(
      { error: err.message || "Login failed" },
      { status: err.status || 500 }
    );
  }
}
