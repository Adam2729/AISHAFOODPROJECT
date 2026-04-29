/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");

function loadEnvForScript() {
  const localPath = path.resolve(process.cwd(), ".env.local");
  const envPath = path.resolve(process.cwd(), ".env");

  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile(localPath);
    process.loadEnvFile(envPath);
    return;
  }

  try {
    const dotenv = require("dotenv");
    dotenv.config({ path: localPath });
    dotenv.config({ path: envPath });
  } catch {
    // env may already be loaded
  }
}

loadEnvForScript();

const baseUrl = String(process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const adminKey = String(process.env.ADMIN_KEY || "").trim();

if (!adminKey) {
  console.error("Missing ADMIN_KEY env var.");
  process.exit(1);
}

function randomLabel(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function parseCookieHeader(setCookie) {
  if (!setCookie) return "";
  const first = String(setCookie).split(",")[0];
  return first.split(";")[0].trim();
}

async function requestJson(pathname, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (options.cookie) headers.Cookie = options.cookie;

  const res = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  return { res, json, text };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function createMerchantSession(namePrefix) {
  const pin = "1234";
  const createdBusiness = await requestJson(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      type: "restaurant",
      name: randomLabel(namePrefix),
      phone: "22370002011",
      whatsapp: "22370002011",
      address: "ACI 2000, Bamako",
      lat: 12.6392,
      lng: -8.0029,
      pin,
    },
  });
  assert(createdBusiness.res.status === 201, `Business creation failed: ${createdBusiness.text}`);
  const businessId = String(createdBusiness.json?.business?._id || "");
  assert(businessId, "Business ID missing.");

  const loginRes = await fetch(`${baseUrl}/api/merchant/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessId, pin }),
  });
  const loginJson = await loginRes.json().catch(() => null);
  assert(loginRes.ok, "Merchant login failed.");
  let merchantCookie = parseCookieHeader(loginRes.headers.get("set-cookie"));
  assert(merchantCookie, "Merchant session cookie missing.");

  if (Boolean(loginJson?.mustChangePin)) {
    const newPin = "5678";
    const setPin = await requestJson("/api/merchant/auth/set-pin", {
      method: "POST",
      cookie: merchantCookie,
      body: { newPin, confirmPin: newPin },
    });
    assert(setPin.res.ok, "Initial PIN change failed.");

    const relogin = await fetch(`${baseUrl}/api/merchant/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId, pin: newPin }),
    });
    assert(relogin.ok, "Merchant re-login after PIN change failed.");
    merchantCookie = parseCookieHeader(relogin.headers.get("set-cookie"));
    assert(merchantCookie, "Merchant session cookie missing after PIN change.");
  }

  return { businessId, merchantCookie };
}

async function createProduct(cookie, namePrefix) {
  const createdProduct = await requestJson("/api/merchant/products", {
    method: "POST",
    cookie,
    body: {
      name: randomLabel(namePrefix),
      price: 3200,
      category: "Plats",
      isAvailable: true,
    },
  });
  assert(createdProduct.res.status === 201, `Product creation failed: ${createdProduct.text}`);
  const productId = String(createdProduct.json?.product?._id || "");
  assert(productId, "Product ID missing.");
  return productId;
}

async function createOrder(businessId, productId, phoneSuffix) {
  const createdOrder = await requestJson("/api/public/orders", {
    method: "POST",
    body: {
      customerName: "Smoke Ops Customer",
      phone: `22370002${phoneSuffix}`,
      address: "Hamdallaye ACI, Bamako",
      lat: 12.6394,
      lng: -8.0031,
      businessId,
      items: [{ productId, qty: 1 }],
    },
  });
  assert(createdOrder.res.status === 201, `Order create failed: ${createdOrder.text}`);
  return String(createdOrder.json?.orderNumber || "");
}

async function findOrder(cookie, orderNumber) {
  const orders = await requestJson("/api/merchant/orders", { cookie });
  assert(orders.res.ok && orders.json?.ok, `Merchant orders failed: ${orders.text}`);
  const rows = Array.isArray(orders.json?.orders) ? orders.json.orders : [];
  const match = rows.find((row) => String(row?.orderNumber || "") === orderNumber);
  assert(match?._id, `Order ${orderNumber} not found.`);
  return match;
}

