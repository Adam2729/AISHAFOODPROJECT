# OranjeEats Launch Checklist

## Backend Env Checklist
- Set `MONGODB_URI`, `ADMIN_KEY`, `JWT_SECRET`, `DRIVER_JWT_SECRET`, `STATEMENT_SIGNING_SECRET`, `PII_HASH_SECRET`, `CRON_SECRET`.
- Set `PUBLIC_API_BASE_URL` to the live HTTPS backend URL.
- Set `PUBLIC_API_ALLOWED_ORIGINS` for the customer, merchant, and driver apps.
- Keep `DEV_ALLOW_ORDER_LOCATION_BYPASS=false` for live operations.
- Keep `ALLOW_SEED=false` in production.
- Set `GOOGLE_MAPS_API_KEY` before live location/map testing.

## PayTech Webhook Checklist
- Set `PAYTECH_API_KEY`, `PAYTECH_SECRET_KEY`, `PAYTECH_WEBHOOK_SECRET`.
- Set `PAYTECH_SUCCESS_URL` and `PAYTECH_CANCEL_URL` to public HTTPS URLs.
- Confirm PayTech is in the intended mode with `PAYTECH_MODE`.
- Verify `/api/webhooks/paytech` is publicly reachable.
- Run one test payment and confirm `pending_payment -> paid -> new` flow works.

## Customer App Checklist
- Set `EXPO_PUBLIC_API_URL` to the computer network IP, not `localhost`.
- Confirm Bamako payment methods show Mali-compatible labels.
- Confirm PayTech checkout opens hosted payment.
- Confirm `Paiement en attente` shows before webhook success.
- Confirm tracking refreshes after payment success and on app foreground.

## Merchant App Checklist
- Set `EXPO_PUBLIC_API_URL` to the computer network IP, not `localhost`.
- Confirm merchant login works with stored session restore.
- Confirm adaptive polling switches between fast, default, and slow modes.
- Confirm live indicator, last-updated label, and slow-connection banner render.
- Confirm order details show driver handoff state for `platform_driver`.
- Confirm menu, payouts, and performance views load on weak mobile data.

## Driver App Checklist
- Set `EXPO_PUBLIC_API_URL` to the computer network IP, not `localhost`.
- Confirm driver login works with approved credentials.
- Confirm active-order refresh speeds up during delivery.
- Confirm location updates post while online or on delivery.
- Confirm `self_delivery` orders never appear in the driver flow.

## Domain Checklist
- Point customer, merchant, and backend domains to the right deployment targets.
- Confirm SSL certificates are valid.
- Confirm PayTech callbacks use the final public domain.

## Vercel Checklist
- Set backend project root to `aisha-food-backend/`.
- Configure all backend env vars in the Vercel project.
- Confirm the build uses the current lockfile and package root.
- Verify cron and webhook routes are not cached.

## MongoDB Checklist
- Confirm the production cluster is reachable from the deployment environment.
- Confirm indexes exist for orders, drivers, dispatch offers, and notification events.
- Confirm backups and retention are enabled.

## Google Maps Checklist
- Add the production Maps key.
- Verify customer tracking, merchant driver visibility, and driver map routes use the key.
- Confirm quota and billing are enabled.

## WhatsApp Checklist
- Set `WHATSAPP_PROVIDER`, `WHATSAPP_API_TOKEN`, and `WHATSAPP_FROM_NUMBER` when the provider is ready.
- Until then, confirm notification events log cleanly without blocking order flow.
- Validate event coverage for order confirmed, driver assigned, on the way, delivered, and payout paid.

## Bamako Test Order Checklist
- Customer places a Bamako PayTech order with a valid `+223` number.
- Webhook marks payment paid.
- Merchant sees the order move from `pending_payment` to active operations.
- Driver receives/accepts the order and location updates flow.
- Customer tracking updates every few seconds without WebSockets.

## Rollback Plan
- Disable new mobile deployments and keep the previous Expo builds available.
- Revert backend deployment to the last known-good commit if order status or dispatch flow regresses.
- If PayTech issues occur, leave cash and WhatsApp fallback enabled while disabling the PayTech option in city config.
- If polling causes load issues, raise intervals before introducing any new transport layer.
