# Deploying AFRFMS to Render

This repo includes a `render.yaml` blueprint that provisions all three pieces
(Postgres database, backend API, static frontend) in one step.

## 1. Push to GitHub

```bash
cd afrfms-final
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

(Create the empty repo on GitHub first at github.com/new — don't
initialize it with a README, or the push above will conflict.)

## 2. Deploy on Render

1. Go to the Render dashboard → **New** → **Blueprint**.
2. Connect your GitHub account and select this repo. Render will read
   `render.yaml` and show you the three resources it's about to create:
   `afrfms-db` (Postgres), `afrfms-backend` (API), `afrfms-web` (frontend).
3. Click **Apply**. First deploy takes a few minutes.
4. If Render had to rename either web service (because the exact name was
   taken), open `render.yaml`'s two placeholder URLs
   (`FRONTEND_URL` on the backend, `VITE_API_URL` on the frontend) and
   update them to match the real `.onrender.com` URLs Render assigned, then
   redeploy those two services.

## 3. Set up the database schema

Once `afrfms-backend` finishes deploying, open its **Shell** tab in the
Render dashboard and run:

```bash
npm run migrate
npm run seed
```

`seed` prints demo login credentials for all 11 roles. Log in, then either
create real accounts through the Users admin page or change the demo
passwords before putting this in front of real crews.

## 4. Verify

- Backend health check: `https://<your-backend>.onrender.com/health`
- Frontend: `https://<your-web>.onrender.com`

## Notes

- The `starter` plan on the backend keeps it always-on (no cold-start
  sleep). Remove `plan: starter` from `render.yaml` before deploying if you
  want to test on the free tier first — just know it sleeps after 15 min
  idle and the free Postgres database expires after 30 days.
- CORS on the backend is restricted to `FRONTEND_URL`. If you add a custom
  domain later, add it there too (comma-separated for multiple origins).
