#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

const rootDir = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(rootDir, ".env.local") });
dotenv.config({ path: path.join(rootDir, ".env") });

const apply = process.argv.includes("--apply");
const mongoUri = String(process.env.MONGODB_URI || "").trim();

if (!mongoUri) {
  console.error("Missing MONGODB_URI in environment.");
  process.exit(1);
}

const SANTO = {
  code: "SDQ",
  slug: "santo-domingo",
  name: "Santo Domingo",
  country: "Dominican Republic",
  currency: "DOP",
  maxDeliveryRadiusKm: 8,
  coverageCenterLat: Number(process.env.BASE_LOCATION_LAT || 18.5204),
  coverageCenterLng: Number(process.env.BASE_LOCATION_LNG || -69.959),
  commissionRate: 0.08,
  subscriptionEnabled: true,
  subscriptionPrice: 1000,
  deliveryFeeModel: "restaurantPays",
  deliveryFeeBands: [],
  deliveryFeeCurrency: "DOP",
  riderPayoutModel: "none",
  riderPayoutFlat: 0,
  platformDeliveryMargin: 0,
  paymentMethods: ["cash"],
  riderModel: "selfDelivery",
  supportWhatsAppE164: "18090000000",
  isActive: true,
};

async function ensureDefaultCity(db) {
  const cities = db.collection("cities");
  let city =
    (await cities.findOne({ code: SANTO.code })) ||
    (await cities.findOne({
      name: SANTO.name,
      country: SANTO.country,
    }));
  if (!city && apply) {
    const now = new Date();
    await cities.insertOne({
      ...SANTO,
      createdAt: now,
      updatedAt: now,
    });
    city =
      (await cities.findOne({ code: SANTO.code })) ||
      (await cities.findOne({
        name: SANTO.name,
        country: SANTO.country,
      }));
  }
  return city;
}

async function backfillCollection(db, collectionName, cityId) {
  const collection = db.collection(collectionName);
  const missingFilter = {
    $or: [{ cityId: { $exists: false } }, { cityId: null }],
  };
  const missingCount = await collection.countDocuments(missingFilter);

  if (!apply || !cityId || missingCount === 0) {
    return {
      collection: collectionName,
      missingCount,
      updatedCount: 0,
      applied: false,
    };
  }

  const update = await collection.updateMany(missingFilter, {
    $set: { cityId, updatedAt: new Date() },
  });

  return {
    collection: collectionName,
    missingCount,
    updatedCount: Number(update.modifiedCount || 0),
    applied: true,
  };
}

async function run() {
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  if (!db) throw new Error("No MongoDB connection");

  const defaultCity = await ensureDefaultCity(db);
  const cityId = defaultCity?._id || null;

  const collections = ["businesses", "orders", "settlements", "customers", "users"];
  const results = [];
  for (const name of collections) {
    results.push(await backfillCollection(db, name, cityId));
  }

  const summary = {
    mode: apply ? "apply" : "dry-run",
    defaultCityFound: Boolean(defaultCity),
    defaultCityId: cityId ? String(cityId) : null,
    results,
  };
  console.log(JSON.stringify(summary, null, 2));
}

run()
  .catch((error) => {
    console.error("Backfill failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // no-op
    }
  });
