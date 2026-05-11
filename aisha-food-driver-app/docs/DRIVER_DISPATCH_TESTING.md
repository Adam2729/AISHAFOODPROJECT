# OranjeEats Driver Dispatch Testing

Use this checklist to validate the local auto-dispatch MVP against the backend seed:

Seeded driver credentials:
- Email: `driver@test.oranjeeats.com`
- Phone: `+22370000002`
- Password: `Password123!`

Seeded merchant credentials:
- Email: `merchant@test.oranjeeats.com`
- Phone: `+22370000001`
- Password: `Password123!`

Environment:
- Set `EXPO_PUBLIC_API_URL` in `aisha-food-driver-app/.env`
- Use your computer network IP, not `localhost`
- Example: `EXPO_PUBLIC_API_URL=http://192.168.1.10:3000`

Checklist:
- Driver login works with the seeded email and password.
- Driver login works with the seeded phone and password.
- Driver can go online.
- No `self_delivery` order appears in the driver app.
- Incoming offer appears after the merchant marks `DDMVP-BKO-PREPARING` as `ready`.
- Countdown works on the incoming offer modal.
- Reject sends the order to the next driver or leaves it in manual-dispatch state if no other driver exists.
- Accept creates an active delivery.
- Status buttons work:
  - `Arrived at Restaurant`
  - `Picked Up`
  - `Delivered`
- Weak network message appears after repeated failures.
- Location updates send while an active delivery is in progress.

Notes:
- Current driver login method is direct email/phone plus password through `/api/driver/auth/login`.
- The seed also creates `DDMVP-BKO-READY`, a ready but unassigned `platform_driver` order for dispatch board testing.
- The seed also creates `DDMVP-BKO-SELFDELIVERY`, which must never appear in the driver app.
