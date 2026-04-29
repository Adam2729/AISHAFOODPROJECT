# Run Launch Checks

Use this sequence from `aisha-food-backend` before launch and after any production hotfix.

## Core validation

```powershell
npm run qa:validate:bamako-launch
npm run qa:validate:prod-env
npm run qa:launch:verify
```

## Legacy smoke coverage

If you still want the broader smoke suite, run the existing pilot pack after the launch checks:

```powershell
npm run qa:pilot:dr
npm run qa:pilot:dr:run
```

## Mobile validation

Run separately from `aisha-food-app`:

```powershell
npm run validate:launch:env
npm run pilot:check
```

## Operator reminders

- Start admin and ops access from `/admin/access`.
- Use the in-app diagnostics block to confirm API target, market config, and support readiness.
- Use the launch verification script for the real deploy path, not only the broader legacy smoke suite.
