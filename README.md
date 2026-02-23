<<<<<<< HEAD
# Aisha Food Backend

Next.js App Router backend for marketplace orders, merchant operations, settlements, and admin controls.

## Requirements
- Node.js 20+
- MongoDB

## Environment
Copy `.env.example` to `.env.local` and fill values:

```bash
cp .env.example .env.local
```

Required vars include:
- `MONGODB_URI`
- `ADMIN_KEY`
- `JWT_SECRET`
- `BASE_LOCATION_LAT`
- `BASE_LOCATION_LNG`

## Run Local
```bash
npm install
npm run dev
```

Server:
- Local: `http://localhost:3000`

## QA Smoke Suite
Runs end-to-end checks automatically:
- create business
- merchant login
- create product
- create public order
- transition order to delivered
- verify settlement + audit

Linux/macOS:
```bash
npm run qa:smoke
```

Windows:
```bash
npm run qa:smoke:win
```

Windows wrapper options:
```powershell
.\scripts\smokeSuite.ps1 -BaseUrl "http://localhost:3000"
.\scripts\smokeSuite.ps1 -SkipHealthCheck
```

## Merchant Onboarding v2
- New businesses are created with `auth.mustChange = true`.
- On first merchant login:
  - login response includes `mustChangePin: true`
  - UI redirects to `/merchant/set-pin`
  - merchant APIs return `PIN_CHANGE_REQUIRED` until PIN is updated.
- PIN update endpoint:
  - `POST /api/merchant/auth/set-pin`

## CI (PR Smoke)
GitHub Actions workflow:
- `.github/workflows/backend-smoke-pr.yml`

On pull requests affecting backend:
1. starts Mongo service
2. runs `npm run lint`
3. runs `npx tsc --noEmit`
4. starts backend
5. waits for `/api/health`
6. runs `npm run qa:smoke`

## Operations
- Incident and release procedure:
  - `RUNBOOK.md`
- Incident report template:
  - `INCIDENT_TEMPLATE.md`
- Create a new incident report (Windows):
  - `npm run incident:new:win`

## Useful Endpoints
- Health: `GET /api/health`
- Admin maintenance toggle: `GET/POST /api/admin/maintenance?key=...`
- Admin settlements: `GET /api/admin/settlements?key=...`
- Admin settlements CSV export: `GET /api/admin/settlements/export?key=...&weekKey=YYYY-Www`
- Admin audit by week: `GET /api/admin/audit?key=...&businessId=...&weekKey=YYYY-Www`
=======
# AishaFoodProject MVP (Marketplace)

Two codebases:

- `aisha-food-backend` (Next.js App Router + MongoDB/Mongoose + Admin/Merchant panels)
- `aisha-food-app` (Expo React Native mobile app)

## Business Rules Implemented

- Marketplace businesses: `restaurant` and `colmado`
- Customer coverage: max `8km` from server-side `BASE_LOCATION`
- Cash only payments
- Delivery fee to customer is always `0`
- Commission is `8%` of subtotal, stored for weekly collection
- Subscription: `RD$1,500/month`, first `90 days` trial
- Grace period: `14 days` after due date before suspension
- Weekly settlements with admin collect flow

## Backend Setup (`aisha-food-backend`)

1. Create `.env.local` from `.env.example`
2. Install deps: `npm install`
3. Run dev server: `npm run dev`
4. Optional checks:
   - `npm run lint`
   - `npx tsc --noEmit`

### Required env vars

- `MONGODB_URI`
- `ADMIN_KEY`
- `MERCHANT_AUTH_SECRET`
- `BASE_LOCATION_LAT`
- `BASE_LOCATION_LNG`

Optional:

- `MAX_RADIUS_KM` (default `8`)
- `COMMISSION_RATE_DEFAULT` (default `0.08`)
- `SUBSCRIPTION_MONTHLY_RDP` (default `1500`)
- `TRIAL_DAYS` (default `90`)
- `GRACE_DAYS` (default `14`)

