# AISHAFOOD Audit Report (Baseline Before Multi-City)

Generated: 2026-02-27
Scope: audit-only snapshot of current state for `AishaFoodProject`.
Constraint followed: no logic changes, no refactor, no dependency changes.

## 1) Repo Overview

### Project layout detected
- `.github/`
- `aisha-food-backend/` (Next.js App Router + MongoDB/Mongoose)
- `aisha-food-app/` (Expo React Native)
- `README.md`

### Frameworks and key libs

#### Backend (`aisha-food-backend/package.json`)
- `next`: `16.1.6`
- `react`: `19.2.3`
- `mongoose`: `9.2.1`
- `nanoid`: `5.1.6`
- Present: TypeScript, ESLint, Tailwind tooling.
- Not present in dependencies: `next-auth`, `stripe`, `pusher`, `cloudinary`.

#### Mobile (`aisha-food-app/package.json`)
- `expo`: `~54.0.33`
- `react`: `19.1.0`
- `react-native`: `0.81.5`
- Navigation: `@react-navigation/native`, `native-stack`, `bottom-tabs`
- Persistence: `@react-native-async-storage/async-storage`

### Environment files and variables (names only)

#### Found env files
- `aisha-food-backend/.env.example`
- `aisha-food-backend/.env`
- `aisha-food-backend/.env.local`
- `aisha-food-app/.env.example`

#### Backend env contract (validated in `src/lib/env.ts`)
- Required runtime keys: `MONGODB_URI`, `ADMIN_KEY`, `JWT_SECRET`, `BASE_LOCATION_LAT`, `BASE_LOCATION_LNG`
- Core config keys: `MAX_RADIUS_KM`, `MAINTENANCE_MODE`, `DEV_ALLOW_ORDER_LOCATION_BYPASS`
- Commercial config keys: `COMMISSION_RATE_DEFAULT`, `SUBSCRIPTION_MONTHLY_RDP`, `TRIAL_DAYS`, `GRACE_DAYS`
- Promo/referral keys: `REFERRALS_ENABLED`, `REFERRAL_NEW_CUSTOMER_BONUS_RDP`, `REFERRAL_REFERRER_BONUS_RDP`, `PROMO_MAX_PERCENT`, `PROMO_MAX_FIXED_RDP`, `PROMO_CODE_MAX_LEN`
- Support/security keys: `SUPPORT_WHATSAPP_E164`, `SUPPORT_WHATSAPP_DEFAULT_TEXT`, `STATEMENT_SIGNING_SECRET`, `DRIVER_LINK_SECRET`, `PII_HASH_SECRET`, `PII_PHONE_RETENTION_DAYS`
- Also present in `.env.example`: `ALLOW_SEED`, `CRON_SECRET`, `PUBLIC_API_ALLOWED_ORIGINS`

#### Mobile env keys
- `.env.example` includes `API_BASE_URL`, `EXPO_PUBLIC_API_URL`
- Current app runtime uses hardcoded `src/lib/config.js` for API base URL (`API_BASE_URL = "http://192.168.0.11:3000"`)

## 2) Backend Audit (`aisha-food-backend`)

### API architecture
- Uses App Router API endpoints under `src/app/api/**`.
- No `src/pages/api` folder.
- Route count found: `127`
- Domain split by first path segment:
- `admin`: `78`
- `public`: `24`
- `merchant`: `19`
- `driver`: `3`
- `user`: `1`
- `health`: `1`
- `status`: `1`

### Model inventory (`src/models`)

#### Core commerce
- `Business`: merchant profile, geo point, open-hours, pause/busy controls, subscription, self-delivery policy.
- `Product`: menu items, availability, stock hints, text search index.
- `Order`: order core, settlement linkage, SLA timestamps, dispatch block, merchant rider block, delivery OTP proof block, delivery snapshot.
- `Customer`: phone-hash customer ledger, referral code, wallet credit, delivered counters.
- `User`: end-user profile (display name, city, language, marketing preference, cuisine prefs).
- `Review`: post-delivery reviews, moderation support.
- `Complaint`: complaint records with resolution workflow.
- `Favorite`: customer favorite businesses.