async function updateOrderStatus(cookie, orderId, status, extraBody = {}) {
  return requestJson(`/api/merchant/orders/${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    cookie,
    body: {
      status,
      ...extraBody,
    },
  });
}

async function setPlatformDriverBusiness(businessId) {
  const response = await requestJson(
    `/api/admin/businesses/delivery-policy?key=${encodeURIComponent(adminKey)}`,
    {
      method: "PATCH",
      body: {
        businessId,
        mode: "platform_driver",
      },
    }
  );
  assert(response.res.ok, `Delivery policy update failed: ${response.text}`);
}

async function main() {
  console.log(`Running merchant order ops smoke against ${baseUrl}`);

  const health = await requestJson("/api/health");
  assert(health.res.ok, "Health check failed.");

  await requestJson(`/api/admin/maintenance?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: { enabled: false },
  });

  const selfDelivery = await createMerchantSession("MerchantOpsSelf");
  const selfProductId = await createProduct(selfDelivery.merchantCookie, "MerchantOpsSelfProduct");
  const selfOrderNumber = await createOrder(selfDelivery.businessId, selfProductId, "21");
  const selfOrder = await findOrder(selfDelivery.merchantCookie, selfOrderNumber);
  const selfOrderId = String(selfOrder._id || "");

  const earlyCash = await requestJson(
    `/api/merchant/orders/${encodeURIComponent(selfOrderId)}/cash-received`,
    {
      method: "POST",
      cookie: selfDelivery.merchantCookie,
      body: { confirm: "RECEIVED" },
    }
  );
  assert(earlyCash.res.status === 409, "Cash confirmation should fail before delivery proof.");

  const assignOwnDriver = await requestJson(
    `/api/merchant/orders/${encodeURIComponent(selfOrderId)}/assign-rider`,
    {
      method: "PATCH",
      cookie: selfDelivery.merchantCookie,
      body: {
        riderName: "Own Driver",
        riderPhone: "22370009001",
      },
    }
  );
  assert(assignOwnDriver.res.ok, "Self-delivery rider assignment should succeed.");

  const issueReport = await requestJson(
    `/api/merchant/orders/${encodeURIComponent(selfOrderId)}/issue`,
    {
      method: "POST",
      cookie: selfDelivery.merchantCookie,
      body: {
        issueType: "customer_not_answering",
        note: "Customer delayed pickup response",
      },
    }
  );
  assert(issueReport.res.ok, "Issue reporting failed.");

  const issueOrder = await findOrder(selfDelivery.merchantCookie, selfOrderNumber);
  const latestIssue = Array.isArray(issueOrder.merchantIssues) && issueOrder.merchantIssues.length
    ? issueOrder.merchantIssues[issueOrder.merchantIssues.length - 1]
    : null;
  assert(
    String(latestIssue?.issueType || "") === "customer_not_answering",
    "Latest issue type did not persist."
  );

  for (const status of ["accepted", "preparing", "ready", "out_for_delivery"]) {
    const step = await updateOrderStatus(selfDelivery.merchantCookie, selfOrderId, status);
    assert(step.res.ok, `Self-delivery status ${status} failed: ${step.text}`);
  }

  const deliveryOverride = await requestJson(
    `/api/admin/orders/delivery-override?key=${encodeURIComponent(adminKey)}`,
    {
      method: "POST",
      body: {
        orderId: selfOrderId,
        confirm: "OVERRIDE",
        resolvedBy: "Smoke Ops",
        note: "Smoke delivered override",
      },
    }
  );
  assert(deliveryOverride.res.ok, `Delivery override failed: ${deliveryOverride.text}`);

  const cashConfirmed = await requestJson(
    `/api/merchant/orders/${encodeURIComponent(selfOrderId)}/cash-received`,
    {
      method: "POST",
      cookie: selfDelivery.merchantCookie,
      body: { confirm: "RECEIVED", note: "Merchant received cash at handoff" },
    }
  );
  assert(cashConfirmed.res.ok, `Cash confirmation failed: ${cashConfirmed.text}`);
  assert(
    String(cashConfirmed.json?.payment?.status || "") === "paid",
    "Cash confirmation did not set payment status to paid."
  );

  const duplicateCash = await requestJson(
    `/api/merchant/orders/${encodeURIComponent(selfOrderId)}/cash-received`,
    {
      method: "POST",
      cookie: selfDelivery.merchantCookie,
      body: { confirm: "RECEIVED" },
    }
  );
  assert(duplicateCash.res.status === 409, "Duplicate cash confirmation should fail.");

  const adjustment = await requestJson(
    `/api/admin/orders/${encodeURIComponent(selfOrderId)}/adjustments?key=${encodeURIComponent(adminKey)}`,
    {
      method: "POST",
      body: {
        adjustmentType: "refund",
        amount: 250,
        reason: "Smoke goodwill refund",
        note: "Recorded without touching order totals",
        createdBy: "Smoke Ops",
      },
    }
  );
  assert(adjustment.res.ok, `Adjustment recording failed: ${adjustment.text}`);

  const adjustedOrder = await findOrder(selfDelivery.merchantCookie, selfOrderNumber);
  assert(
    Number(adjustedOrder.total || 0) === Number(selfOrder.total || 0),
    "Adjustment should not change the historical order total."
  );

  const cancelOrderNumber = await createOrder(selfDelivery.businessId, selfProductId, "22");
  const cancelOrder = await findOrder(selfDelivery.merchantCookie, cancelOrderNumber);
  const cancelOrderId = String(cancelOrder._id || "");

  const cancelWithoutReason = await requestJson(
    `/api/merchant/orders/${encodeURIComponent(cancelOrderId)}`,
    {
      method: "PATCH",
      cookie: selfDelivery.merchantCookie,
      body: { status: "cancelled" },
    }
  );
  assert(cancelWithoutReason.res.status === 400, "Cancellation should require a reason.");

  const cancelWithReason = await requestJson(
    `/api/merchant/orders/${encodeURIComponent(cancelOrderId)}`,
    {
      method: "PATCH",
      cookie: selfDelivery.merchantCookie,
      body: {
        status: "cancelled",
        cancelReasonCode: "item_unavailable",
        cancelNote: "Sold out after first live test",
      },
    }
  );
  assert(cancelWithReason.res.ok, `Cancellation with reason failed: ${cancelWithReason.text}`);
  assert(
    String(cancelWithReason.json?.order?.cancellation?.reason || "") === "item_unavailable",
    "Structured cancellation reason did not persist."
  );

  const platformDriver = await createMerchantSession("MerchantOpsPlatform");
  await setPlatformDriverBusiness(platformDriver.businessId);
  const platformProductId = await createProduct(platformDriver.merchantCookie, "MerchantOpsPlatformProduct");
  const platformOrderNumber = await createOrder(platformDriver.businessId, platformProductId, "23");
  const platformOrder = await findOrder(platformDriver.merchantCookie, platformOrderNumber);
  const platformOrderId = String(platformOrder._id || "");

  assert(
    String(platformOrder.deliveryMode || "") === "platform_driver",
    "Platform-driver order should expose platform_driver deliveryMode."
  );

  const platformRiderAssign = await requestJson(
    `/api/merchant/orders/${encodeURIComponent(platformOrderId)}/assign-rider`,
    {
      method: "PATCH",
      cookie: platformDriver.merchantCookie,
      body: {
        riderName: "Should Fail",
        riderPhone: "22370009009",
      },
    }
  );
  assert(
    platformRiderAssign.res.status === 409,
    "Platform-driver order should reject self-delivery rider assignment."
  );

  console.log("Merchant order ops smoke passed.");
  console.log(
    JSON.stringify(
      {
        selfDeliveryBusinessId: selfDelivery.businessId,
        platformDriverBusinessId: platformDriver.businessId,
        selfOrderId,
        cancelOrderId,
        platformOrderId,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    "Merchant order ops smoke failed:",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
