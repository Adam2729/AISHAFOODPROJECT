# Ops Playbook - Dominican Republic Pilot

Open `/admin/access` first to start a secure admin browser session. Use the normal admin and ops pages after that. Do not share raw keyed URLs in production, and only use `x-admin-key` as a temporary API fallback when a session cookie is not available.

## 1. New restaurant onboarding

1. Open `/restaurant/apply` and confirm the city is a DR city.
2. Review the application in admin after starting the secure browser session.
3. Approve only after confirming phone, address, cuisine, and WhatsApp contact.
4. Run the restaurant's first test order before marking the onboarding complete.

## 2. New driver onboarding

1. Open `/driver/apply` and confirm city and zone are correct.
2. Review the application in admin after starting the secure browser session.
3. Approve only after confirming phone and vehicle type.
4. Send the driver access link and verify the dashboard loads.

## 3. First order test per restaurant

1. Place a low-value test order from the customer app.
2. Confirm the merchant sees the new order.
3. Confirm dispatch can assign the order.
4. Confirm tracking and payment status update correctly.

## 4. Manual dispatch fallback

1. Open `/admin/access` if the admin session is not already active.
2. Open `/ops/dispatch`.
3. Confirm the diagnostics card shows the correct DR city, market, timezone, and real support number.
4. Select the active city.
5. Select the unassigned order.
6. Select a driver in the same city.
7. Click `Assign driver` and copy the WhatsApp dispatch text if needed.

## 5. Auto-dispatch verification

1. Confirm the diagnostics card matches the selected city.
2. Confirm drivers are `available`.
3. Use `Auto Assign` on one order first.
4. Confirm history records `AUTO_DRIVER_ASSIGNED` or `AUTO_ASSIGN_SKIPPED`.

## 6. Payment marked paid flow

1. Open the admin payment update flow for the order.
2. Mark the order paid only after cash or mobile-money confirmation.
3. Reopen tracking or payment status to confirm the event was written.

## 7. Reconciliation review

1. Review finance and reconciliation pages at the end of each pilot day.
2. Resolve cash mismatches before the next business day.
3. Escalate repeated mismatches to finance and ops together.

## 8. Customer support escalation

1. Collect order number, customer phone, and city.
2. Check tracking, dispatch history, and payment state.
3. Remember that My Orders is now device-verified, not phone-only. If the customer cannot see history, ask them to retry from the same device used at checkout.
4. Escalate to dispatch if the issue is delivery-related.

## 9. Restaurant support escalation

1. Collect business name, order number, and current order status.
2. Check merchant dashboard and order state.
3. Escalate to ops if dispatch or driver behavior is involved.

## 10. Driver issue escalation

1. Collect driver name, phone, city, and affected order ids.
2. Check availability, assigned load, and delivery history.
3. Escalate to ops lead if reassignment or suspension is needed.

## 11. Launch safety checks

1. Confirm Profile diagnostics and ops diagnostics show the real Dominican support number, not a placeholder.
2. Confirm the active DR city still resolves Spanish defaults and `RD$`.
3. Confirm the current Android pilot build uses package id `com.aishafood.app`.