#### Finance and reconciliation
- `Settlement`, `SettlementAudit`, `SettlementPreview`
- `CashCollection`, `CashCollectionAudit`
- `DriverCashHandoff`, `DriverCashHandoffAudit`
- `StatementArchive`
- `FinanceAlert`

#### Dispatch and operations telemetry
- `Driver`, `DispatchAudit`
- `OpsEvent`
- `SearchEvent`, `FunnelEvent`

#### Promo/referral
- `Promo`, `PromoRedemption`, `PromoSpendEvent`

#### Reliability and platform safety
- `IdempotencyKey` (48h TTL)
- `RateLimitHit` (Mongo-backed window buckets)
- `BackupRun`
- `AppSetting`, `SystemSetting`

### Routes by business domain

#### Public customer routes (selected)
- Catalog/discovery: `/api/public/businesses`, `/api/public/businesses/[businessId]/menu`, `/api/public/menu`, `/api/public/search`, `/api/public/trending`, `/api/public/home-feed`
- Checkout/order lifecycle: `/api/public/orders`, `/api/public/track`, `/api/public/orders/history`, `/api/public/orders/reorder`
- Customer actions: `/api/public/reviews`, `/api/public/complaints`, `/api/public/favorites`, `/api/public/favorites/toggle`
- Cart intelligence: `/api/public/cart`, `/api/public/cart/upsell`, `/api/public/substitutions`, `/api/public/buy-again`
- Growth/attribution: `/api/public/funnel/event`, `/api/public/promo/validate`
- User session bootstrap: `/api/public/user/session`

#### Merchant routes (selected)
- Auth/session: `/api/merchant/auth/login`, `/api/merchant/auth/set-pin`
- Orders: `/api/merchant/orders`, `/api/merchant/orders/[orderId]`, `/api/merchant/orders/digest`
- Self-delivery ops: `/api/merchant/orders/[orderId]/assign-rider`, `/api/merchant/orders/[orderId]/dispatch-note`, `/api/merchant/orders/[orderId]/cash-received`
- Catalog/settings: `/api/merchant/products*`, `/api/merchant/business/settings`, `/api/merchant/business/busy`, `/api/merchant/menu-quality`
- Finance: `/api/merchant/cash-collections*`, `/api/merchant/statements/*`

#### Driver routes
- `/api/driver/orders`
- `/api/driver/orders/pickup`
- `/api/driver/orders/delivered`
- Auth model: tokenized link (`?token=`) via HMAC helper (`src/lib/driverLink.ts`), no full driver account auth.

#### Admin/Ops routes (selected)
- Ops center metrics and controls: `/api/admin/metrics`, `/api/admin/ops/*`, `/api/admin/audit`
- Business controls: `/api/admin/businesses*`, pause/health/performance/delivery-policy/audit
- Dispatch and driver ops: `/api/admin/dispatch/*`, `/api/admin/drivers`
- Driver cash handoff/disputes: `/api/admin/driver-cash*`
- Settlements and finance: `/api/admin/settlements*`, `/api/admin/cash-collections*`, `/api/admin/finance/*`, `/api/admin/statements/*`
- Reliability jobs: `/api/admin/jobs/*` including backup export, precompute jobs, PII redaction, anomaly scans
- Index verification: `/api/admin/indexes`

### Orders deep-check (requested areas)

#### Delivery/payment/status
- Status enum: `new`, `accepted`, `preparing`, `ready`, `out_for_delivery`, `delivered`, `cancelled`
- Payment method in schema: `payment.method` enum only `cash`
- Settlement counting is tied to merchant transition to `delivered`.
- Financial immutability guards exist after delivery/counting.

