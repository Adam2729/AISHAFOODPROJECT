# OranjeEats Merchant MVP Testing

Use this checklist after starting the backend and seeding the local merchant MVP account.

## Local Login
- Email: `merchant@test.oranjeeats.com`
- Phone: `+22370000001`
- Password: `Password123!`

## Merchant App Checklist
- Login works.
- Session persists after app reload.
- Orders load.
- New order popup appears.
- Accept order works.
- Start preparing works.
- Mark ready works.
- Menu products load.
- Add product works.
- Edit product works.
- Toggle availability works.
- Bulk availability works.
- Payments page loads.
- Profile updates.
- Logout works.

## Notes
- Backend URL should be set with `EXPO_PUBLIC_API_URL=http://YOUR_LOCAL_IP:3000`.
- Do not use `localhost` or `127.0.0.1` for physical device testing.
- Seeded merchant business: `OranjeEats Test Kitchen`.
- Seeded city: `Bamako (BKO)`.
- Seeded menu products: `5`.
- Seeded orders: `2` (`new` and `preparing`).
- All seed records are demo/test data and are intended for local MVP validation only.
