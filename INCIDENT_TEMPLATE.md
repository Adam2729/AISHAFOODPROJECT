# Incident Template

Use this during and after any production or staging incident.

## 1) Incident Header
- Incident ID:
- Date (UTC):
- Environment: `production` | `staging`
- Severity: `SEV-1` | `SEV-2` | `SEV-3`
- Incident Commander:
- Status: `open` | `monitoring` | `resolved`

## 2) Summary
- What happened:
- Customer impact:
- Business/merchant impact:

## 3) Detection
- How was it detected: (alert, dashboard, support, manual)
- First detection timestamp:
- Time acknowledged:

## 4) Timeline (UTC)
- `HH:MM` - Detection
- `HH:MM` - Triage started
- `HH:MM` - Maintenance mode enabled (if used)
- `HH:MM` - Mitigation deployed
- `HH:MM` - Smoke suite run
- `HH:MM` - Service restored

## 5) Immediate Actions
- [ ] Checked `GET /api/health`
- [ ] Reviewed logs for failing route(s)
- [ ] Enabled maintenance mode (if needed)
- [ ] Captured impacted endpoint list
- [ ] Ran smoke checks after fix

Maintenance toggle commands:
- ON: `POST /api/admin/maintenance?key=ADMIN_KEY` body `{ "enabled": true }`
- OFF: `POST /api/admin/maintenance?key=ADMIN_KEY` body `{ "enabled": false }`

## 6) Root Cause
- Technical root cause:
- Contributing factors:
- Why it escaped earlier checks:

## 7) Resolution
- Fix implemented:
- Deployment reference (commit/PR):
- Verification evidence:
  - [ ] `npm run qa:smoke` passed
  - [ ] settlement values sane
  - [ ] audit events present

## 8) Financial Integrity Check (Required)
- Week key reviewed:
- Settlement rows checked:
- Any mismatches found:
- Audit rows checked (`ORDER_COUNTED`, `SETTLEMENT_COLLECTED`):
- Manual correction needed: `yes` | `no`

## 9) Follow-ups
- [ ] Add/adjust test
- [ ] Add/adjust alert
- [ ] Add runbook note
- [ ] Backfill or data repair task (if needed)
- Owners + due dates:

## 10) Postmortem Sign-off
- Engineering lead:
- Operations lead:
- Founder/Owner:
- Final closure date:
