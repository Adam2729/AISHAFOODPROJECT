import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import mongoose from "mongoose";

const require = createRequire(import.meta.url);

const BASE_URL = String(process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const TEST_MERCHANT = {
  email: "merchant@test.oranjeeats.com",
  phone: "+22370000001",
  password: "Password123!",
};
const TEST_DRIVER = {
  email: "driver@test.oranjeeats.com",
  phone: "+22370000002",
  password: "Password123!",
};
const TEST_ORDERS = {
  platformDriverPreparing: "DDMVP-BKO-PREPARING",
  platformDriverReady: "DDMVP-BKO-READY",
  selfDelivery: "DDMVP-BKO-SELFDELIVERY",
};
const TEST_PRODUCT_NAMES = [
  "Demo Jollof Bowl",
  "Demo Grilled Chicken",
  "Demo Plantain Fries",
  "Demo Ginger Juice",
  "Demo Vanilla Cake",
] as const;

type Summary = {
  pass: number;
  warn: number;
  fail: number;
};

type HttpResponse = {
  ok: boolean;
  status: number;
  text: string;
  json: Record<string, unknown> | null;
  headers: Headers;
};

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
    // Env may already be injected.
  }
}

function pass(summary: Summary, message: string) {
  summary.pass += 1;
  console.log(`[PASS] ${message}`);
}

function warn(summary: Summary, message: string) {
  summary.warn += 1;
  console.log(`[WARN] ${message}`);
}

function fail(summary: Summary, message: string) {
  summary.fail += 1;
  console.log(`[FAIL] ${message}`);
}

function parseCookieHeader(setCookie: string | null) {
  if (!setCookie) return "";
  const first = setCookie.split(",")[0];
  return first.split(";")[0].trim();
}

