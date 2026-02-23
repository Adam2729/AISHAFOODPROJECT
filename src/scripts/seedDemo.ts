import { createRequire } from "node:module";
import mongoose from "mongoose";

const DEMO_PIN = "1234";
const require = createRequire(import.meta.url);

function loadEnvForScript() {
  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile(".env.local");
    process.loadEnvFile(".env");
    return;
  }

  try {
    const dotenv = require("dotenv") as {
      config: (opts?: { path?: string; override?: boolean }) => void;
    };
    dotenv.config({ path: ".env.local", override: true });
    dotenv.config({ path: ".env" });
  } catch {
    // Env may already be injected by process manager.
  }
}

loadEnvForScript();

function ensureSeedAllowed() {
  const isProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const allowSeed = String(process.env.ALLOW_SEED || "").toLowerCase() === "true";
  if (isProduction && !allowSeed) {
    console.error("Seed blocked: NODE_ENV=production. Set ALLOW_SEED=true to override.");
    process.exit(1);
  }
}

type SeedBusiness = {
  type: "restaurant" | "colmado";
  name: string;
  phone: string;
  whatsapp: string;
  address: string;
  logoUrl: string;
  lat: number;
  lng: number;
};

type SeedProduct = {
  name: string;
  category: string;
  price: number;
  imageUrl: string;
};

type MongoObjectId = mongoose.mongo.BSON.ObjectId;

function restaurantProducts(): SeedProduct[] {
  return [
    { name: "Chimi Clasico", category: "Sandwiches", price: 220, imageUrl: "" },
    { name: "Yaroa Mixta", category: "Platos", price: 280, imageUrl: "" },
    { name: "Pica Pollo", category: "Platos", price: 320, imageUrl: "" },
    { name: "Mofongo de Chicharron", category: "Platos", price: 390, imageUrl: "" },
    { name: "Jugo de Chinola", category: "Bebidas", price: 120, imageUrl: "" },
  ];
}

function colmadoProducts(): SeedProduct[] {
  return [
    { name: "Arroz 1lb", category: "Despensa", price: 55, imageUrl: "" },
    { name: "Aceite 16oz", category: "Despensa", price: 145, imageUrl: "" },
    { name: "Leche Entera 1L", category: "Lacteos", price: 95, imageUrl: "" },
    { name: "Huevos (12)", category: "Lacteos", price: 180, imageUrl: "" },
    { name: "Pan Sobao", category: "Panaderia", price: 70, imageUrl: "" },
  ];
}

async function upsertBusiness(
  businessesCol: mongoose.mongo.Collection<mongoose.mongo.BSON.Document>,
  business: SeedBusiness,
  pinHash: string
) {
  const now = new Date();
  await businessesCol.updateOne(
    { name: business.name },
    {
      $set: {
        type: business.type,
        name: business.name,
        phone: business.phone,
        whatsapp: business.whatsapp,
        address: business.address,
        logoUrl: business.logoUrl,
        location: { type: "Point", coordinates: [business.lng, business.lat] },
        isActive: true,
        commissionRate: 0.08,
        auth: { pinHash, mustChange: false },
        "subscription.status": "trial",
        "subscription.trialDays": 90,
        "subscription.graceDays": 14,
        "subscription.trialStartedAt": now,
        "subscription.trialEndsAt": new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
      },
      $setOnInsert: { createdAt: now },
      $currentDate: { updatedAt: true },
    },
    { upsert: true }
  );

  const saved = await businessesCol.findOne({ name: business.name });
  if (!saved?._id) {
    throw new Error(`Could not create/find business: ${business.name}`);
  }
  return saved._id as MongoObjectId;
}

async function upsertProducts(
  productsCol: mongoose.mongo.Collection<mongoose.mongo.BSON.Document>,
  businessId: MongoObjectId,
  products: SeedProduct[]
) {
  const now = new Date();
  for (const p of products) {
    await productsCol.updateOne(
      { businessId, name: p.name },
      {
        $set: {
          businessId,
          name: p.name,
          category: p.category,
          description: "",
          price: p.price,
          imageUrl: p.imageUrl,
          isAvailable: true,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );
  }
}

async function run() {
  ensureSeedAllowed();

  const { dbConnect } = await import("../lib/mongodb");
  const { hashSecret } = await import("../lib/password");
  const { ENV_BASE_LOCATION, ENV_MAX_RADIUS_KM } = await import("../lib/env");

  await dbConnect();

  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection not available.");

  const businessesCol = db.collection("businesses");
  const productsCol = db.collection("products");

  const baseLat = Number(ENV_BASE_LOCATION.lat);
  const baseLng = Number(ENV_BASE_LOCATION.lng);
  const maxRadiusKm = Number(ENV_MAX_RADIUS_KM);

  const pinHash = hashSecret(DEMO_PIN);

  const seeds: SeedBusiness[] = [
    {
      type: "restaurant",
      name: "Demo Sabor Capital",
      phone: "8095551001",
      whatsapp: "18095551001",
      address: "Piantini, Santo Domingo",
      logoUrl: "",
      lat: baseLat + 0.012,
      lng: baseLng - 0.006,
    },
    {
      type: "colmado",
      name: "Demo Colmado Dona Ana",
      phone: "8095552002",
      whatsapp: "18095552002",
      address: "Naco, Santo Domingo",
      logoUrl: "",
      lat: baseLat - 0.01,
      lng: baseLng + 0.004,
    },
  ];

  const businessIds: Record<string, MongoObjectId> = {};
  for (const seed of seeds) {
    businessIds[seed.name] = await upsertBusiness(businessesCol, seed, pinHash);
  }

  await upsertProducts(productsCol, businessIds["Demo Sabor Capital"], restaurantProducts());
  await upsertProducts(productsCol, businessIds["Demo Colmado Dona Ana"], colmadoProducts());

  const sampleProducts = await productsCol
    .find({ businessId: businessIds["Demo Sabor Capital"], isAvailable: true })
    .limit(1)
    .toArray();
  const sampleProductId = String(sampleProducts[0]?._id || "");

  console.log("=== Aisha Food Demo Seed Complete ===");
  console.log(`BASE_LOCATION: ${baseLat}, ${baseLng} | MAX_RADIUS_KM: ${maxRadiusKm}`);
  console.log("Businesses:");
  for (const seed of seeds) {
    console.log(`- ${seed.name} (${seed.type})`);
    console.log(`  businessId: ${String(businessIds[seed.name])}`);
  }
  console.log(`Demo PIN (for both merchants): ${DEMO_PIN}`);
  console.log("");
  console.log("Example curl (create order):");
  console.log(
    `curl -X POST http://localhost:3000/api/public/orders -H "Content-Type: application/json" -d "{\\"customerName\\":\\"Cliente Demo\\",\\"phone\\":\\"8095558899\\",\\"address\\":\\"Ensanche Naco\\",\\"lat\\":${(
      baseLat + 0.01
    ).toFixed(6)},\\"lng\\":${(baseLng + 0.003).toFixed(6)},\\"businessId\\":\\"${String(
      businessIds["Demo Sabor Capital"]
    )}\\",\\"items\\":[{\\"productId\\":\\"${sampleProductId}\\",\\"qty\\":1}]}"`,
  );
}

run()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown seed error";
    console.error(`Seed failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
