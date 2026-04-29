# Launch Runbook

## T-7 days

- Freeze non-critical feature work.
- Confirm Bamako city is active and launch defaults still point to `BKO`.
- Confirm both delivery models remain operational:
  - `self_delivery`
  - `platform_driver`
- Run `npm run qa:validate:bamako-launch`.
- Review [dr-pilot-validation-checklist.md](/c:/Users/admin/AishaFoodProject/docs/dr-pilot-validation-checklist.md).

## T-3 days

- Build and deploy the backend candidate.
- Run `npm run qa:validate:prod-env`.
- Run `npm run qa:launch:verify`.
- Start a secure browser session from `/admin/access`.
- Confirm `/admin` shows the launch readiness snapshot with:
  - Bamako launch city
  - real support line configured
  - public API base URL
  - maps + cron ready
- Run `npm run validate:launch:env` from `aisha-food-app`.
- Install a fresh mobile QA build on at least two Android devices.

## T-1 day

- Unlock Profile diagnostics on the QA build and run the in-app launch validation.
- Confirm the app reports the correct API target:
  - `local`
  - `preview`
  - or `production`
- Confirm Bamako market config resolves French + `XOF`.
- Confirm merchant onboarding and driver onboarding submit correctly.
- Confirm public restaurants and menus load from the live backend.

## Launch day

- Confirm maintenance mode is off.
- Confirm the public API host is live and reachable.
- Confirm support WhatsApp is real, not placeholder or blank.
- Run the first live restaurant order end-to-end.
- Watch dispatch, OTP completion, payment status, and support escalation flow.

## Post-launch day 1

- Review order success rate and OTP completion issues.
- Review support volume and repeated complaint themes.
- Review merchant self-delivery versus platform-driver exceptions.
- Review reconciliation and cash-handoff issues.