async function request(pathname: string, options?: {
  method?: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: options?.method || "GET",
    headers: {
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...(options?.headers || {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(8000),
  });

  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    text,
    json,
    headers: response.headers,
  } satisfies HttpResponse;
}

async function tryHealthCheck() {
  try {
    return await request("/api/health");
  } catch {
    return null;
  }
}

async function main() {
  loadEnvForScript();

  const { dbConnect } = await import("../lib/mongodb");
  const { Business } = await import("../models/Business");
  const { Driver } = await import("../models/Driver");
  const { Order } = await import("../models/Order");
  const { Product } = await import("../models/Product");

  const summary: Summary = { pass: 0, warn: 0, fail: 0 };
  console.log(`Running OranjeEats end-to-end MVP smoke helper against ${BASE_URL}`);

  try {
    await dbConnect();
    pass(summary, "MongoDB connection is working.");
  } catch (error: unknown) {
    fail(
      summary,
      `MongoDB connection failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    process.exitCode = 1;
    return;
  }

  const merchant = await Business.findOne({ email: TEST_MERCHANT.email })
    .select("_id name email phone deliveryType cityId")
    .lean<{
      _id: mongoose.Types.ObjectId;
      name?: string | null;
      email?: string | null;
      phone?: string | null;
      deliveryType?: string | null;
      cityId?: mongoose.Types.ObjectId | null;
    } | null>();

  if (!merchant?._id) {
    fail(summary, "Seeded merchant is missing. Run npm run seed:merchant-mvp and npm run seed:driver-dispatch-mvp.");
  } else {
    pass(summary, `Seeded merchant found: ${String(merchant.name || TEST_MERCHANT.email)}.`);
  }

  const driver = await Driver.findOne({ email: TEST_DRIVER.email })
    .select("_id name email phoneE164 availability cityId isActive isBanned")
    .lean<{
      _id: mongoose.Types.ObjectId;
      name?: string | null;
      email?: string | null;
      phoneE164?: string | null;
      availability?: string | null;
      cityId?: mongoose.Types.ObjectId | null;
      isActive?: boolean;
      isBanned?: boolean;
    } | null>();

  if (!driver?._id) {
    fail(summary, "Seeded driver is missing. Run npm run seed:driver-dispatch-mvp.");
  } else {
    const driverState = `${driver.isActive ? "active" : "inactive"}, ${String(driver.availability || "unknown")}`;
    pass(summary, `Seeded driver found: ${String(driver.name || TEST_DRIVER.email)} (${driverState}).`);
  }

  const productCount = merchant?._id
    ? await Product.countDocuments({
        businessId: merchant._id,
        name: { $in: [...TEST_PRODUCT_NAMES] },
        isArchived: { $ne: true },
      })
    : 0;

  if (productCount >= 5) {
    pass(summary, `Seeded merchant products found: ${productCount}.`);
  } else {
    fail(summary, `Expected at least 5 seeded products, found ${productCount}.`);
  }

  const platformOrder = await Order.findOne({
    orderNumber: TEST_ORDERS.platformDriverPreparing,
  })
    .select("_id orderNumber status phone address deliverySnapshot dispatch")
    .lean<{
      _id: mongoose.Types.ObjectId;
      orderNumber?: string | null;
      status?: string | null;
      phone?: string | null;
      address?: string | null;
      deliverySnapshot?: { mode?: string | null } | null;
    } | null>();

  if (!platformOrder?._id) {
    fail(summary, `Missing platform_driver test order ${TEST_ORDERS.platformDriverPreparing}.`);
  } else if (String(platformOrder.deliverySnapshot?.mode || "").trim() !== "platform_driver") {
    fail(summary, `${TEST_ORDERS.platformDriverPreparing} is not marked platform_driver.`);
  } else {
    pass(summary, `Platform-driver test order found: ${TEST_ORDERS.platformDriverPreparing}.`);
  }

  const readyOrder = await Order.findOne({
    orderNumber: TEST_ORDERS.platformDriverReady,
  })
    .select("_id orderNumber status deliverySnapshot.mode dispatch.driverDispatchStatus dispatch.assignedDriverId")
    .lean<{
      _id: mongoose.Types.ObjectId;
      status?: string | null;
      deliverySnapshot?: { mode?: string | null } | null;
      dispatch?: {
        driverDispatchStatus?: string | null;
        assignedDriverId?: mongoose.Types.ObjectId | null;
      } | null;
    } | null>();

  if (!readyOrder?._id) {
    fail(summary, `Missing ready platform_driver test order ${TEST_ORDERS.platformDriverReady}.`);
  } else {
    pass(summary, `Ready dispatch test order found: ${TEST_ORDERS.platformDriverReady}.`);
  }

  const selfDeliveryOrder = await Order.findOne({
    orderNumber: TEST_ORDERS.selfDelivery,
  })
    .select(
      "_id orderNumber status deliverySnapshot.mode dispatch.assignedDriverId dispatch.currentOfferDriverId dispatch.driverDispatchStatus"
    )
    .lean<{
      _id: mongoose.Types.ObjectId;
      deliverySnapshot?: { mode?: string | null } | null;
      dispatch?: {
        assignedDriverId?: mongoose.Types.ObjectId | null;
        currentOfferDriverId?: mongoose.Types.ObjectId | null;
        driverDispatchStatus?: string | null;
      } | null;
    } | null>();

  if (!selfDeliveryOrder?._id) {
    fail(summary, `Missing self_delivery test order ${TEST_ORDERS.selfDelivery}.`);
  } else if (String(selfDeliveryOrder.deliverySnapshot?.mode || "").trim() !== "self_delivery") {
    fail(summary, `${TEST_ORDERS.selfDelivery} is not marked self_delivery.`);
  } else if (
    selfDeliveryOrder.dispatch?.assignedDriverId ||
    selfDeliveryOrder.dispatch?.currentOfferDriverId
  ) {
    fail(summary, `${TEST_ORDERS.selfDelivery} is incorrectly tied to driver dispatch state.`);
  } else {
    pass(summary, `Self-delivery test order is present and not assigned/offered to a driver.`);
  }

  const missingPayTech = [
    "PAYTECH_API_KEY",
    "PAYTECH_SECRET_KEY",
    "PAYTECH_WEBHOOK_SECRET",
    "PAYTECH_SUCCESS_URL",
    "PAYTECH_CANCEL_URL",
  ].filter((key) => !String(process.env[key] || "").trim());

  if (!missingPayTech.length) {
    pass(summary, "PayTech env keys are present.");
  } else {
    warn(summary, `PayTech env keys missing or empty: ${missingPayTech.join(", ")}.`);
  }

  const health = await tryHealthCheck();
  if (!health || !health.ok) {
    warn(
      summary,
      "Backend HTTP checks skipped. Start the backend on SMOKE_BASE_URL or http://localhost:3000 for API validation."
    );
  } else {
    pass(summary, `Backend health endpoint is reachable at ${BASE_URL}.`);

    if (platformOrder?._id && platformOrder.phone) {
      const trackResponse = await request(
        `/api/public/track?orderId=${encodeURIComponent(String(platformOrder._id))}&phone=${encodeURIComponent(
          String(platformOrder.phone)
        )}`
      );
      if (!trackResponse.ok || !trackResponse.json) {
        fail(summary, `Public tracking endpoint failed for ${TEST_ORDERS.platformDriverPreparing}.`);
      } else {
        const trackedOrder = (trackResponse.json.order || {}) as Record<string, unknown>;
        if (String(trackedOrder.orderId || "") === String(platformOrder._id)) {
          pass(summary, `Public tracking endpoint located ${TEST_ORDERS.platformDriverPreparing}.`);
        } else {
          fail(summary, "Public tracking endpoint did not return the expected test order.");
        }
      }
    } else {
      warn(summary, "Skipping public tracking check because the seeded platform order is missing phone/order id.");
    }

    const merchantLogin = await request("/api/merchant/auth/login", {
      method: "POST",
      body: {
        identifier: TEST_MERCHANT.email,
        password: TEST_MERCHANT.password,
      },
    });

    const merchantToken =
      String(
        merchantLogin.json?.token ||
          merchantLogin.json?.accessToken ||
          merchantLogin.json?.merchantToken ||
          ""
      ).trim() || parseCookieHeader(merchantLogin.headers.get("set-cookie"));

    if (!merchantLogin.ok || !merchantToken) {
      fail(summary, `Merchant login failed for ${TEST_MERCHANT.email}.`);
    } else {
      pass(summary, `Merchant login works for ${TEST_MERCHANT.email}.`);

      const merchantProducts = await request("/api/merchant/products", {
        headers: {
          Authorization: `Bearer ${merchantToken}`,
        },
      });

      if (!merchantProducts.ok || !merchantProducts.json) {
        fail(summary, "Merchant products endpoint failed.");
      } else {
        const products = Array.isArray(merchantProducts.json.products)
          ? (merchantProducts.json.products as Array<Record<string, unknown>>)
          : [];
        if (products.length >= 5) {
          pass(summary, `Merchant products endpoint returned ${products.length} product rows.`);
        } else {
          fail(summary, `Merchant products endpoint returned too few products: ${products.length}.`);
        }
      }

      const merchantOrders = await request("/api/merchant/orders", {
        headers: {
          Authorization: `Bearer ${merchantToken}`,
        },
      });

      if (!merchantOrders.ok || !merchantOrders.json) {
        fail(summary, "Merchant orders endpoint failed.");
      } else {
        const orders = Array.isArray(merchantOrders.json.orders)
          ? (merchantOrders.json.orders as Array<Record<string, unknown>>)
          : [];
        if (
          orders.some(
            (row) =>
              String(row.orderNumber || "") === TEST_ORDERS.platformDriverPreparing ||
              String(row.orderNumber || "") === TEST_ORDERS.platformDriverReady
          )
        ) {
          pass(summary, "Merchant orders endpoint returned the seeded dispatch test orders.");
        } else {
          fail(summary, "Merchant orders endpoint did not include the seeded dispatch test orders.");
        }
      }
    }

    const driverLogin = await request("/api/driver/auth/login", {
      method: "POST",
      body: {
        identifier: TEST_DRIVER.email,
        password: TEST_DRIVER.password,
      },
    });

    const driverToken = String(driverLogin.json?.token || "").trim();
    if (!driverLogin.ok || !driverToken) {
      fail(summary, `Driver login failed for ${TEST_DRIVER.email}.`);
    } else {
      pass(summary, `Driver login works for ${TEST_DRIVER.email}.`);

      const driverOrders = await request("/api/driver/orders", {
        headers: {
          Authorization: `Bearer ${driverToken}`,
        },
      });

      if (!driverOrders.ok || !driverOrders.json) {
        fail(summary, "Driver orders endpoint failed.");
      } else {
        const orderRows = Array.isArray(driverOrders.json.orders)
          ? (driverOrders.json.orders as Array<Record<string, unknown>>)
          : [];
        const currentOffer = driverOrders.json.currentOffer as Record<string, unknown> | null;
        const activeOrder = driverOrders.json.activeOrder as Record<string, unknown> | null;
        const includesSelfDelivery =
          String(currentOffer?.orderNumber || "") === TEST_ORDERS.selfDelivery ||
          String(activeOrder?.orderNumber || "") === TEST_ORDERS.selfDelivery ||
          orderRows.some((row) => String(row.orderNumber || "") === TEST_ORDERS.selfDelivery) ||
          orderRows.some(
            (row) =>
              String(
                row.deliveryMode ||
                  ((row.deliverySnapshot as { mode?: string | null } | undefined)?.mode || "") ||
                  ""
              ).trim() === "self_delivery"
          );

        if (includesSelfDelivery) {
          fail(summary, "Driver orders endpoint exposed a self_delivery order.");
        } else {
          pass(summary, "Driver orders endpoint does not expose the self_delivery test order.");
        }
      }
    }
  }

  console.log("");
  console.log(
    `Summary: ${summary.pass} PASS, ${summary.warn} WARN, ${summary.fail} FAIL`
  );

  if (summary.fail > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(
      `[FAIL] Smoke helper crashed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => null);
  });
