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

## 10) Idempotency (Order Create)
- Endpoint: `POST /api/public/orders`
- Header or body key:
  - `Idempotency-Key: <client-generated-unique-key>`
  - or `idempotencyKey` in JSON body
- Behavior:
  1. First request with key processes normally.
  2. Subsequent request with same key returns the exact stored response (`statusCode` + `body`).
  3. If first request is still running, API returns `409 IDEMPOTENCY_IN_PROGRESS`.

### Smoke Test
- Windows:
  - `npm run qa:smoke:idempotency:win`
- Linux/macOS:
  - `npm run qa:smoke:idempotency`

## 11) Backup Export Job (Ops + Cron)
### Manual Run (Admin)
- `POST /api/admin/jobs/backup-export?key=ADMIN_KEY`
- Optional payload:
```json
{
  "kind": "all",
  "sinceDays": 7
}
```
Where:
- `kind`: `orders` | `settlements` | `cashCollections` | `all`
- `sinceDays`: default `7`, max `30`

### Cron Run (Secured)
- `GET /api/admin/jobs/backup-export?kind=all&sinceDays=7`
- Auth:
  - `Authorization: Bearer <CRON_SECRET>`
  - or `x-cron-secret: <CRON_SECRET>`

### Artifacts
- JSONL files are written under `/tmp/aisha-backups/<runId>/`
- Run metadata available at:
  - `GET /api/admin/backup-runs?key=ADMIN_KEY`

### Atlas Backup Alternative
- If app-level export is unavailable:
  1. Open MongoDB Atlas.
  2. Use Cloud Backup/PITR snapshot for the cluster.
  3. Export target collections (`orders`, `settlements`, `cashcollections`) using Atlas tools.

## 12) Restore Drill (Document-Only)
1. Select a recent backup export run and verify JSONL integrity.
2. Spin up a staging database.
3. Import collections into staging:
   - `orders`
   - `settlements`
   - `cashcollections`
4. Verify:
   - `/api/admin/indexes?key=ADMIN_KEY`
   - `/api/status`
   - smoke suite + idempotency smoke
5. Record restore duration and any failed records in incident notes.

## 13) Rate Limit Persistence Test (Across Restart)
1. Trigger rate-limit on a public route (example: complaints/reviews/orders).
2. Confirm route returns `429` with `Retry-After`.
3. Restart the backend process/deployment.
4. Retry immediately with same key (same phone/session).
5. Confirm route still returns `429` until the same window expires.
