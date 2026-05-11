import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import mongoose from "mongoose";

const require = createRequire(import.meta.url);

const TEST_CITY = {
  code: "BKO",
  slug: "bamako",
  name: "Bamako",
  country: "Mali",
  currency: "CFA" as const,
  coverageCenterLat: 12.6392,
  coverageCenterLng: -8.0029,
  paymentMethods: ["cash", "orange_money_ml", "moov_money_ml", "wave", "paytech"],
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
  deliveryType: "platform_driver" as const,
  location: {
    lat: 12.6454,
    lng: -7.9956,
  },
};

const TEST_DRIVER = {
  name: "OranjeEats Test Driver",
  phone: "+22370000002",
  email: "driver@test.oranjeeats.com",
  password: "Password123!",
  vehicleType: "motorbike",
  availability: "available" as const,
  zoneLabel: "ACI 2000",
  location: {
    lat: 12.6461,
    lng: -7.9949,
  },
};

const TEST_PRODUCTS = [
  {
    name: "Demo Jollof Bowl",
    category: "Main dishes",
    description: "Demo seed product for driver dispatch MVP local testing.",
    price: 3500,
    imageUrl: "",
    isAvailable: true,
  },
  {
    name: "Demo Grilled Chicken",
    category: "Main dishes",
    description: "Demo seed product for driver dispatch MVP local testing.",
    price: 4200,
    imageUrl: "",
    isAvailable: true,
  },
  {
    name: "Demo Plantain Fries",
    category: "Sides",
    description: "Demo seed product for driver dispatch MVP local testing.",
    price: 1800,
    imageUrl: "",
    isAvailable: true,
  },
  {
    name: "Demo Ginger Juice",
    category: "Drinks",
    description: "Demo seed product for driver dispatch MVP local testing.",
    price: 1200,
    imageUrl: "",
    isAvailable: true,
  },
  {
    name: "Demo Vanilla Cake",
    category: "Desserts",
    description: "Demo seed product for driver dispatch MVP local testing.",
    price: 2000,
    imageUrl: "",
    isAvailable: true,
  },
] as const;

