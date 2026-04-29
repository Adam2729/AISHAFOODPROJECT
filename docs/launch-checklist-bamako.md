# Bamako Launch Checklist

- Confirm the selected city is `Bamako` in the mobile app.
- Confirm profile diagnostics show:
  - `marketCode = ML`
  - `defaultLanguage = fr`
  - allowed languages include `fr`, `bm`, `en`
  - `currencyDisplay = XOF`
  - Mali WhatsApp support number
- Verify first-run mobile navigation titles appear in French.
- Verify restaurant discovery still loads correctly for Bamako and preserves sponsored ordering.
- Verify prices on:
  - home cards
  - restaurant menu
  - cart
  - checkout
  - order history
  - tracking
  - confirmation
  all display `XOF`.
- Verify checkout shows mobile money only if the Bamako city/payment policy allows it.
- Place a test order and confirm:
  - confirmation page shows payment method and status
  - delivery OTP is visible and not auto-hidden
  - tracking page shows OTP last 4 digits and verification state
  - WhatsApp support opens the Mali number
- Verify restaurant onboarding page `/restaurant/apply` remains city-safe and works for Bamako.
- Verify driver onboarding page `/driver/apply` remains city-safe and works for Bamako.
- Verify business-hours fallback uses `Africa/Bamako` when city/business defaults are used.
- Verify ops dispatch city selection no longer defaults specifically to `BKO` when multiple active cities exist.