## Mobile App Setup (`aisha-food-app`)

1. Ensure backend is running and reachable from phone/emulator.
2. Set API base URL in `src/lib/config.js`
3. Install deps: `npm install`
4. Run: `npm start` (or `npm run android` / `npm run ios`)
5. Optional TS check: `npx tsc --noEmit`

## Main API Endpoints

### Public

- `GET /api/public/businesses?lat=&lng=`
- `GET /api/public/businesses/:businessId/menu`
- `POST /api/public/orders`
- `GET /api/public/track?orderNumber=`

### Merchant

- `POST /api/merchant/auth/login`
- `GET /api/merchant/orders?status=`
- `PATCH /api/merchant/orders/:orderId`
- `GET /api/merchant/products`
- `POST /api/merchant/products`
- `PATCH /api/merchant/products/:productId`
- `DELETE /api/merchant/products/:productId`

### Admin (`?key=ADMIN_KEY`)

- `POST /api/admin/businesses?key=...`
- `GET /api/admin/businesses?key=...`
- `POST /api/admin/subscriptions/mark-paid?key=...`
- `GET /api/admin/settlements?key=...&weekKey=YYYY-Www`
- `POST /api/admin/settlements/collect?key=...`
- `GET /api/admin/metrics?key=...`

## Example cURL

Create business:

```bash
curl -X POST "http://localhost:3000/api/admin/businesses?key=YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type":"restaurant",
    "name":"Demo Restaurant",
    "phone":"8090000000",
    "address":"Santo Domingo",
    "lat":18.49,
    "lng":-69.94,
    "pin":"1234"
  }'
```

List businesses for app:

```bash
curl "http://localhost:3000/api/public/businesses?lat=18.49&lng=-69.94"
```

Create order:

```bash
curl -X POST "http://localhost:3000/api/public/orders" \
  -H "Content-Type: application/json" \
  -d '{
    "customerName":"Juan Perez",
    "phone":"8091234567",
    "address":"Ensanche Naco, Santo Domingo",
    "lat":18.48,
    "lng":-69.93,
    "businessId":"BUSINESS_OBJECT_ID",
    "items":[{"productId":"PRODUCT_OBJECT_ID","qty":2}]
  }'
```

Track order:

```bash
curl "http://localhost:3000/api/public/track?orderNumber=AFM-20260222-ABCDE"
```

## Web Panels

- Admin dashboard: `/admin?key=YOUR_ADMIN_KEY`
- Admin businesses: `/admin/businesses?key=YOUR_ADMIN_KEY`
- Admin settlements: `/admin/settlements?key=YOUR_ADMIN_KEY`
- Merchant login: `/merchant/login`
- Merchant orders: `/merchant/orders`
- Merchant products: `/merchant/products`

## Folder Highlights

Backend core:

- `aisha-food-backend/src/models/Business.ts`
- `aisha-food-backend/src/models/Product.ts`
- `aisha-food-backend/src/models/Order.ts`
- `aisha-food-backend/src/models/Settlement.ts`
- `aisha-food-backend/src/lib/constants.ts`
- `aisha-food-backend/src/lib/geo.ts`
- `aisha-food-backend/src/lib/money.ts`
- `aisha-food-backend/src/lib/merchantAuth.ts`
- `aisha-food-backend/src/lib/subscription.ts`

Mobile core:

- `aisha-food-app/src/screens/HomeScreen.js`
- `aisha-food-app/src/screens/BusinessScreen.js`
- `aisha-food-app/src/screens/CartScreen.js`
- `aisha-food-app/src/screens/CheckoutScreen.js`
- `aisha-food-app/src/screens/TrackScreen.js`
- `aisha-food-app/src/screens/ConfirmationScreen.js`
>>>>>>> 5360345 (Initial commit - Aisha Food Project)
