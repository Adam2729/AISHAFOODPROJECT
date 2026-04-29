# Phase 3 - Bamako Driver Ops (WhatsApp-first)

## 1) Dispatch flow (WhatsApp-first)
1. Customer places order in **Bamako city scope** (City-selected context).
2. Merchant confirms preparation in merchant dashboard.
3. Ops or merchant assigns rider (existing dispatch assignment).
4. Driver receives job context through **WhatsApp + a lightweight link** (no app-heavy workflow).
5. Merchant marks **Delivered**; OTP proof is verified (customer code) in delivered transition.
6. Delivered transition creates **RiderPayout** (idempotent) for weekly payout ledger.

## 2) Minimal driver surfaces
- Driver order list and status confirmations remain lightweight.
- Driver payout visibility endpoint exposes **pending payouts** (and optionally paid history in Ops).
- No map, no background location tracking, no push dependency.
- Ops remains the control point for payout settlement and reconciliation.

## 3) OTP + payout + settlement relationship
- OTP verification remains required for delivered transition (unless explicitly overridden by admin in future).
- Settlement counting remains tied to delivered transition.
- RiderPayout is generated once per delivered order when payout conditions are met.
- RiderPayout amounts are city-policy dependent and stored as snapshot-driven values.
- Weekly **RiderPayoutBatch** groups pending payouts by `cityId + weekKey` for bulk settlement.

## 4) Weekly payout settlement cycle
1. Ops creates/refreshes weekly payout batch per city.
2. Batch captures pending payout IDs and totals.
3. Ops executes batch pay to mark pending payouts as paid in bulk.
4. CSV export provides payout rows for accounting and external review.
5. Invariants endpoint checks ledger consistency and batch math.

## 5) Cash reconciliation starter (driver-level)
Ledger-only snapshot per driver/week (assumes customer cash is collected by rider for cash orders):
- `cashCollectedByRider` = sum(delivery fees collected from customers)
- `cashDueToRider` = sum(rider payout amount)
- `cashDueToPlatform` = sum(platform margin)
- `netSettlement` = `cashDueToRider - cashDueToPlatform`

Interpretation:
- Positive net => platform should pay rider.
- Negative net => rider owes platform.

## 6) Operational controls in Phase 3
- Ops Drivers list by city/week with pending and paid metrics.
- Driver detail view with:
  - Pending list + bulk mark paid
  - Paid history
  - Weekly/monthly summaries
  - Cash reconciliation snapshot

## 7) Future optional add-ons
- Shared location links (opt-in) for active deliveries.
- Photo proof uploads at handoff.
- Driver-specific dispute workflow with evidence bundle.
- Automated payout statements and bank/mobile-money payout rails.
- Rule-based anomaly alerts per driver (margin drift, duplicate payout attempts).
