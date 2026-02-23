# Deployment Guide (Production + Staging Separation)

## 1) Create MongoDB databases

Use MongoDB Atlas and create fully separate environments:

1. Production database name: `aisha_food_prod`
2. Staging database name: `aisha_food_staging`

You can use:

1. One cluster with two separate DBs, or
2. Two separate clusters (recommended for stricter isolation)

## 2) Create least-privilege Mongo users

Create two users:

1. `aisha_prod_user` with access only to `aisha_food_prod`
2. `aisha_staging_user` with access only to `aisha_food_staging`

Never reuse prod credentials in staging.

## 3) Configure Vercel environment variables

Set the same variable names in each Vercel environment, but with different values:

Required vars:

1. `MONGODB_URI`
2. `ADMIN_KEY`
3. `JWT_SECRET`
4. `BASE_LOCATION_LAT`
5. `BASE_LOCATION_LNG`
6. `MAX_RADIUS_KM`

### Production environment (Vercel: Production)

1. Go to Project -> Settings -> Environment Variables
2. Select `Production`
3. Set `MONGODB_URI` to PROD URI (`aisha_food_prod`)
4. Set all other required vars with production-safe values

### Preview environment (Vercel: Preview / branch deploys)

1. Go to Project -> Settings -> Environment Variables
2. Select `Preview`
3. Set `MONGODB_URI` to STAGING URI (`aisha_food_staging`)
4. Set all other required vars for staging

Never point Preview to production DB.

## 4) Verify environment separation

After deploying:

1. Open Production URL:
   - `https://<your-prod-domain>/api/health`
2. Open Preview URL:
   - `https://<your-preview-domain>/api/health`
3. Confirm:
   - `env` differs as expected
   - `db.name` for Production is prod DB
   - `db.name` for Preview is staging DB

## 5) Safe deploy checklist

1. Deploy branch to Preview
2. Validate `/api/health` in Preview
3. Run seed/testing only in staging DB
4. Confirm core flows in staging:
   - public order creation
   - merchant status updates
   - settlement collection
5. Merge to `main`
6. Production deploy runs
7. Validate `/api/health` in Production
8. Smoke test one real API flow in Production
