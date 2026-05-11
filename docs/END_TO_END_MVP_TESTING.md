# OranjeEats End-to-End MVP Testing

Use this checklist to verify the full MVP flow locally:

- customer order
- merchant accepts
- merchant marks ready
- auto driver offer
- driver accepts
- tracking updates
- delivered
- payments and performance update

## 1. Backend Startup

From `aisha-food-backend/`:

```bash
npm install
npm run dev
```

Optional smoke helper:

```bash
npm run smoke:e2e-mvp
```

## 2. Seed Commands

Run both seeds. They are idempotent.

```bash
npm run seed:merchant-mvp
npm run seed:driver-dispatch-mvp
```

What they provide:

- merchant: `OranjeEats Test Kitchen`
- merchant credentials:
  - email: `merchant@test.oranjeeats.com`
  - phone: `+22370000001`
  - password: `Password123!`
- driver: `OranjeEats Test Driver`
- driver credentials:
  - email: `driver@test.oranjeeats.com`
  - phone: `+22370000002`
  - password: `Password123!`
- dispatch test orders:
  - `DDMVP-BKO-PREPARING`
  - `DDMVP-BKO-READY`
  - `DDMVP-BKO-SELFDELIVERY`

## 3. Required .env Setup

Do not use `localhost` or `127.0.0.1` for mobile testing. Use your computer network IP.

### Backend

`aisha-food-backend/.env.local`

Required minimum:

- `MONGODB_URI=...`
- `ADMIN_KEY=...`
- `JWT_SECRET=...`
- `BASE_LOCATION_LAT=...`
- `BASE_LOCATION_LNG=...`

Optional for PayTech test:

- `PAYTECH_API_KEY=...`
- `PAYTECH_SECRET_KEY=...`
- `PAYTECH_WEBHOOK_SECRET=...`
- `PAYTECH_SUCCESS_URL=...`
- `PAYTECH_CANCEL_URL=...`

### Customer App

`aisha-food-app/.env`

```bash
EXPO_PUBLIC_API_URL=http://YOUR_LOCAL_IP:3000
```

### Merchant App

`aisha-food-merchant-app/.env`

```bash
EXPO_PUBLIC_API_URL=http://YOUR_LOCAL_IP:3000
```

### Driver App

`aisha-food-driver-app/.env`

```bash
EXPO_PUBLIC_API_URL=http://YOUR_LOCAL_IP:3000
```

## 4. Merchant Credentials

- email: `merchant@test.oranjeeats.com`
- phone: `+22370000001`
- password: `Password123!`

## 5. Driver Credentials

- email: `driver@test.oranjeeats.com`
- phone: `+22370000002`
- password: `Password123!`

## 6. Customer Test Flow

Use this for a real app-to-app order flow.

1. Open the customer app.
Expected:
- app loads without API errors
- Bamako can be selected
- restaurant menu and product images load

2. Select Bamako and open `OranjeEats Test Kitchen`.
Expected:
- restaurant and seeded products are visible

3. Add products to cart and go to checkout.
Expected:
- totals display in FCFA/XOF
- payment methods for Bamako include cash and PayTech-backed mobile money options

4. Place a cash order.
Expected:
- order is created
- confirmation/tracking screen opens
- merchant app receives the order on refresh/polling

5. In merchant app, accept the order.
Expected:
- order moves to `accepted`
- customer tracking updates after polling

6. In merchant app, mark the order `preparing`, then `ready`.
Expected:
- when marked `ready` and delivery mode is `platform_driver`, driver auto dispatch starts
- driver app receives full-screen incoming offer

7. In driver app, accept the offer.
Expected:
- active delivery screen opens
- merchant order shows assigned driver
- customer tracking shows driver info when available

8. In driver app, complete:
- `Arrived at Restaurant`
- `Picked Up`
- `Delivered`

Expected:
- customer tracking updates through the stages
- merchant order reflects the delivery progress
- final order status becomes delivered
- driver earnings update
- merchant performance and settlement-related views update after refresh

## 7. PayTech Test Flow

Use this only if local PayTech env is configured.

1. In customer app, create an order and choose:
- `Wave`
- `Orange Money Mali`
- `Moov Money Mali`

