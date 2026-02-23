# Operations Runbook

Production operations guide for Aisha Food.

## 1) Pause All Ordering (Maintenance)
1. Open `/admin/ops?key=ADMIN_KEY`.
2. In `Maintenance Mode`, toggle ON.
3. Confirm:
   - `POST /api/public/orders` returns `503` with `MAINTENANCE`.
   - `PATCH /api/merchant/orders/:orderId` returns `503` with `MAINTENANCE`.
   - `GET /api/health` still returns OK.

## 2) Pause a Single Business
1. Open `/admin/businesses?key=ADMIN_KEY` or use at-risk table in `/admin/ops`.
2. Click `Pause` on the merchant.
3. Add optional pause reason.
4. Confirm new public orders for that business return:
   - `403`, code `BUSINESS_PAUSED`.

## 3) Collect Settlement with Proof
1. Open `/admin/settlements?key=ADMIN_KEY`.
2. For pending rows, fill:
   - `receiptRef`
   - `collectorName` (optional)
   - `collectionMethod` (`cash`/`transfer`/`other`)
   - `receiptPhotoUrl` (optional)
3. Click `Mark Collected`.
4. Verify:
   - Settlement status = `collected`.
   - Orders in that week show collected settlement fields.
   - Settlement audit contains `SETTLEMENT_COLLECTED`.

## 4) Resolve Disputes
1. Pull weekly settlement CSV:
   - `/api/admin/settlements/export?key=ADMIN_KEY&weekKey=YYYY-Www`
2. Pull settlement audit trail:
   - `/api/admin/audit?key=ADMIN_KEY&businessId=<id>&weekKey=YYYY-Www&limit=200`
3. Pull business audit trail:
   - `/api/admin/businesses/audit?key=ADMIN_KEY&businessId=<id>&limit=200`
4. Cross-check:
   - Order counted events (`ORDER_COUNTED`)
   - Collection event (`SETTLEMENT_COLLECTED`)
   - Pause/health admin actions (business audit)

## 5) If MongoDB Is Down
1. Toggle maintenance ON from environment:
   - `MAINTENANCE_MODE=true` (Vercel production env).
2. Check Mongo Atlas status and connection string.
3. Validate app with:
   - `GET /api/health`
4. After recovery:
   - set `MAINTENANCE_MODE=false`
   - run smoke suite:
     - Windows: `npm run qa:smoke:win`
     - Other: `npm run qa:smoke`

## 6) Missing Orders Complaint Workflow
1. Confirm merchant is not paused/suspended.
2. Check merchant orders API and order statuses.
3. Verify order transitions and settlement status.
4. Verify settlement audit for that week.
5. If needed, collect logs window in Vercel runtime logs.

## 7) Weekly Routine (Mon-Sun)
- Monday:
  - Review previous week settlements and collection proofs.
  - Run weekly health reset job check.
- Tuesday:
  - Review at-risk merchants and complaints updates.
- Wednesday:
  - Verify backups/PITR status in Mongo Atlas.
- Thursday:
  - Audit pause reasons and business quality actions.
- Friday:
  - Export weekly CSV preview and spot-check totals.
- Saturday:
  - Check 5xx trend and cron logs.
- Sunday:
  - Prepare next week ops notes and unresolved incidents.

## 8) Production Safety Checks
1. Verify required indexes:
   - `/api/admin/indexes?key=ADMIN_KEY`
2. Verify cron protection:
   - `CRON_SECRET` set in production.
3. Verify seed protection:
   - `ALLOW_SEED=false` in production.
4. Verify backups and PITR enabled in Atlas.

