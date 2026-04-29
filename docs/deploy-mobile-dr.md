# Deploy Mobile - Launch Build

## Scope

Use this runbook for the Expo customer app in `aisha-food-app`.

Current launch market: Bamako, Mali. Dominican Republic remains supported with the same app config pattern.

## Environment setup

Set both the launch environment and API host explicitly.

Local development example:

```env
EXPO_PUBLIC_LAUNCH_ENV=local
EXPO_PUBLIC_API_URL=http://192.168.0.11:3000
```

Preview example:

```env
EXPO_PUBLIC_LAUNCH_ENV=preview
EXPO_PUBLIC_API_URL=https://preview-api.your-live-host.com
```

Production example:

```env
EXPO_PUBLIC_LAUNCH_ENV=production
EXPO_PUBLIC_API_URL=https://api.your-live-host.com
```

Notes:

- `EXPO_PUBLIC_API_URL` is the primary setting.
- `API_BASE_URL` is only a legacy alias.
- Preview and production must use a public HTTPS host.
- The app now reports whether it is pointed at `local`, `preview`, or `production`.

## Validation before build

From `aisha-food-app`:

```powershell
npm install
npx tsc --noEmit
npm run validate:launch:env
```

Expected:

- the configured API host is reachable
- `/api/status` and `/api/public/cities` respond
- Android package id remains `com.aishafood.app`

## Build commands

Preview APK:

```powershell
npm run eas:build:android:preview
```

Production AAB:

```powershell
npm run eas:build:android:production
```

## Device verification

- Install the build on at least one Android device.
- Open Profile diagnostics and confirm the app shows the expected API target and base URL.
- Run the in-app launch validation block.
- Confirm Bamako city selection works and the market resolves to French + `XOF`.
- Confirm support WhatsApp is either real or explicitly shown as not configured yet.
- Confirm restaurants load from the selected backend.

## Production deploy checklist

- backend env is launch-ready
- public API host is live
- mobile env points to that host
- support contact is configured
- Bamako city is active
- `npm run validate:launch:env` passes
