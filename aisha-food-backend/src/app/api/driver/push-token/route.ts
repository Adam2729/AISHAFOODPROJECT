import mongoose from "mongoose";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireDriverCityContext } from "@/lib/driverContext";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import { Driver } from "@/models/Driver";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  pushToken?: string;
};

function normalizeToken(value: unknown) {
  const token = String(value || "").trim();
  if (!token) return null;
  if (!/^ExponentPushToken\[.+\]$/.test(token) && !/^ExpoPushToken\[.+\]$/.test(token)) {
    return null;
  }
  return token;
}

export async function POST(req: Request) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const { city, driver } = await requireDriverCityContext(req);
    const body = await readJson<Body>(req).catch(() => ({} as Body));
    const pushToken = normalizeToken(body.pushToken);
    if (!pushToken) {
      return fail("VALIDATION_ERROR", "A valid Expo push token is required.", 400);
    }

    await Driver.updateOne(
      {
        _id: new mongoose.Types.ObjectId(String(driver._id)),
        cityId: new mongoose.Types.ObjectId(String(city._id)),
      },
      {
        $set: {
          pushToken,
          pushTokenUpdatedAt: new Date(),
        },
      }
    );

    return ok({
      driverId: String(driver._id),
      registered: true,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not register driver push token.",
      err.status || 500
    );
  }
}
