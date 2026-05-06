import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import mongoose from "mongoose";

const require = createRequire(import.meta.url);

const TEST_CITY = {
  code: "BKO",
  slug: "bamako",
  name: "Bamako",
  country: "Mali",
  // Backend stores the Mali FCFA market under the canonical CFA enum.
  currency: "CFA" as const,
  coverageCenterLat: 12.6392,
  coverageCenterLng: -8.0029,
  paymentMethods: [
    "cash",
    "orange_money_ml",
    "moov_money_ml",
    "wave",
    "paytech",
  ],
};

const TEST_MERCHANT = {
  name: "OranjeEats Test Kitchen",
  ownerName: "OranjeEats Merchant Demo",
  phone: "+22370000001",
  whatsapp: "+22370000001",
  email: "merchant@test.oranjeeats.com",
  password: "Password123!",
  address: "ACI 2000, Bamako",
  area: "ACI 2000",
  cuisineType: "Test Kitchen",
  merchantType: "restaurant",
  businessType: "restaurant",
  // Canonical backend delivery types do not support "both" on the Business record.
  deliveryType: "platform_driver" as const,
  location: {
    lat: 12.6454,
    lng: -7.9956,
  },
};

const TEST_PRODUCTS = [
  {
    name: "Demo Jollof Bowl",
    category: "Main dishes",
    description: "Demo seed product for merchant MVP local testing.",
    price: 3500,
    imageUrl: "",
    isAvailable: true,
  },
  {
    name: "Demo Grilled Chicken",
    category: "Main dishes",
    description: "Demo seed product for merchant MVP local testing.",
    price: 4200,
    imageUrl: "",
    isAvailable: true,
  },
  {
    name: "Demo Plantain Fries",
    category: "Sides",
    description: "Demo seed product for merchant MVP local testing.",
    price: 1800,
    imageUrl: "",
    isAvailable: true,
  },
  {
    name: "Demo Ginger Juice",
    category: "Drinks",
    description: "Demo seed product for merchant MVP local testing.",
    price: 1200,
    imageUrl: "",
    isAvailable: true,
  },
  {
    name: "Demo Vanilla Cake",
    category: "Desserts",
    description: "Demo seed product for merchant MVP local testing.",
    price: 2000,
    imageUrl: "",
    isAvailable: true,
  },
] as const;

function loadEnvForScript() {
  if (typeof process.loadEnvFile === "function") {
    if (existsSync(".env.local")) {
      process.loadEnvFile(".env.local");
    }
    if (existsSync(".env")) {
      process.loadEnvFile(".env");
    }
    return;
  }

  try {
    const dotenv = require("dotenv") as {
      config: (opts?: { path?: string; override?: boolean }) => void;
    };
    dotenv.config({ path: ".env.local", override: true });
    dotenv.config({ path: ".env" });
  } catch {
    // Env may already be injected by the runtime.
  }
}

function ensureSeedAllowed() {
  const isProduction = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
  const allowSeed = String(process.env.ALLOW_SEED || "").trim().toLowerCase() === "true";

  if (isProduction && !allowSeed) {
    console.error("Seed blocked: NODE_ENV=production. Set ALLOW_SEED=true to override.");
    process.exit(1);
  }
}

