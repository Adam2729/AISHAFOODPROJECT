import { fail, readJson } from "@/lib/apiResponse";
import { POST as updateDriverOrderStatus } from "@/app/api/driver/orders/[orderId]/status/route";

type ApiError = Error & { status?: number; code?: string };

export async function POST(
  req: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  try {
    const body: {
      deliveryOtp?: string;
      proofNote?: string;
      photoUrl?: string;
      proof?: { note?: string; photoUrl?: string };
    } = await readJson<{
      deliveryOtp?: string;
      proofNote?: string;
      photoUrl?: string;
      proof?: { note?: string; photoUrl?: string };
    }>(req).catch(() => ({}));
    const url = new URL(req.url);
    const nextRequest = new Request(url.toString(), {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify({
        action: "delivered",
        deliveryOtp: String(body.deliveryOtp || "").trim(),
        proofNote: String(body.proofNote || body.proof?.note || "").trim(),
        photoUrl: String(body.photoUrl || body.proof?.photoUrl || "").trim(),
      }),
    });
    return updateDriverOrderStatus(nextRequest, context);
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not finalize driver delivery.",
      err.status || 500
    );
  }
}

export const PATCH = POST;
