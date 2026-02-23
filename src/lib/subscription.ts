import { GRACE_DAYS, TRIAL_DAYS } from "@/lib/constants";

type SubscriptionInput = {
  trialEndsAt?: Date | string | null;
  paidUntilAt?: Date | string | null;
  graceDays?: number | null;
};

export type SubscriptionComputedStatus = "trial" | "active" | "past_due" | "suspended";

export function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function computeSubscriptionStatus(subscription: SubscriptionInput, now = new Date()) {
  const trialEndsAt = subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : addDays(now, TRIAL_DAYS);
  const paidUntilAt = subscription.paidUntilAt ? new Date(subscription.paidUntilAt) : null;
  const graceDays = Number(subscription.graceDays ?? GRACE_DAYS) || GRACE_DAYS;

  const current = new Date(now);
  if (current <= trialEndsAt) {
    const ms = trialEndsAt.getTime() - current.getTime();
    return {
      status: "trial" as SubscriptionComputedStatus,
      trialEndsAt,
      paidUntilAt,
      dueAt: trialEndsAt,
      daysRemaining: Math.ceil(ms / 86400000),
      graceDaysRemaining: graceDays,
    };
  }

  const dueAt = paidUntilAt && paidUntilAt > trialEndsAt ? paidUntilAt : trialEndsAt;
  if (current <= dueAt) {
    const ms = dueAt.getTime() - current.getTime();
    return {
      status: "active" as SubscriptionComputedStatus,
      trialEndsAt,
      paidUntilAt,
      dueAt,
      daysRemaining: Math.ceil(ms / 86400000),
      graceDaysRemaining: graceDays,
    };
  }

  const graceUntil = addDays(dueAt, graceDays);
  if (current <= graceUntil) {
    const ms = graceUntil.getTime() - current.getTime();
    return {
      status: "past_due" as SubscriptionComputedStatus,
      trialEndsAt,
      paidUntilAt,
      dueAt,
      daysRemaining: 0,
      graceDaysRemaining: Math.ceil(ms / 86400000),
    };
  }

  return {
    status: "suspended" as SubscriptionComputedStatus,
    trialEndsAt,
    paidUntilAt,
    dueAt,
    daysRemaining: 0,
    graceDaysRemaining: 0,
  };
}
