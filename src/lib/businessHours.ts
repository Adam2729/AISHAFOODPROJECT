export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type CloseReason = "closed" | "manual_pause" | "busy";

type DaySchedule = {
  open?: string | null;
  close?: string | null;
  closed?: boolean | null;
};

type HoursConfig = {
  timezone?: string | null;
  weekly?: Partial<Record<DayKey, DaySchedule>> | null;
};

type BusinessLike = {
  paused?: boolean | null;
  isManuallyPaused?: boolean | null;
  busyUntil?: Date | string | null;
  hours?: HoursConfig | null;
};

const WEEK: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAY_TO_DAY: Record<string, DayKey> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};
const DAY_LABEL: Record<DayKey, string> = {
  mon: "Lun",
  tue: "Mar",
  wed: "Mie",
  thu: "Jue",
  fri: "Vie",
  sat: "Sab",
  sun: "Dom",
};

function parseTimeMinutes(value: unknown) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatInTimezone(date: Date, timezone: string) {
  try {
    return new Intl.DateTimeFormat("es-DO", {
      timeZone: timezone,
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function zonedNowParts(now: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const weekday = parts.find((x) => x.type === "weekday")?.value || "";
    const hour = Number(parts.find((x) => x.type === "hour")?.value || "0");
    const minute = Number(parts.find((x) => x.type === "minute")?.value || "0");
    const dayKey = WEEKDAY_TO_DAY[weekday] || "mon";
    return { dayKey, minutes: hour * 60 + minute };
  } catch {
    return { dayKey: "mon" as DayKey, minutes: now.getHours() * 60 + now.getMinutes() };
  }
}

function buildNextOpenText(
  weekly: Partial<Record<DayKey, DaySchedule>> | null | undefined,
  currentDay: DayKey,
  currentMinutes: number
) {
  if (!weekly) return null;
  const startIndex = WEEK.indexOf(currentDay);
  for (let offset = 0; offset < 7; offset++) {
    const index = (startIndex + offset) % 7;
    const day = WEEK[index];
    const schedule = weekly[day];
    if (!schedule || schedule.closed) continue;
    const openMinutes = parseTimeMinutes(schedule.open);
    const closeMinutes = parseTimeMinutes(schedule.close);
    if (openMinutes == null || closeMinutes == null) continue;
    if (offset === 0 && openMinutes <= currentMinutes) continue;
    return `${DAY_LABEL[day]} ${String(schedule.open || "").trim()}`;
  }
  return null;
}

export function isBusinessOpenNow(
  business: BusinessLike
): {
  open: boolean;
  reason?: CloseReason;
  nextOpenAt?: Date | null;
  nextOpenText?: string | null;
} {
  const now = new Date();
  const manualPause = Boolean(business?.isManuallyPaused) || Boolean(business?.paused);
  if (manualPause) {
    return {
      open: false,
      reason: "manual_pause",
      nextOpenAt: null,
      nextOpenText: null,
    };
  }

  const busyUntil = business?.busyUntil ? new Date(business.busyUntil) : null;
  if (busyUntil && !Number.isNaN(busyUntil.getTime()) && busyUntil.getTime() > now.getTime()) {
    const timezone = String(business?.hours?.timezone || "America/Santo_Domingo");
    return {
      open: false,
      reason: "busy",
      nextOpenAt: busyUntil,
      nextOpenText: formatInTimezone(busyUntil, timezone),
    };
  }

  const timezone = String(business?.hours?.timezone || "America/Santo_Domingo");
  const weekly = business?.hours?.weekly;
  const { dayKey, minutes } = zonedNowParts(now, timezone);
  const schedule = weekly?.[dayKey];
  if (!schedule) {
    return { open: true };
  }
  if (schedule.closed) {
    return {
      open: false,
      reason: "closed",
      nextOpenAt: null,
      nextOpenText: buildNextOpenText(weekly, dayKey, minutes),
    };
  }

  const openMinutes = parseTimeMinutes(schedule.open);
  const closeMinutes = parseTimeMinutes(schedule.close);
  if (openMinutes == null || closeMinutes == null) {
    return { open: true };
  }

  let openNow = false;
  if (openMinutes <= closeMinutes) {
    openNow = minutes >= openMinutes && minutes < closeMinutes;
  } else {
    openNow = minutes >= openMinutes || minutes < closeMinutes;
  }

  if (openNow) return { open: true };
  return {
    open: false,
    reason: "closed",
    nextOpenAt: null,
    nextOpenText: buildNextOpenText(weekly, dayKey, minutes),
  };
}
