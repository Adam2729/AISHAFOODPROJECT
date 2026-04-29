# Deploy Backend - Launch Readiness

## Scope

Use this runbook for `aisha-food-backend`.

Current launch market: Bamako, Mali. Dominican Republic remains supported and should continue to work with the same delivery-model support.

## Required environment variables

Set these before production deploy:

- `MONGODB_URI`
- `ADMIN_KEY`
- `JWT_SECRET`
- `DRIVER_JWT_SECRET`
- `PII_HASH_SECRET`
- `STATEMENT_SIGNING_SECRET`
- `CRON_SECRET`
- `GOOGLE_MAPS_API_KEY`
- `PUBLIC_API_BASE_URL`
- `BASE_LOCATION_LAT`
- `BASE_LOCATION_LNG`
- `LAUNCH_CITY_CODE`
- `SUPPORT_WHATSAPP_E164`

Review carefully:

- `PUBLIC_API_ALLOWED_ORIGINS`
- `MULTICITY_ENABLE_BAMAKO`
- `DEV_ALLOW_ORDER_LOCATION_BYPASS`
- `ALLOW_SEED`
- `ALLOW_ADMIN_PAY_DISABLED_CITY`

## Launch-safe baseline

- `LAUNCH_CITY_CODE=BKO`
- `MULTICITY_ENABLE_BAMAKO=true`
- `DEV_ALLOW_ORDER_LOCATION_BYPASS=false`
- `ALLOW_SEED=false`
- `SUPPORT_WHATSAPP_E164` must be a real production number, not a placeholder
- both delivery models remain supported:
  - `self_delivery`
  - `platform_driver`

## Build and validation

From `aisha-food-backend`:

```powershell
npm install
npm run build
npm run qa:validate:bamako-launch
npm run qa:validate:prod-env
```

## Launch verification

After deploy, run:

```powershell
npm run qa:launch:verify
```

This checks:

- `/api/status`
- `/api/public/cities`
- `/api/public/restaurants`
- restaurant menu
- merchant application submission
- driver application submission
- delivery quote precheck
- `/api/admin/launch-context`

## Health checks

Replace the host with the real live API hostname:

```powershell
Invoke-WebRequest -UseBasicParsing https://YOUR-LIVE-API-HOST/api/health | Select-Object -ExpandProperty Content
Invoke-WebRequest -UseBasicParsing https://YOUR-LIVE-API-HOST/api/status | Select-Object -ExpandProperty Content
```

## Operator checks

- Start admin access from `/admin/access`.
- Open `/admin` and confirm the launch readiness snapshot shows:
  - launch city
  - support configured
  - public API base URL
  - delivery modes
  - maps/cron readiness
- Confirm Bamako city is active.
- Confirm launch smoke passes before opening traffic.
