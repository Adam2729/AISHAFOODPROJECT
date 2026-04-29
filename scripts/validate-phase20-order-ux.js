const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function checkIncludes(filePath, expected, failures, description) {
  const source = read(filePath);
  if (!source.includes(expected)) {
    failures.push(`${description} (${filePath})`);
  }
}

function checkExcludes(filePath, unexpected, failures, description) {
  const source = read(filePath);
  if (source.includes(unexpected)) {
    failures.push(`${description} (${filePath})`);
  }
}

const failures = [];

checkExcludes(
  "aisha-food-app/src/screens/ConfirmationScreen.js",
  "orderNumber || orderId",
  failures,
  "Confirmation screen still falls back to raw internal order id"
);
checkExcludes(
  "aisha-food-app/src/screens/MyOrdersScreen.js",
  "item?.orderNumber || item?.orderId",
  failures,
  "My Orders screen still renders raw internal order ids"
);
checkExcludes(
  "aisha-food-app/src/screens/TrackScreen.js",
  "Identificador",
  failures,
  "Track screen still tells customers to use an internal identifier"
);
checkExcludes(
  "aisha-food-app/src/screens/TrackScreen.js",
  "{text.identifier}",
  failures,
  "Track screen still renders an internal identifier row"
);
checkExcludes(
  "aisha-food-app/src/screens/TrackScreen.js",
  "{activeOrderId}",
  failures,
  "Track screen still exposes the internal order id in customer UI"
);

[
  "aisha-food-app/src/screens/CheckoutScreen.js",
  "aisha-food-app/src/screens/ConfirmationScreen.js",
  "aisha-food-app/src/screens/TrackScreen.js",
  "aisha-food-app/src/screens/MyOrdersScreen.js",
].forEach((filePath) => {
  checkIncludes(
    filePath,
    "supportAvailability.configured",
    failures,
    "Support CTA is not gated when support is unconfigured"
  );
});

checkIncludes(
  "aisha-food-app/src/screens/ConfirmationScreen.js",
  "getVisibleDeliveryOtp",
  failures,
  "Confirmation screen does not mask or hide delivered OTP values"
);
checkIncludes(
  "aisha-food-app/src/screens/TrackScreen.js",
  "getVisibleDeliveryOtp",
  failures,
  "Tracking screen does not mask or hide delivered OTP values"
);
checkIncludes(
  "aisha-food-app/src/lib/orderPresentation.js",
  "awaitingCashConfirmation",
  failures,
  "Cash payment state mapping is missing awaiting cash confirmation"
);
checkIncludes(
  "aisha-food-app/src/lib/orderPresentation.js",
  "cashDueOnDelivery",
  failures,
  "Cash payment state mapping is missing cash due on delivery"
);
checkIncludes(
  "aisha-food-app/src/lib/orderPresentation.js",
  "deliveryConfirmed",
  failures,
  "Delivery wording helper is missing delivery confirmed"
);
checkIncludes(
  "aisha-food-app/src/lib/orderPresentation.js",
  "otpVerified",
  failures,
  "Delivery wording helper is missing OTP verified"
);
checkIncludes(
  "aisha-food-app/src/lib/orderPresentation.js",
  "otpFailed",
  failures,
  "Delivery wording helper is missing OTP failed state"
);

[
  "aisha-food-backend/src/app/merchant/orders/page.tsx",
  "aisha-food-backend/src/app/merchant/dashboard/page.tsx",
].forEach((filePath) => {
  checkIncludes(
    filePath,
    "getMerchantPaymentStatusLabel",
    failures,
    "Merchant surface is not using the shared payment status cleanup"
  );
});

checkIncludes(
  "aisha-food-backend/src/app/merchant/orders/page.tsx",
  "getMerchantDeliveryFinalizationLabel",
  failures,
  "Merchant orders page is not using unified delivery wording"
);

if (failures.length) {
  console.error("Phase 20 order UX validation failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Phase 20 order UX validation passed.");
