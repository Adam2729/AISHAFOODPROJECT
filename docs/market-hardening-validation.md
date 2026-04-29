# Market Hardening Validation

## Mobile

- `aisha-food-app/src/lib/marketConfig.js` is the single source for:
  - market code
  - default language
  - allowed languages
  - currency display
  - support WhatsApp
  - timezone
  - payment methods
- Confirm all customer-facing price surfaces use market-aware formatting instead of hardcoded `XOF`.
- Confirm customer support flows use market-aware WhatsApp numbers.
- Confirm order confirmation and tracking show delivery OTP guidance clearly.
- Confirm customer profile shows active city from backend profile data, not static text.

## Backend

- `aisha-food-backend/src/lib/marketConfig.ts` is the central backend market config layer.
- Confirm user session/profile routes preserve Spanish for DR markets and do not rewrite `es -> fr`.
- Confirm business-hours fallback no longer assumes Bamako globally.
- Confirm onboarding pages are neutral and do not preselect Bamako-only defaults.
- Confirm partner referral bonus side effects now leave structured audit metadata on businesses/drivers.
- Confirm `/dispatch` is treated as a legacy route and `/ops/dispatch` is the primary ops entry point.

## Final Smoke Expectations

- Dominican city shows `RD$` and Spanish defaults.
- Bamako city shows `XOF` and French defaults.
- Switching city changes diagnostics, language options, currency display, and support WhatsApp behavior.
- New orders still create successfully and return OTP metadata.
- Tracking and confirmation both render delivery proof information without exposing stale market defaults.
