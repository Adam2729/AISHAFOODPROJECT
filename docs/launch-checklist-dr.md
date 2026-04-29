# DR Launch Checklist

- Confirm the selected city is `Santo Domingo` in the mobile app.
- Confirm profile diagnostics show:
  - `marketCode = DO`
  - `defaultLanguage = es`
  - `currencyDisplay = RD$`
  - Dominican WhatsApp support number
- Verify first-run mobile navigation titles appear in Spanish.
- Verify restaurant discovery loads from `/api/public/restaurants` with sponsored entries first when active.
- Verify prices on:
  - home cards
  - restaurant menu
  - cart
  - checkout
  - order history
  - tracking
  - confirmation
  all display `RD$`.
- Verify checkout only shows payment methods allowed for the selected Dominican city.
- Place a test order and confirm:
  - confirmation page shows payment method and status
  - delivery OTP is visible and not auto-hidden
  - tracking page shows OTP or OTP last 4 digits
  - WhatsApp support opens the Dominican number
- Verify restaurant onboarding page `/restaurant/apply` has neutral copy and no Bamako branding.
- Verify driver onboarding page `/driver/apply` has neutral copy and no Bamako branding.
- Verify restaurant open/closed behavior uses `America/Santo_Domingo` when city/business defaults are used.
- Verify ops dispatch opens through `/ops/dispatch` and does not depend on naked query-string keys in production.
