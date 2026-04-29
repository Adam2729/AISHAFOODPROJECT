# Dominican Republic Pilot Metrics

Use the existing ops, dispatch, merchant, finance, and analytics pages. Do not wait for a new analytics system.

## Daily pilot metrics

- Orders placed per day
- Order success rate
- Average dispatch time
- Average delivery time
- Merchant acceptance time
- Driver no-show count
- Cancelled orders
- Cash reconciliation issues
- Support ticket volume
- Promo abuse cases

## Suggested green / yellow / red thresholds

| Metric | Green | Yellow | Red |
| --- | --- | --- | --- |
| Orders placed per day | Stable or increasing vs prior 3-day average | Down 10-20% | Down >20% |
| Order success rate | >= 90% | 80-89% | < 80% |
| Average dispatch time | < 8 min | 8-15 min | > 15 min |
| Average delivery time | < 45 min | 45-60 min | > 60 min |
| Merchant acceptance time | < 4 min | 4-8 min | > 8 min |
| Driver no-show count | 0-1 per day | 2-3 per day | 4+ per day |
| Cancelled orders | < 5% | 5-10% | > 10% |
| Cash reconciliation issues | 0 | 1-2 open issues | 3+ open issues |
| Support ticket volume | < 10 per 100 orders | 10-20 per 100 orders | > 20 per 100 orders |
| Promo abuse cases | 0-1 per week | 2-3 per week | 4+ per week |

## Where to observe

- Dispatch speed and assignment health: `/ops/dispatch`
- Ops and finance overview: `/admin/ops`
- Merchant performance: `/merchant/dashboard`
- Payment and finance mismatches: finance and reconciliation admin pages
- Driver availability and workload: dispatch panel plus driver dashboard flows

## Escalation rule

If any metric enters red for two consecutive observation windows, pause new marketing pushes and move to incident review before scaling the pilot.