#### Proof-of-delivery
- `order.deliveryProof` exists with OTP hash-only storage:
- `required`, `otpHash`, `otpLast4`, `otpCreatedAt`, `verifiedAt`, `verifiedBy`
- Merchant `PATCH /api/merchant/orders/[orderId]` enforces OTP verification before delivered (with expiry check).
- Admin override endpoint exists: `/api/admin/orders/delivery-override`.

#### Dispatch/self-delivery fields
- `order.dispatch`: assigned driver, pickup/delivered driver confirmations, cash collected flag, handoff note.
- `order.merchantDelivery`: rider name/phone/assignedAt (merchant-managed, not public).
- `order.deliverySnapshot`: self-delivery mode snapshot and customer-facing note.

### Payments audit
- Current live method is cash-only.
- No Stripe/mobile-money integration found.
- Fee/commission and settlement accounting are present and mature.

### Dispatch/driver audit
- Driver model and assignment endpoints exist.
- Driver link-token auth exists (HMAC token query param).
- Driver can confirm pickup/delivered and cash collection evidence.
- Driver-cash handoff ledger + dispute lifecycle exists.
- Note: this coexists with self-delivery messaging and merchant rider assignment.

### Ops/admin capability audit
- Ops UI (`/admin/ops`) includes panels for reliability, settlements, cash reconciliation, finance mismatches/alerts, search/funnel/reputation, dispatch.
- Backup run history and `/api/status` surfaced in ops.
- Settlement previews and recompute workflows exist.
- Complaints/review moderation and audit trails exist.

### Geo/delivery audit
- Geo checks use haversine from a single base location + max radius.
- Business location and customer coordinates are stored.
- Public order creation enforces in-cluster checks and optional geocoding.
- No explicit per-city delivery zone model or city-level fee rules.
- No dedicated `DeliveryZone` model found.

## 3) Mobile Audit (`aisha-food-app`)

### Navigation and screens
- Bottom tabs: `Home`, `Search`, `Cart`, `Orders`, `Profile`
- Stack routes: `ItemDetails`, `Checkout`, `Track`, `Business`, `Confirmation`, `MyOrders`
- Screen files present (`11`): `HomeScreen`, `SearchScreen`, `BusinessScreen`, `ItemDetailsScreen`, `CartScreen`, `CheckoutScreen`, `TrackScreen`, `ConfirmationScreen`, `OrdersScreen`, `MyOrdersScreen`, `ProfileScreen`

### API client and base URL
- API helpers in `src/lib/api.js` with timeout + error normalization.
- Base URL is hardcoded in `src/lib/config.js`.
- `.env.example` exists but not currently used as runtime source in mobile code.

### Persistence and client-side UX resilience
- Cart persisted via AsyncStorage (`aisha_market_cart_v1`).
- Menu cache via AsyncStorage with 10-minute TTL (`menu_cache_v1`).
- Saved customer profile in AsyncStorage (`aisha_saved_customer`).
- User profile sync via backend user-session + `/api/user/profile`.

### Checkout flow payload and behavior
- Checkout posts to `/api/public/orders` with customer identity, address, optional lat/lng, businessId, items, promo, attribution, sessionId.
- App uses cash-first UX and self-delivery copy.
- Confirmation and Track screens display delivery OTP and verification states.
- Complaints/reviews/reorder and WhatsApp support shortcuts are integrated.

### Mobile gaps found
- `SearchScreen` is placeholder (`Pantalla de busqueda en construccion`).
- City is currently effectively fixed to Santo Domingo in checkout save payload (`city: "Santo Domingo"`).

## 4) What Is Done (Current Capabilities)
- End-to-end cash ordering and settlement accounting.
- Strong delivery integrity controls: OTP proof, settlement immutability, override auditing.
- Merchant operations: order state machine, product availability/bulk controls, statements.
- Ops center with finance, trust, funnel/search telemetry, complaints, dispatch, reliability panels.
- Mongo-backed idempotency for order creation and persistent rate limits for key public routes.
- Backup export job tracking and cron schedule.
- Self-delivery policy exposed publicly with support disclaimers.
- Driver dispatch and driver cash handoff/dispute mechanisms already present.
- Mobile supports core ordering, tracking, support, favorites, buy-again, complaints, reviews.

