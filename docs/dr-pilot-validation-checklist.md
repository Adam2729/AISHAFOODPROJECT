# Launch Validation Checklist

Run this before launch and after any production hotfix.

## Customer app

- Run `npm run validate:launch:env` from `aisha-food-app`.
- On the device build, unlock Profile diagnostics and run the in-app launch validation.
- Confirm the Android package id is `com.aishafood.app`.
- Confirm the app reports the expected API target and base URL.
- Confirm Bamako resolves to French + `XOF`.
- Confirm support WhatsApp is real or explicitly shown as not configured yet.
- Confirm restaurants load on Home.
- Confirm restaurant detail/menu loads.
- Confirm checkout preconditions work with the selected city.
- Confirm tracking and My Orders still work on the verified-device flow.

## Operations

- Start the secure browser session from `/admin/access`.
- Confirm `/admin` shows the launch readiness snapshot.
- Confirm launch city, support line, public API base URL, and delivery modes are correct.
- Confirm `/ops/dispatch` loads without raw query-string keys.
- Confirm self-delivery merchants are not blocked on dispatch.
- Confirm platform-driver orders can still use dispatch and driver flow.
- Confirm merchant onboarding apply page works.
- Confirm driver onboarding apply page works.

## Backend

- Run `npm run qa:validate:prod-env`.
- Run `npm run qa:launch:verify`.
- Confirm `/api/health` returns `ok=true`.
- Confirm `/api/status` returns `maintenance=false`.
- Confirm Bamako city is active.
- Confirm both delivery models remain supported:
  - `self_delivery`
  - `platform_driver`
