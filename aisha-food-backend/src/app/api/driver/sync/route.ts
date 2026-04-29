import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { POST as syncDriverOrderAction } from "@/app/api/driver/orders/[orderId]/sync/route";

type ApiError = Error & { status?: number; code?: string };

type SyncActionInput = {
  syncId?: string;
  orderId?: string;
  action?: string;
  payload?: Record<string, unknown>;
};

type SyncBody = {
  actions?: SyncActionInput[];
};

function normalizeText(value: unknown, max = 120) {
  return String(value || "").trim().slice(0, max);
}

export async function POST(req: Request) {
  try {
    await assertNotInMaintenance();

    const body = await readJson<SyncBody>(req);
    const actions = Array.isArray(body.actions) ? body.actions : [];
    if (!actions.length) {
      return fail("VALIDATION_ERROR", "actions must contain at least one pending sync item.", 400);
    }
    if (actions.length > 25) {
      return fail("VALIDATION_ERROR", "actions cannot contain more than 25 items.", 400);
    }

    const results = [];
    let syncedCount = 0;
    let failedCount = 0;

    for (const item of actions) {
      const orderId = normalizeText(item.orderId, 64);
      const syncId = normalizeText(item.syncId, 120);
      const action = normalizeText(item.action, 64);

      if (!orderId || !syncId || !action) {
        failedCount += 1;
        results.push({
          orderId: orderId || null,
          syncId: syncId || null,
          action: action || null,
          ok: false,
          synced: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Each sync action requires orderId, syncId, and action.",
          },
        });
        continue;
      }

      const delegated = await syncDriverOrderAction(
        new Request(req.url, {
          method: "POST",
          headers: req.headers,
          body: JSON.stringify({
            syncId,
            action,
            payload: item.payload && typeof item.payload === "object" ? item.payload : {},
          }),
        }),
        {
          params: Promise.resolve({ orderId }),
        }
      );

      const payload = await delegated.clone().json().catch(() => null);
      const okResult = Boolean(delegated.ok && payload?.ok);
      if (okResult) {
        syncedCount += 1;
      } else {
        failedCount += 1;
      }

      results.push({
        orderId,
        syncId,
        action,
        ok: okResult,
        synced: Boolean(payload?.data?.synced),
        idempotent: Boolean(payload?.data?.idempotent),
        data: payload?.data ?? null,
        error: okResult ? null : payload?.error || null,
      });
    }

    return ok({
      syncedCount,
      failedCount,
      results,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not sync pending driver actions.",
      err.status || 500
    );
  }
}