## 5) Missing, Broken, or Risky for Multi-City

### Blocking gaps
- No `City` model and no `cityId` linkage on `Business`, `Order`, `Settlement`, `Customer`.
- Geo logic is single-cluster (`BASE_LOCATION` + `MAX_RADIUS_KM`) and not city-scoped.
- Currency is effectively hardcoded to DOP in backend/admin/mobile formatting.
- Payment method model is cash-only and not city-configurable.
- Delivery fee model is not city-aware (currently free delivery to customer).

### Risky inconsistencies
- Self-delivery policy and driver-dispatch system currently coexist; clear product policy boundary is required before multi-city rollout.
- Mobile API base URL is hardcoded; environment-based switching is incomplete.
- Public order payload accepts `city` but backend still resolves against DR defaults and single base cluster.
- Some rate limiting still uses in-memory helper (`requestRateLimit`) for public user session endpoint.

### Operational risk
- City-specific support numbers, SLA targets, commission policies, promo budgets, and pilot/maintenance controls are not partitioned by city.
- Existing analytics and ops aggregates are mostly global/week-based, not city segmented.

## 6) Multi-City Readiness Assessment (No Implementation)

### Readiness score: **34 / 100**

### Checklist scoring
- City data model and foreign keys (`cityId` on business/order/user/finance): **20% ready**
- City-based currency and commercial config: **25% ready**
- Payment methods by city: **10% ready**
- Delivery fee model by city: **10% ready**
- Rider/self-delivery model by city: **45% ready**
- Mobile city selection (manual first): **30% ready**
- Ops and observability segmented by city: **35% ready**

### Top blockers to resolve first
- Introduce first-class `City` domain and backfill references safely.
- Move geo validation from single base radius to city-specific geofencing.
- Decouple currency and money formatting from fixed `DOP` assumptions.
- Define city policy matrices for commission, payment methods, and delivery fee rules.
- Add explicit city context propagation in API contracts and analytics pipelines.

## 7) Safe Next Steps (Phased, Non-Breaking for Santo Domingo)

### Phase 0: Guardrails and freeze
- Add baseline integration tests/smokes specifically around order create, delivered transition, settlement counting, OTP verification.
- Keep Santo Domingo as default city fallback to avoid immediate behavior changes.

### Phase 1: City foundation (additive)
- Create `City` model and seed Santo Domingo as primary.
- Add nullable `cityId` on Business/Order/Settlement/User with dual-read fallback to existing behavior.
- Add admin city management endpoint/UI read-only first.

### Phase 2: Geo and policy partitioning
- Replace global base-radius checks with city-scoped coverage config.
- Introduce city-level policy config object: currency, commission default, payment methods, delivery fee model.
- Keep legacy defaults mapped to Santo Domingo.

### Phase 3: Contract evolution
- Public and merchant APIs accept/return city context explicitly.
- Add per-city ops filtering and metrics dimensions.
- Preserve backward compatibility by defaulting missing city to Santo Domingo.

### Phase 4: Mobile rollout (manual city selector)
- Add startup/manual city selector persisted locally.
- Route all list/menu/checkout calls with selected city.
- Replace hardcoded API host config with environment-aware base URL strategy.

### Phase 5: Bamako activation
- Seed Bamako config (coverage, currency, policy, support channels).
- Soft-launch via feature flag and city allowlist.
- Observe city-specific KPIs and incident runbook for first week.

## 8) Final Snapshot Summary
- Platform is operationally mature for single-city cash marketplace with strong ops/finance controls.
- Multi-city is feasible without rewrite, but requires a deliberate data-contract and config partition layer first.
- Immediate implementation should start with additive city primitives and compatibility shims, not direct behavior flips.