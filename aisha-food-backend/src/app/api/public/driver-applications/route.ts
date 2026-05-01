import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { sendEmail, formatE164ForDisplay } from "@/lib/email";
import { hashDriverPassword } from "@/lib/driverCredentials";
import { getMarketConfig } from "@/lib/marketConfig";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { phoneToHash } from "@/lib/phoneHash";
import { DriverApplication } from "@/models/DriverApplication";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  fullName?: string;
  name?: string;
  phone?: string;
  email?: string;
  password?: string;
  availability?: string;
  documentsStatus?: string;
  idDocumentUrl?: string;
  zoneLabel?: string;
  vehicleType?: string;
  referredByCode?: string;
  notes?: string;
  city?: string;
  cityId?: string;
};

function normalize(value: unknown, max: number, required = false) {
  const v = String(value || "").trim();
  if (!v && required) return "";
  return v.slice(0, max);
}

function buildDriverConfirmationEmail(input: {
  fullName: string;
  cityName: string;
  supportWhatsApp: string;
}) {
  const lines = [
    `Hello ${input.fullName},`,
    "",
    "Thank you for applying to join AishaFood as a driver.",
    "We have received your application successfully.",
    `City: ${input.cityName}`,
    "",
    "Our team will review your details and documents, then contact you with the next steps.",
  ];

  if (input.supportWhatsApp) {
    lines.push("", `Support WhatsApp: ${input.supportWhatsApp}`);
  }

  lines.push("", "AishaFood Team");
  return lines.join("\n");
}

export async function POST(req: Request) {
  try {
    await assertNotInMaintenance();
    const city = await resolveCityFromRequest(req);
    requireActiveCity({
      isActive: Boolean(city.isActive),
      code: String(city.code || ""),
      name: String(city.name || ""),
      country: String(city.country || ""),
    });
    await dbConnect();

    const body = await readJson<Body>(req);
    const name = normalize(body.fullName || body.name, 80, true);
    const phone = normalize(body.phone, 30, true);
    const email = normalize(body.email, 160, true).toLowerCase();
    const password = String(body.password || "").trim();
    const availability = normalize(body.availability, 80, true);
    const documentsStatus = normalize(body.documentsStatus, 40, false) || null;
    const idDocumentUrl = normalize(body.idDocumentUrl, 500, false) || null;
    const zoneLabel = normalize(body.zoneLabel, 80, false) || null;
    const vehicleType = normalize(body.vehicleType, 40, true) || null;
    const referredByCode = normalize(body.referredByCode, 24, false).toUpperCase() || null;
    const notes = normalize(body.notes, 280, false) || null;

    if (!name || !phone || !email || !vehicleType || !availability) {
      return fail(
        "VALIDATION_ERROR",
        "fullName, phone, email, vehicleType, and availability are required.",
        400
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail("VALIDATION_ERROR", "email must be valid.", 400);
    }
    if (password && password.length < 6) {
      return fail("VALIDATION_ERROR", "password must be at least 6 characters.", 400);
    }

    const phoneHash = phoneToHash(phone);
    if (!phoneHash) return fail("VALIDATION_ERROR", "Invalid phone.", 400);
    const passwordHash = password ? hashDriverPassword(password) : "";

    const existingPending = await DriverApplication.findOne({
      cityId: new mongoose.Types.ObjectId(String(city._id)),
      $or: [{ phoneHash }, { email }],
      status: "pending",
    })
      .select("_id")
      .lean();
    if (existingPending) {
      return fail("CONFLICT", "An application is already pending for this phone or email.", 409);
    }

    const created = await DriverApplication.create({
      cityId: new mongoose.Types.ObjectId(String(city._id)),
      status: "pending",
      name,
      fullName: name,
      phone,
      phoneHash,
      email,
      passwordHash,
      city: String(city.name || "").trim() || null,
      zoneLabel,
      vehicleType,
      availability,
      documentsStatus,
      idDocumentUrl,
      referredByCode,
      notes,
      confirmationEmailStatus: "pending",
    });

    const market = getMarketConfig(city);
    const supportWhatsApp = market.supportWhatsAppIsPlaceholder
      ? ""
      : formatE164ForDisplay(market.supportWhatsApp);
    const emailResult = await sendEmail({
      to: email,
      subject: "AishaFood driver application received",
      text: buildDriverConfirmationEmail({
        fullName: name,
        cityName: String(city.name || ""),
        supportWhatsApp,
      }),
    });

    await DriverApplication.updateOne(
      { _id: created._id },
      {
        $set: {
          confirmationEmailStatus: emailResult.status,
          confirmationEmailProvider: emailResult.provider,
          confirmationEmailSentAt:
            emailResult.status === "sent" ? new Date() : null,
          confirmationEmailError: emailResult.error || null,
        },
      }
    ).catch((updateError: unknown) => {
      console.error(
        "Could not persist driver application email status:",
        updateError instanceof Error ? updateError.message : String(updateError)
      );
    });

    return ok(
      {
        applicationId: String(created._id),
        status: "pending",
        cityId: String(city._id),
        cityCode: String(city.code || ""),
        confirmationEmail: emailResult,
      },
      201
    );
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not submit driver application.", err.status || 500);
  }
}
