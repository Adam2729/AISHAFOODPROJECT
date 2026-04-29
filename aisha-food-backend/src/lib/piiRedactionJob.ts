import { ENV_PII_PHONE_RETENTION_DAYS } from "@/lib/env";
import { getWeekKey } from "@/lib/geo";
import { dbConnect } from "@/lib/mongodb";
import { Complaint } from "@/models/Complaint";
import { OpsEvent } from "@/models/OpsEvent";
import { Order } from "@/models/Order";

const PHONE_LIKE_PATTERN = /(?:\+?\d[\d()\-\s]{7,}\d)/g;

type RedactionJobOptions = {
  retentionDaysOverride?: number;
  actor?: "cron" | "admin";
};

function normalizeRetentionDays(value: unknown) {
  if (!Number.isFinite(value)) return ENV_PII_PHONE_RETENTION_DAYS;
  return Math.max(0, Math.min(3650, Math.floor(Number(value))));
}

function redactPhoneLikeText(message: string) {
  const original = String(message || "");
  if (!original) return { updated: original, changed: false };
  const updated = original.replace(PHONE_LIKE_PATTERN, "[redacted-contact]");
  return { updated, changed: updated !== original };
}

export async function runPiiRedactionJob(options?: RedactionJobOptions) {
  await dbConnect();

  const retentionDays = normalizeRetentionDays(options?.retentionDaysOverride);
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const ordersToRedact = await Order.countDocuments({
    createdAt: { $lt: cutoffDate },
    phone: { $exists: true, $nin: [null, "", "***redacted***"] },
  });

  const ordersResult = await Order.updateMany(
    {
      createdAt: { $lt: cutoffDate },
      phone: { $exists: true, $nin: [null, "", "***redacted***"] },
    },
    {
      $set: {
        phone: null,
      },
    }
  );

  const complaints = await Complaint.find({
    message: { $regex: /\d{7,}/ },
  })
    .select("_id message")
    .lean<Array<{ _id: unknown; message?: string }>>();

  let complaintsRedacted = 0;
  for (const complaint of complaints) {
    const next = redactPhoneLikeText(String(complaint.message || ""));
    if (!next.changed) continue;
    complaintsRedacted += 1;
    await Complaint.updateOne(
      { _id: complaint._id },
      { $set: { message: next.updated } }
    );
  }

  const now = new Date();
  const event = await OpsEvent.create({
    type: "PII_REDACT_RUN",
    severity: "low",
    weekKey: getWeekKey(now),
    businessId: null,
    businessName: "system",
    meta: {
      actor: options?.actor || "cron",
      retentionDays,
      cutoffDate: cutoffDate.toISOString(),
      ordersScanned: ordersToRedact,
      ordersRedacted: Number(ordersResult.modifiedCount || 0),
      complaintsScanned: complaints.length,
      complaintsRedacted,
    },
  });

  return {
    ran: true,
    retentionDays,
    cutoffDate: cutoffDate.toISOString(),
    ordersScanned: ordersToRedact,
    ordersRedacted: Number(ordersResult.modifiedCount || 0),
    complaintsScanned: complaints.length,
    complaintsRedacted,
    eventId: String(event._id),
    timestamp: now.toISOString(),
  };
}

