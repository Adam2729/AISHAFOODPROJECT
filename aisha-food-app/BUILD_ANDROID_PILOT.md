# Android Launch Build

## Prerequisites

- Expo account with access to the project
- EAS CLI available through `npx eas-cli`
- Android package identifier set to `com.aishafood.app`
- A real backend host for preview or production builds

## Required environment

Local example:

```bash
EXPO_PUBLIC_LAUNCH_ENV=local
EXPO_PUBLIC_API_URL=http://192.168.0.11:3000
```

Preview example:

```bash
EXPO_PUBLIC_LAUNCH_ENV=preview
EXPO_PUBLIC_API_URL=https://preview-api.your-live-host.com
```

Production example:

```bash
EXPO_PUBLIC_LAUNCH_ENV=production
EXPO_PUBLIC_API_URL=https://api.your-live-host.com
```

## Commands

```bash
npm install
npm run typecheck
npm run validate:launch:env
npx eas-cli login
npm run eas:build:android:preview
```

Production build:

```bash
npm run eas:build:android:production
```

## Output expectations

- `preview` produces an Android APK for sideload testing
- `production` produces an Android App Bundle (AAB)

## Launch validation after install

1. Open the app.
2. Select the launch city.
3. Open Profile diagnostics.
4. Confirm the API target and API base URL are correct.
5. Run the in-app launch validation.
6. Confirm restaurants load.
7. Confirm support WhatsApp is real or explicitly flagged as unconfigured.

## Common failures

- Missing `EXPO_PUBLIC_LAUNCH_ENV`
  - Set it to `local`, `preview`, or `production`.
- Missing `EXPO_PUBLIC_API_URL`
  - Set a reachable backend host before the build.
- Preview or production pointed at localhost/LAN
  - Use a public HTTPS host.
- Android package drift
  - Re-run `npm run validate:launch:env`.
- Dead or unreachable backend host
  - The validator now checks `/api/status` and `/api/public/cities` before build.
