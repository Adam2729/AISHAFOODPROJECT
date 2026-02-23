# Aisha Food Backend Runbook

Operational guide for production/staging incidents and safe release checks.

## 1) Quick Triage
1. Confirm backend health:
   - `GET /api/health`
2. Check latest deploy and logs.
3. Identify blast radius:
   - Public ordering only
   - Merchant operations
   - Admin operations

## 2) Emergency Pause (Maintenance Mode)
Use when orders should be temporarily blocked.

### Toggle ON
`POST /api/admin/maintenance?key=ADMIN_KEY`
```json
{ "enabled": true }
```

Expected behavior:
- `POST /api/public/orders` -> `503` (`MAINTENANCE`)
- `PATCH /api/merchant/orders/:orderId` -> `503` (`MAINTENANCE`)
- Admin routes remain available.
- `GET /api/health` remains available.

### Toggle OFF
`POST /api/admin/maintenance?key=ADMIN_KEY`
```json
{ "enabled": false }
```

### Verify Effective State
`GET /api/admin/maintenance?key=ADMIN_KEY`

## 3) Post-Incident Smoke Validation
Run smoke checks after a fix or after disabling maintenance.

### Windows
```bash
npm run qa:smoke:win
```

### Linux/macOS
```bash
npm run qa:smoke
```

Smoke verifies:
1. Business creation
2. Merchant login
3. Product creation
4. Public order creation
5. Order status transitions to delivered
6. Settlement increment
7. Audit event (`ORDER_COUNTED`)

## 4) Settlement Integrity Checks
For current week:
1. `GET /api/admin/settlements?key=ADMIN_KEY`
2. Confirm `ordersCount` and `feeTotal` changed as expected.
3. Spot-check audit:
   - `GET /api/admin/audit?key=ADMIN_KEY&businessId=...&weekKey=YYYY-Www&limit=100`

If payout review needed:
- Export CSV:
  - `GET /api/admin/settlements/export?key=ADMIN_KEY&weekKey=YYYY-Www`

## 5) Merchant Onboarding v2 Checks
For new businesses:
1. Merchant login returns `mustChangePin: true`
2. Merchant is redirected to `/merchant/set-pin`
3. Merchant APIs blocked with `PIN_CHANGE_REQUIRED` until PIN update
4. After PIN update, merchant routes work normally

## 6) Safe Rollback Procedure
1. Turn maintenance ON.
2. Revert/rollback deploy to last known good version.
3. Confirm:
   - `/api/health` is OK
   - `npm run qa:smoke` passes
4. Turn maintenance OFF.
5. Monitor logs and settlement/audit events for 15-30 minutes.

## 7) Pre-Merge Release Checklist
1. `npm run lint`
2. `npx tsc --noEmit`
3. Smoke suite passes locally
4. PR CI smoke workflow passes
5. No env secret changes committed
6. Migration/index impact reviewed

## 8) Common Failures
### "ts-node is not recognized"
Use:
- `npm run qa:smoke:win`
It wraps the smoke run and does not rely on local `ts-node` PATH.

### "Unable to connect to remote server"
Backend is not running:
1. Terminal A: `npm run dev`
2. Terminal B: run smoke command

### Invalid `businessId` on admin audit URL
Ensure:
- 24-char ObjectId
- valid `weekKey` like `2026-W09`
- no malformed query string (extra quotes/typos)

## 9) Incident Documentation
When incident is resolved, fill:
- `INCIDENT_TEMPLATE.md`
- Quick create (Windows):
  - `npm run incident:new:win`
