# Deploying AFRFMS to Railway

This repo is an "isolated monorepo" (separate `backend/` and `web/`
folders) — Railway handles that by letting you set a different root
directory per service, all inside one project.

Note: Railway's free tier is a one-time trial credit (~$5), not an
ongoing free plan. Once that's used up, continuing requires a card on
file — same as Render eventually, just deferred.

## 1. Create the project

1. Go to [railway.app](https://railway.app), sign up, connect GitHub.
2. **New Project → Deploy from GitHub repo** → select `atifnm/afrfms`.
3. Railway will try to auto-detect a service from the repo root, which
   won't work correctly since this is a monorepo — that's expected, you'll
   fix the root directories in the next steps.

## 2. Add Postgres

In the project canvas: **+ New → Database → Add PostgreSQL**. Railway
provisions it and exposes its connection details as variables you can
reference from other services (e.g. `${{Postgres.DATABASE_URL}}`).

## 3. Configure the backend service

1. Click the service Railway created from your repo (or add a new one via
   **+ New → GitHub Repo** → same repo if you deleted the auto-detected one).
2. **Settings** tab:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install --include=dev && npm run build`
   - **Start Command:** `npm start`
3. **Variables** tab, add:
   - `DB_DRIVER` = `postgres`
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (this references the
     Postgres service you added in step 2 — start typing `${{` and
     Railway will autocomplete it)
   - `JWT_SECRET` = any long random string
   - `JWT_EXPIRES_IN` = `8h`
   - `FRONTEND_URL` = leave blank for now
4. **Settings → Networking → Generate Domain** to get a public URL for
   this service, e.g. `afrfms-backend-production.up.railway.app`.

## 4. Configure the frontend service

1. **+ New → GitHub Repo** → same repo again, this creates a second
   service.
2. **Settings** tab:
   - **Root Directory:** `web`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start` (this repo's `web/package.json` already
     has a `start` script that serves the built app)
3. **Variables** tab:
   - `VITE_API_URL` = the backend's domain from step 3.4, e.g.
     `https://afrfms-backend-production.up.railway.app`
4. **Settings → Networking → Generate Domain** for this service too.

## 5. Connect the two

Go back to the backend service → **Variables** → set `FRONTEND_URL` to the
frontend's domain from step 4.4. This restricts CORS to your actual
frontend and triggers a redeploy.

## 6. Set up the database schema

Install the Railway CLI locally and run the migration/seed against the
deployed database:

```bash
npm install -g @railway/cli
railway login
railway link        # select this project when prompted
railway run --service backend npm run migrate
railway run --service backend npm run seed
```

`seed` prints demo login credentials for all 11 roles.

(Alternative if you'd rather not install the CLI: in the backend service's
dashboard, use the **"..." menu → Command** option to run one-off
commands directly from the browser.)

## 7. Verify

- Backend health check: `https://<your-backend-domain>/health`
- Frontend: open `https://<your-frontend-domain>` and log in with a demo
  account.
