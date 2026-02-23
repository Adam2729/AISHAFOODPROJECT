import { GRACE_DAYS } from "@/lib/constants";
import { Business } from "@/models/Business";

const DAY_MS = 24 * 60 * 60 * 1000;
let lastRunAt = 0;

export async function runSubscriptionStatusJob(now = new Date()) {
  const nowMs = now.getTime();
  if (nowMs - lastRunAt < DAY_MS) return;
  lastRunAt = nowMs;

  const graceLimitDate = new Date(nowMs - GRACE_DAYS * DAY_MS);

  await Business.updateMany(
    {
      "subscription.status": "trial",
      "subscription.trialEndsAt": { $lt: now },
      "subscription.paidUntilAt": { $gt: now },
    },
    { $set: { "subscription.status": "active" } }
  );

  await Business.updateMany(
    {
      "subscription.status": { $in: ["trial", "active"] },
      $or: [
        {
          "subscription.status": "trial",
          "subscription.trialEndsAt": { $lt: now },
          $or: [
            { "subscription.paidUntilAt": null },
            { "subscription.paidUntilAt": { $exists: false } },
            { "subscription.paidUntilAt": { $lte: now } },
          ],
        },
        {
          "subscription.status": "active",
          "subscription.paidUntilAt": { $lte: now },
        },
      ],
    },
    { $set: { "subscription.status": "past_due" } }
  );

  await Business.updateMany(
    {
      "subscription.status": "past_due",
      $or: [
        {
          "subscription.paidUntilAt": { $ne: null, $lt: graceLimitDate },
        },
        {
          "subscription.paidUntilAt": null,
          "subscription.trialEndsAt": { $lt: graceLimitDate },
        },
      ],
    },
    { $set: { "subscription.status": "suspended" } }
  );

  await Business.updateMany(
    {
      "subscription.status": { $in: ["past_due", "suspended"] },
      "subscription.paidUntilAt": { $gt: now },
    },
    { $set: { "subscription.status": "active" } }
  );
}