function loadEnvForScript() {
  if (typeof process.loadEnvFile === "function") {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    if (existsSync(".env")) process.loadEnvFile(".env");
    return;
  }

  try {
    const dotenv = require("dotenv") as {
      config: (opts?: { path?: string; override?: boolean }) => void;
    };
    dotenv.config({ path: ".env.local", override: true });
    dotenv.config({ path: ".env" });
  } catch {
    // Environment may already be loaded by the runtime.
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

function buildDispatchReset(state: "waiting_for_driver" | "needs_manual_dispatch" | null = null) {
  return {
    driverDispatchStatus: state,
    assignedDriverId: null,
    assignedDriverName: null,
    assignedAt: null,
    currentOfferDriverId: null,
    currentOfferAttemptId: null,
    currentOfferSentAt: null,
    offerExpiresAt: null,
    currentOfferDistanceKm: null,
    driverArrivedAt: null,
    pickupConfirmedAt: null,
    arrivedAtCustomerAt: null,
    paymentCollectedAt: null,
    paymentCollectionMethod: null,
    paymentCollectionProvider: null,
    paymentCollectionReference: null,
    paymentCollectionNote: null,
    deliveredConfirmedAt: null,
    cashCollectedByDriver: false,
    handoffNote: "",
    routeBatchId: null,
    routeSequence: null,
    currentStopIndex: null,
    dispatchAttempts: [],
  };
}

function buildOrderPayload(params: {
  orderNumber: string;
  status: "preparing" | "ready";
  deliveryMode: "platform_driver" | "self_delivery";
  createdAt: Date;
  acceptedAt?: Date | null;
  readyAt?: Date | null;
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
  dispatchState?: "waiting_for_driver" | "needs_manual_dispatch" | null;
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
    driverPayoutAmount: params.deliveryMode === "platform_driver" ? 1200 : 0,
    commissionRateAtOrderTime: commissionRate,
    currency: "CFA" as const,
    deliveryFeeModelAtOrderTime: "restaurantPays" as const,
    deliveryFeeBandAtOrderTime: {
      minKm: 0,
      maxKm: 8,
      fee: 0,
    },
    riderPayoutExpectedAtOrderTime: params.deliveryMode === "platform_driver" ? 1200 : 0,
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
      minMins: 20,
      maxMins: 35,
      prepMins: 12,
      text: "20-35 min",
    },
    deliverySnapshot: {
      mode: params.deliveryMode,
      noteEs:
        params.deliveryMode === "platform_driver"
          ? "Demo dispatch seed order for OranjeEats local testing."
          : "Demo self delivery order that must never appear in the driver app.",
    },
    dispatch:
      params.deliveryMode === "platform_driver"
        ? buildDispatchReset(params.dispatchState ?? null)
        : buildDispatchReset(null),
    merchantDelivery:
      params.deliveryMode === "self_delivery"
        ? {
            assignedAt: null,
            riderName: "Store rider demo",
            riderPhone: "+22370000009",
          }
        : {
            assignedAt: null,
            riderName: "",
            riderPhone: "",
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
      readyAt: params.readyAt ?? null,
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
  const { hashDriverPassword } = await import("../lib/driverCredentials");
  const { phoneToHash } = await import("../lib/phoneHash");
  const { City } = await import("../models/City");
  const { Business } = await import("../models/Business");
  const { Product } = await import("../models/Product");
  const { Order } = await import("../models/Order");
  const { Driver } = await import("../models/Driver");
  const { DriverApplication } = await import("../models/DriverApplication");

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
    throw new Error("Could not create or load the Bamako dispatch test city.");
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
          details: "Demo payout profile for local driver dispatch MVP tests.",
          payoutContactName: "OranjeEats Test Kitchen",
          accountName: "OranjeEats Test Kitchen",
          accountNumber: TEST_MERCHANT.phone,
          notes: "Demo payout profile for local driver dispatch MVP tests.",
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
    throw new Error("Could not create or load the OranjeEats test kitchen.");
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
      throw new Error(`Could not create or load dispatch seed product: ${productSeed.name}`);
    }

    productIdsByName.set(productSeed.name, product._id);
  }

  const driverPasswordHash = hashDriverPassword(TEST_DRIVER.password);
  const driver = await Driver.findOneAndUpdate(
    {
      $or: [{ email: TEST_DRIVER.email }, { phoneHash: phoneToHash(TEST_DRIVER.phone) }],
    },
    {
      $set: {
        name: TEST_DRIVER.name,
        email: TEST_DRIVER.email,
        phoneE164: TEST_DRIVER.phone,
        cityId: city._id,
        isActive: true,
        isArchived: false,
        archivedAt: null,
        archivedByAdminId: null,
        archiveReason: "",
        isBanned: false,
        bannedAt: null,
        bannedReason: null,
        availability: TEST_DRIVER.availability,
        pausedAt: null,
        pausedReason: null,
        breakStartedAt: null,
        breakReason: null,
        breakNote: "",
        lastSeenAt: now,
        lastAssignedAt: null,
        lastDeliveryConfirmedAt: null,
        zoneLabel: TEST_DRIVER.zoneLabel,
        vehicleType: TEST_DRIVER.vehicleType,
        notes: "Demo driver account for OranjeEats auto-dispatch MVP local testing.",
        "auth.passwordHash": driverPasswordHash,
        "auth.passwordSetAt": now,
        pushToken: null,
        pushTokenUpdatedAt: null,
        payout: {
          preferredMethod: "orange_money",
          accountName: TEST_DRIVER.name,
          accountNumber: TEST_DRIVER.phone,
          notes: "Demo payout profile for local driver dispatch MVP tests.",
        },
        lastLocation: {
          lat: TEST_DRIVER.location.lat,
          lng: TEST_DRIVER.location.lng,
          accuracy: 10,
          heading: 0,
          speed: 0,
          updatedAt: now,
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

  if (!driver?._id) {
    throw new Error("Could not create or load the OranjeEats test driver.");
  }

  await DriverApplication.findOneAndUpdate(
    { email: TEST_DRIVER.email },
    {
      $set: {
        cityId: city._id,
        status: "approved",
        name: TEST_DRIVER.name,
        fullName: TEST_DRIVER.name,
        phone: TEST_DRIVER.phone,
        phoneHash: phoneToHash(TEST_DRIVER.phone),
        email: TEST_DRIVER.email,
        passwordHash: driverPasswordHash,
        city: `${TEST_CITY.code} - ${TEST_CITY.name}`,
        zoneLabel: TEST_DRIVER.zoneLabel,
        vehicleType: TEST_DRIVER.vehicleType,
        availability: "Full time / demo dispatch test",
        payoutMethod: "orange_money",
        payoutAccountName: TEST_DRIVER.name,
        payoutAccountNumber: TEST_DRIVER.phone,
        payoutNotes: "Demo payout details for local dispatch testing.",
        confirmationEmailStatus: "skipped",
        reviewedAt: now,
        reviewedBy: "seed:driver-dispatch-mvp",
        reviewedByAdminId: null,
        rejectReason: null,
        rejectionReason: null,
        driverId: driver._id,
        approvedDriverId: driver._id,
        notes: "Demo approved driver application for local dispatch MVP testing.",
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

  const preparingOrderCreatedAt = new Date(now.getTime() - 35 * 60 * 1000);
  const preparingAcceptedAt = new Date(now.getTime() - 25 * 60 * 1000);
  const readyOrderCreatedAt = new Date(now.getTime() - 45 * 60 * 1000);
  const readyOrderAcceptedAt = new Date(now.getTime() - 35 * 60 * 1000);
  const readyOrderReadyAt = new Date(now.getTime() - 10 * 60 * 1000);
  const selfDeliveryCreatedAt = new Date(now.getTime() - 30 * 60 * 1000);
  const selfDeliveryAcceptedAt = new Date(now.getTime() - 20 * 60 * 1000);
  const selfDeliveryReadyAt = new Date(now.getTime() - 8 * 60 * 1000);

  const demoOrders = [
    buildOrderPayload({
      orderNumber: "DDMVP-BKO-PREPARING",
      status: "preparing",
      deliveryMode: "platform_driver",
      createdAt: preparingOrderCreatedAt,
      acceptedAt: preparingAcceptedAt,
      cityId: city._id,
      businessId: business._id,
      businessName: business.name,
      customerName: "Dispatch Demo Customer Preparing",
      customerPhone: "+22370010021",
      address: "Hamdallaye ACI 2000, Bamako",
      note: "Demo platform_driver order. Mark this order ready in the merchant app to trigger auto dispatch.",
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
      dispatchState: null,
    }),
    buildOrderPayload({
      orderNumber: "DDMVP-BKO-READY",
      status: "ready",
      deliveryMode: "platform_driver",
      createdAt: readyOrderCreatedAt,
      acceptedAt: readyOrderAcceptedAt,
      readyAt: readyOrderReadyAt,
      cityId: city._id,
      businessId: business._id,
      businessName: business.name,
      customerName: "Dispatch Demo Customer Ready",
      customerPhone: "+22370010022",
      address: "Badalabougou, Bamako",
      note: "Demo ready platform_driver order kept unassigned for dispatch board testing.",
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
      dispatchState: "needs_manual_dispatch",
    }),
    buildOrderPayload({
      orderNumber: "DDMVP-BKO-SELFDELIVERY",
      status: "ready",
      deliveryMode: "self_delivery",
      createdAt: selfDeliveryCreatedAt,
      acceptedAt: selfDeliveryAcceptedAt,
      readyAt: selfDeliveryReadyAt,
      cityId: city._id,
      businessId: business._id,
      businessName: business.name,
      customerName: "Dispatch Demo Customer Self Delivery",
      customerPhone: "+22370010023",
      address: "Djicoroni Para, Bamako",
      note: "Demo self_delivery order. This must never appear in the driver app.",
      lat: 12.6268,
      lng: -8.0321,
      items: [
        {
          productId: productIdsByName.get("Demo Vanilla Cake")!,
          name: "Demo Vanilla Cake",
          price: 2000,
          qty: 1,
        },
        {
          productId: productIdsByName.get("Demo Ginger Juice")!,
          name: "Demo Ginger Juice",
          price: 1200,
          qty: 1,
        },
      ],
      dispatchState: null,
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

  console.log("=== OranjeEats Driver Dispatch MVP Test Seed Complete ===");
  console.log(`City: ${TEST_CITY.name} (${TEST_CITY.code})`);
  console.log(`Merchant: ${business.name}`);
  console.log(`Merchant email: ${TEST_MERCHANT.email}`);
  console.log(`Merchant phone: ${TEST_MERCHANT.phone}`);
  console.log(`Merchant password: ${TEST_MERCHANT.password}`);
  console.log(`Driver: ${TEST_DRIVER.name}`);
  console.log(`Driver email: ${TEST_DRIVER.email}`);
  console.log(`Driver phone: ${TEST_DRIVER.phone}`);
  console.log(`Driver password: ${TEST_DRIVER.password}`);
  console.log("Orders seeded:");
  console.log(" - DDMVP-BKO-PREPARING (platform_driver, mark ready in merchant app to trigger offer)");
  console.log(" - DDMVP-BKO-READY (platform_driver, ready/unassigned for dispatch board testing)");
  console.log(" - DDMVP-BKO-SELFDELIVERY (self_delivery, must never appear in driver app)");
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