2. Tap pay/confirm.
Expected:
- order enters `pending_payment`
- customer sees `Paiement en attente`
- app opens hosted PayTech page

3. Complete the payment in PayTech test mode.
Expected:
- webhook confirms payment
- order `paymentStatus` becomes `paid`
- order status moves from `pending_payment` to `new`
- merchant then sees the order
- dispatch does not start before webhook success

If PayTech env is missing:
- payment flow should be treated as not fully testable locally
- use cash or WhatsApp fallback for general MVP validation

## 8. WhatsApp Fallback Test Flow

1. In customer app, add products to cart.
2. Tap `Commander par WhatsApp`.
Expected:
- WhatsApp deep link opens
- prefilled order message includes:
  - restaurant
  - items
  - quantities
  - prices
  - total
  - address
  - payment method if selected

This path should remain available even if PayTech is not configured.

## 9. Seeded Dispatch Shortcut

Use this when you want to test dispatch without placing a fresh customer order.

1. Login to merchant app with the seeded merchant.
2. Login to driver app with the seeded driver.
3. Set the driver online.
4. Open order `DDMVP-BKO-PREPARING`.
5. Mark it `ready`.
Expected:
- backend offers the order to the nearest available online driver
- driver app shows incoming offer with countdown

6. Accept the offer in the driver app.
Expected:
- active delivery opens
- merchant and customer tracking reflect the assigned driver

7. Confirm `DDMVP-BKO-SELFDELIVERY` never appears in the driver app.
Expected:
- no self-delivery order in driver offers
- no self-delivery order in driver active feed

## 10. Expected Results by Stage

### Customer order created
- merchant can see the order
- customer tracking can locate the order

### Merchant accepted
- merchant order status updates immediately
- customer tracking updates after polling

### Merchant marked ready
- only `platform_driver` orders enter auto dispatch
- `self_delivery` stays out of driver dispatch

### Driver offer appears
- driver sees orange incoming offer modal
- countdown runs locally
- reject returns order to next-driver/manual-dispatch path

### Driver accepted
- active delivery screen opens
- merchant view shows driver location/status when available

### Delivered
- final status is delivered
- driver earnings update
- merchant performance figures update after refresh

## 11. Common Errors and Fixes

### Mobile app cannot connect to backend
Cause:
- `EXPO_PUBLIC_API_URL` points to `localhost` or wrong IP

Fix:
- use `http://YOUR_LOCAL_IP:3000`
- ensure phone and computer are on the same network

### Seeded accounts cannot login
Cause:
- seed not run
- backend using different MongoDB than expected

Fix:
- rerun:
```bash
npm run seed:merchant-mvp
npm run seed:driver-dispatch-mvp
```

### Driver does not receive offer
Cause:
- driver is offline
- order not marked `ready`
- order is `self_delivery`
- backend HTTP/API not reachable from driver app
- no fresh driver location

Fix:
- set driver online
- use `DDMVP-BKO-PREPARING` and mark it `ready`
- confirm order delivery mode is `platform_driver`
- confirm `EXPO_PUBLIC_API_URL` is correct

### Customer sees `Paiement en attente` forever
Cause:
- PayTech webhook not configured or not reaching backend

Fix:
- verify `PAYTECH_WEBHOOK_SECRET`
- verify hosted PayTech callback configuration
- verify backend public URL for webhook

### Merchant products/orders API fails in app
Cause:
- merchant auth session/token issue

Fix:
- login again
- run `npm run smoke:e2e-mvp` to verify backend login and merchant endpoints

### Driver app shows no orders at all
Cause:
- only `self_delivery` test data exists in app view
- driver is not online
- dispatch test order was not moved to `ready`

Fix:
- use `DDMVP-BKO-PREPARING`
- mark it `ready`
- verify seeded driver credentials

## 12. Recommended Local Verification Order

1. Start backend
2. Run both seed commands
3. Run `npm run smoke:e2e-mvp`
4. Start merchant app
5. Start driver app
6. Start customer app
7. Run cash order flow
8. Run dispatch shortcut flow
9. Run PayTech test flow if env is configured
10. Run WhatsApp fallback flow