function getWeekKey(date = new Date()) {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

function roundMoney(value: number) {
  return Math.round(value);
}

function buildOrderPayload(params: {
  orderNumber: string;
  status: "new" | "preparing";
  createdAt: Date;
  acceptedAt?: Date | null;
  cityId: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  businessName: string;
  items: Array<{
    productId: mongoose.Types.ObjectId;
    name: string;
    price: number;
    qty: number;
  }>;
  customerName: string;
  customerPhone: string;
  address: string;
  note: string;
  lat: number;
  lng: number;
}) {
  const subtotal = params.items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const orderTotal = subtotal;
  const commissionRate = 0.08;
  const commissionAmount = roundMoney(orderTotal * commissionRate);
  const restaurantNetAmount = Math.max(0, orderTotal - commissionAmount);

  return {
    orderNumber: params.orderNumber,
    cityId: params.cityId,
    businessId: params.businessId,
    businessName: params.businessName,
    businessType: "restaurant" as const,
    customerName: params.customerName,
    phone: params.customerPhone,
    address: params.address,
    notes: params.note,
    customerLocation: {
      lat: params.lat,
      lng: params.lng,
    },
    items: params.items.map((item) => ({
      productId: item.productId,
      name: item.name,
      productPrice: item.price,
      qty: item.qty,
      unitPrice: item.price,
      lineTotal: item.price * item.qty,
      displaySize: "",
      quantityValue: null,
      quantityUnit: "",
    })),
    subtotal,
    deliveryFeeToCustomer: 0,
    total: orderTotal,
    orderTotal,
    commissionRate,
    commissionAmount,
    platformCommissionAmount: commissionAmount,
    restaurantNetAmount,
    driverPayoutAmount: 0,
    commissionRateAtOrderTime: commissionRate,
    currency: "CFA" as const,
    deliveryFeeModelAtOrderTime: "restaurantPays" as const,
    deliveryFeeBandAtOrderTime: {
      minKm: 0,
      maxKm: 8,
      fee: 0,
    },
    riderPayoutExpectedAtOrderTime: 0,
    payment: {
      method: "cash",
      status: "pending",
      paidAt: null,
      provider: null,
      reference: null,
    },
    paymentStatus: "pending",
    status: params.status,
    eta: {
      minMins: 25,
      maxMins: 40,
      prepMins: 15,
      text: "25-40 min",
    },
    deliverySnapshot: {
      mode: "platform_driver",
      noteEs: "Demo merchant MVP test order",
    },
    settlement: {
      weekKey: getWeekKey(params.createdAt),
      status: "pending",
      counted: false,
      collectedAt: null,
      receiptRef: "",
      collectorName: "",
      collectionMethod: "cash",
      receiptPhotoUrl: "",
    },
    sla: {
      firstActionAt: params.acceptedAt ?? null,
      deliveredAt: null,
      firstActionMinutes:
        params.acceptedAt != null
          ? Math.max(0, Math.round((params.acceptedAt.getTime() - params.createdAt.getTime()) / 60000))
          : null,
      totalMinutes: null,
    },
    statusTimestamps: {
      acceptedAt: params.acceptedAt ?? null,
    },
    createdAt: params.createdAt,
    updatedAt: new Date(),
  };
}

loadEnvForScript();

async function run() {
  ensureSeedAllowed();

  const { dbConnect } = await import("../lib/mongodb");
  const { hashSecret } = await import("../lib/password");
  const { City } = await import("../models/City");
  const { Business } = await import("../models/Business");
  const { Product } = await import("../models/Product");
  const { Order } = await import("../models/Order");

  await dbConnect();

  const now = new Date();
  const city = await City.findOneAndUpdate(
    { code: TEST_CITY.code },
    {
      $set: {
        code: TEST_CITY.code,
        slug: TEST_CITY.slug,
        name: TEST_CITY.name,
        country: TEST_CITY.country,
        currency: TEST_CITY.currency,
        maxDeliveryRadiusKm: 8,
        coverageCenterLat: TEST_CITY.coverageCenterLat,
        coverageCenterLng: TEST_CITY.coverageCenterLng,
        commissionRate: 0.08,
        subscriptionEnabled: true,
        subscriptionPrice: 0,
        deliveryFeeModel: "restaurantPays",
        deliveryFeeBands: [
          { minKm: 0, maxKm: 3, fee: 0 },
          { minKm: 3, maxKm: 8, fee: 0 },
        ],
        deliveryFeeCurrency: "CFA",
        riderPayoutModel: "none",
        riderPayoutFlat: 0,
        platformDeliveryMargin: 0,
        paymentMethods: [...TEST_CITY.paymentMethods],
        riderModel: "hybrid",
        supportWhatsAppE164: "+447490493787",
        isActive: true,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    {
      returnDocument: "after",
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    }
  );

  if (!city?._id) {
    throw new Error("Could not create or load the Bamako test city.");
  }

  const merchantPinHash = hashSecret(TEST_MERCHANT.password);
  const business = await Business.findOneAndUpdate(
    { email: TEST_MERCHANT.email },
    {
      $set: {
        cityId: city._id,
        type: TEST_MERCHANT.businessType,
        merchantType: TEST_MERCHANT.merchantType,
        deliveryType: TEST_MERCHANT.deliveryType,
        name: TEST_MERCHANT.name,
        ownerName: TEST_MERCHANT.ownerName,
        phone: TEST_MERCHANT.phone,
        email: TEST_MERCHANT.email,
        whatsapp: TEST_MERCHANT.whatsapp,
        address: TEST_MERCHANT.address,
        area: TEST_MERCHANT.area,
        zoneLabel: TEST_MERCHANT.area,
        cuisineType: TEST_MERCHANT.cuisineType,
        storeCategory: "Test / Demo",
        location: {
          type: "Point",
          coordinates: [TEST_MERCHANT.location.lng, TEST_MERCHANT.location.lat],
        },
        isActive: true,
        isDemo: true,
        paused: false,
        isManuallyPaused: false,
        autoAcceptOrders: false,
        commissionRate: 0.08,
        minimumOrderAmount: 0,
        deliveryRadiusKm: 8,
        payout: {
          preferredMethod: "orange_money",
          details: "Demo payout profile for local merchant MVP tests.",
          payoutContactName: "OranjeEats Test Kitchen",
          accountName: "OranjeEats Test Kitchen",
          accountNumber: TEST_MERCHANT.phone,
          notes: "Demo payout profile for local merchant MVP tests.",
        },
        deliveryPolicy: {
          mode: "platform_driver",
          courierName: "",
          courierPhone: "",
          publicNoteEs: "Entrega coordinada con repartidores de OranjeEats",
          instructionsEs: "",
          updatedAt: now,
        },
        hours: {
          timezone: "Africa/Bamako",
          weekly: {
            mon: { open: "09:00", close: "22:00", closed: false },
            tue: { open: "09:00", close: "22:00", closed: false },
            wed: { open: "09:00", close: "22:00", closed: false },
            thu: { open: "09:00", close: "22:00", closed: false },
            fri: { open: "09:00", close: "22:00", closed: false },
            sat: { open: "09:00", close: "22:00", closed: false },
            sun: { open: "10:00", close: "20:00", closed: false },
          },
        },
        auth: {
          pinHash: merchantPinHash,
          mustChange: false,
        },
        subscription: {
          status: "active",
          trialDays: 90,
          graceDays: 14,
          trialStartedAt: now,
          trialEndsAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
          lastPaidAt: now,
          paidUntilAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        },
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    {
      returnDocument: "after",
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    }
  );

  if (!business?._id) {
    throw new Error("Could not create or load the merchant MVP test business.");
  }

  const productIdsByName = new Map<string, mongoose.Types.ObjectId>();
  for (const productSeed of TEST_PRODUCTS) {
    const product = await Product.findOneAndUpdate(
      { businessId: business._id, name: productSeed.name },
      {
        $set: {
          businessId: business._id,
          name: productSeed.name,
          category: productSeed.category,
          description: productSeed.description,
          price: productSeed.price,
          imageUrl: productSeed.imageUrl,
          isAvailable: productSeed.isAvailable,
          isArchived: false,
          archivedAt: null,
          archivedReason: "",
          stockHint: "in_stock",
          unavailableReason: null,
          unavailableUpdatedAt: null,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      {
        returnDocument: "after",
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );

    if (!product?._id) {
      throw new Error(`Could not create or load test product: ${productSeed.name}`);
    }

    productIdsByName.set(productSeed.name, product._id);
  }

  const newOrderCreatedAt = new Date(now.getTime() - 5 * 60 * 1000);
  const preparingOrderCreatedAt = new Date(now.getTime() - 40 * 60 * 1000);
  const preparingAcceptedAt = new Date(now.getTime() - 30 * 60 * 1000);

  const demoOrders = [
    buildOrderPayload({
      orderNumber: "MVP-BKO-TEST-NEW",
      status: "new",
      createdAt: newOrderCreatedAt,
      cityId: city._id,
      businessId: business._id,
      businessName: business.name,
      customerName: "Demo Customer New",
      customerPhone: "+22370010001",
      address: "Hamdallaye ACI 2000, Bamako",
      note: "Demo seed order for OranjeEats merchant MVP testing.",
      lat: 12.6472,
      lng: -7.9983,
      items: [
        {
          productId: productIdsByName.get("Demo Jollof Bowl")!,
          name: "Demo Jollof Bowl",
          price: 3500,
          qty: 1,
        },
        {
          productId: productIdsByName.get("Demo Ginger Juice")!,
          name: "Demo Ginger Juice",
          price: 1200,
          qty: 1,
        },
      ],
    }),
    buildOrderPayload({
      orderNumber: "MVP-BKO-TEST-PREPARING",
      status: "preparing",
      createdAt: preparingOrderCreatedAt,
      acceptedAt: preparingAcceptedAt,
      cityId: city._id,
      businessId: business._id,
      businessName: business.name,
      customerName: "Demo Customer Preparing",
      customerPhone: "+22370010002",
      address: "Badalabougou, Bamako",
      note: "Demo seed order already in preparing state.",
      lat: 12.6305,
      lng: -8.0102,
      items: [
        {
          productId: productIdsByName.get("Demo Grilled Chicken")!,
          name: "Demo Grilled Chicken",
          price: 4200,
          qty: 1,
        },
        {
          productId: productIdsByName.get("Demo Plantain Fries")!,
          name: "Demo Plantain Fries",
          price: 1800,
          qty: 1,
        },
      ],
    }),
  ];

  for (const orderSeed of demoOrders) {
    await Order.findOneAndUpdate(
      { orderNumber: orderSeed.orderNumber },
      {
        $set: orderSeed,
        $setOnInsert: {
          createdAt: orderSeed.createdAt,
        },
      },
      {
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );
  }

  console.log("=== OranjeEats Merchant MVP Test Seed Complete ===");
  console.log(`City: ${TEST_CITY.name} (${TEST_CITY.code})`);
  console.log(`Merchant: ${business.name}`);
  console.log(`Email: ${TEST_MERCHANT.email}`);
  console.log(`Phone: ${TEST_MERCHANT.phone}`);
  console.log(`Password: ${TEST_MERCHANT.password}`);
  console.log(`Products seeded: ${TEST_PRODUCTS.length}`);
  console.log("Orders seeded: MVP-BKO-TEST-NEW, MVP-BKO-TEST-PREPARING");
  console.log(
    "Note: the approved Business record uses the canonical backend deliveryType=platform_driver because the live schema does not support both."
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
