# Aisha Food Backend

Next.js App Router backend for marketplace orders, merchant operations, settlements, and admin controls.

## Requirements
- Node.js 20+
- MongoDB

## Environment
Copy `.env.example` to `.env.local` and fill values:

```bash
cp .env.example .env.local
```

Required vars include:
- `MONGODB_URI`
- `ADMIN_KEY`
- `JWT_SECRET`
- `BASE_LOCATION_LAT`
- `BASE_LOCATION_LNG`

## Run Local
```bash
npm install
npm run dev
```

Server:
- Local: `http://localhost:3000`

## QA Smoke Suite
Runs end-to-end checks automatically:
- create business
- merchant login
- create product
- create public order
- transition order to delivered
- verify settlement + audit

Linux/macOS:
```bash
npm run qa:smoke
```

Windows:
```bash
npm run qa:smoke:win
```

Windows wrapper options:
```powershell
.\scripts\smokeSuite.ps1 -BaseUrl "http://localhost:3000"
.\scripts\smokeSuite.ps1 -SkipHealthCheck
```

## Merchant Onboarding v2
- New businesses are created with `auth.mustChange = true`.
- On first merchant login:
  - login response includes `mustChangePin: true`
  - UI redirects to `/merchant/set-pin`
  - merchant APIs return `PIN_CHANGE_REQUIRED` until PIN is updated.
- PIN update endpoint:
  - `POST /api/merchant/auth/set-pin`

## CI (PR Smoke)
GitHub Actions workflow:
- `.github/workflows/backend-smoke-pr.yml`

On pull requests affecting backend:
1. starts Mongo service
2. runs `npm run lint`
3. runs `npx tsc --noEmit`
4. starts backend
5. waits for `/api/health`
6. runs `npm run qa:smoke`

## Operations
- Incident and release procedure:
  - `RUNBOOK.md`
- Incident report template:
  - `INCIDENT_TEMPLATE.md`
- Create a new incident report (Windows):
  - `npm run incident:new:win`

## Useful Endpoints
- Health: `GET /api/health`
- Admin maintenance toggle: `GET/POST /api/admin/maintenance?key=...`
- Admin settlements: `GET /api/admin/settlements?key=...`
- Admin settlements CSV export: `GET /api/admin/settlements/export?key=...&weekKey=YYYY-Www`
- Admin audit by week: `GET /api/admin/audit?key=...&businessId=...&weekKey=YYYY-Www`
