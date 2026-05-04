import { dbConnect } from "@/lib/mongodb";
import { AppSetting } from "@/models/AppSetting";

type BoolCacheEntry = {
  value: boolean;
  expiresAt: number;
};

type StringCacheEntry = {
  value: string;
  expiresAt: number;
};

type NumberCacheEntry = {
  value: number;
  expiresAt: number;
};

const CACHE_TTL_MS = 5000;
const boolCache = new Map<string, BoolCacheEntry>();
const stringCache = new Map<string, StringCacheEntry>();
const numberCache = new Map<string, NumberCacheEntry>();

function cacheGet(key: string): boolean | null {
  const entry = boolCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    boolCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key: string, value: boolean) {
  boolCache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function stringCacheGet(key: string): string | null {
  const entry = stringCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    stringCache.delete(key);
    return null;
  }
  return entry.value;
}

function stringCacheSet(key: string, value: string) {
  stringCache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function numberCacheGet(key: string): number | null {
  const entry = numberCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    numberCache.delete(key);
    return null;
  }
  return entry.value;
}

function numberCacheSet(key: string, value: number) {
  numberCache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export async function getBoolSetting(key: string, defaultValue: boolean): Promise<boolean> {
  const cached = cacheGet(key);
  if (cached !== null) return cached;

  try {
    await dbConnect();
    const doc = await AppSetting.findOne({ key }).lean<{ boolValue?: boolean | null } | null>();
    const value = typeof doc?.boolValue === "boolean" ? doc.boolValue : defaultValue;
    cacheSet(key, value);
    return value;
  } catch {
    return defaultValue;
  }
}

export async function setBoolSetting(key: string, value: boolean): Promise<boolean> {
  await dbConnect();
  await AppSetting.findOneAndUpdate(
    { key },
    { $set: { boolValue: value } },
    { upsert: true, returnDocument: "after" }
  );
  cacheSet(key, value);
  return value;
}

export async function getStringSetting(key: string, defaultValue: string): Promise<string> {
  const cached = stringCacheGet(key);
  if (cached !== null) return cached;

  try {
    await dbConnect();
    const doc = await AppSetting.findOne({ key }).lean<{ stringValue?: string | null } | null>();
    const value = typeof doc?.stringValue === "string" ? doc.stringValue : defaultValue;
    stringCacheSet(key, value);
    return value;
  } catch {
    return defaultValue;
  }
}

export async function setStringSetting(key: string, value: string): Promise<string> {
  await dbConnect();
  await AppSetting.findOneAndUpdate(
    { key },
    { $set: { stringValue: value } },
    { upsert: true, returnDocument: "after" }
  );
  stringCacheSet(key, value);
  return value;
}

export async function getNumberSetting(key: string, defaultValue: number): Promise<number> {
  const cached = numberCacheGet(key);
  if (cached !== null) return cached;

  try {
    await dbConnect();
    const doc = await AppSetting.findOne({ key }).lean<{ numberValue?: number | null } | null>();
    const value = Number.isFinite(doc?.numberValue) ? Number(doc?.numberValue) : defaultValue;
    numberCacheSet(key, value);
    return value;
  } catch {
    return defaultValue;
  }
}

export async function setNumberSetting(key: string, value: number): Promise<number> {
  await dbConnect();
  await AppSetting.findOneAndUpdate(
    { key },
    { $set: { numberValue: value } },
    { upsert: true, returnDocument: "after" }
  );
  numberCacheSet(key, value);
  return value;
}
