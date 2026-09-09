# Deploying AFRFMS to Render + Neon (no credit card required)

This setup avoids Render's Blueprint card prompt by creating each resource
individually, and uses Neon instead of Render's Postgres (Neon's free tier
is permanent and doesn't expire after 30 days like Render's does).

## 1. Create your database on Neon

1. Go to [neon.tech](https://neon.tech) and sign up (no card required).
2. Create a new project (any name, e.g. `afrfms`).
3. On the project dashboard, copy the **connection string** — it looks like
   `postgresql://user:password@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require`.
   Keep this handy for step 3 below.

## 2. Push this code to GitHub

If you haven't already:

```bash
cd afrfms-final
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

If the remote already exists from a previous push, just run:

```bash
git push origin main
```

## 3. Deploy the backend on Render

1. Render dashboard → **New → Web Service** (not Blueprint).
2. Connect your GitHub repo, select it.
3. Settings:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install --include=dev && npm run build`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Environment variables:
   - `DB_DRIVER` = `postgres`
   - `DATABASE_URL` = the Neon connection string from step 1
   - `JWT_SECRET` = any long random string (e.g. generate with `openssl rand -hex 32`)
   - `JWT_EXPIRES_IN` = `8h`
   - `FRONTEND_URL` = leave blank for now, you'll set this in step 5
5. Click **Create Web Service**. Note the URL Render assigns, e.g.
   `https://afrfms-backend.onrender.com`.

## 4. Deploy the frontend on Render

1. Render dashboard → **New → Static Site**.
2. Connect the same repo.
3. Settings:
   - **Root Directory:** `web`
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `dist`
4. Environment variable:
   - `VITE_API_URL` = the backend URL from step 3 (e.g. `https://afrfms-backend.onrender.com`)
5. Before deploying, open the **Redirects/Rewrites** tab and add:
   - Source: `/*`
   - Destination: `/index.html`
   - Action: `Rewrite`

   (Without this, refreshing any page other than `/` will 404 — this app
   uses client-side routing.)
6. Click **Create Static Site**. Note its URL, e.g. `https://afrfms-web.onrender.com`.

## 5. Connect the two

Go back to the **afrfms-backend** service → **Environment** → set
`FRONTEND_URL` to the frontend URL from step 4 → save (this triggers a
redeploy).

## 6. Set up the database schema

Once `afrfms-backend` shows **Live**, open its **Shell** tab and run:

```bash
npm run migrate
npm run seed
```

`seed` prints demo login credentials for all 11 roles.

## 7. Verify

- Backend health check: `https://<your-backend>.onrender.com/health`
- Frontend: open `https://<your-web>.onrender.com` and log in with a demo account.

## Notes

- Free Render web services sleep after 15 min idle (~30-60s cold start on
  next request). The static frontend never sleeps.
- Neon's free database also pauses when idle but wakes automatically on
  the next query — no data loss, unlike Render's which expires outright.
- When you're ready for always-on with no sleep, switch the backend's
  instance type to Starter (~$7/mo) in Render's dashboard.

