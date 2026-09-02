# AFRFMS — Airport Fire & Rescue Fleet Management System

Pakistan Airport Authority. A nationwide, role-based system for daily
inspection checklists, automatic fault detection and alerting, shift
reporting, and fleet/roster administration across every airport's fire and
rescue services.

This repository has two parts:

- **`backend/`** — the API (Express + TypeScript). Auth/RBAC, the checklist
  engine, fault alerting & resolution, shift reports (incl. PDF handover
  documents), and full Admin CRUD. Runs on SQLite (zero setup, local dev) or
  real PostgreSQL (production), selected by one env var. See `backend/README.md`.
- **`web/`** — the dashboard (React + TypeScript). Every role's screens,
  including the driver's mobile-first checklist. See `web/README.md`.

## Run it locally

```bash
# Terminal 1 — backend (SQLite by default — see backend/README.md for Postgres)
cd backend
npm install
cp .env.example .env
npm run migrate
npm run seed        # prints demo login credentials for all 11 roles
npm run dev           # http://localhost:4000

# Terminal 2 — web dashboard
cd web
npm install
cp .env.example .env
npm run dev           # http://localhost:5173
```

Open http://localhost:5173 and sign in with any of the credentials the seed
script printed (all share the password `Passw0rd!123` — change this before
any real deployment).

## What's built

1. **Auth + RBAC** — CNIC/password login, JWT, role- and airport-scoped
   access enforced server-side on every request. Eleven roles: **GM Fire**
   and **Admin** (national, equivalent authority everywhere), **CFRO**
   (appointed to one airport; appoints the Team Leader, all fire crew, and
   their shift assignments there — plus full shift-management authority),
   **Team Leader** (assigns the driver/supvr/sr supdt-or-supdt crew for each
   vehicle each shift), the four firefighter ranks **Sr Supdt, Supdt, Supvr,
   Asstt** (senior to junior), **Driver**, **Mechanical Technician**,
   **Mechanical Officer**.
2. **Checklist engine & driver submission** — checklists configured per
   equipment category, shifts, vehicle assignments, mobile-first submission.
   A driver can be assigned more than one vehicle in a shift and works
   through each independently.
3. **Fault alerting & resolution** — a failed critical checklist item
   automatically grounds the vehicle, creates a Fault, and alerts the right
   Mechanical Technicians/Officers; full acknowledge → diagnose → resolve
   lifecycle with automatic reactivation.
4. **Shift report generation**, including a **downloadable PDF handover
   document** — every vehicle at the airport (not just this shift's), each
   one's previous vs. current odometer reading, who checked it, faults
   raised and whether rectified, the outgoing leader's comments, and a
   signature block for the current and previous shift leader (looked up
   automatically). Blocked from generating until every vehicle is accounted
   for; the underlying data snapshot is frozen at generation time so the
   signed document doesn't drift if faults are resolved afterward.
5. **A working web dashboard** for all 11 roles, wired to the above.
6. **PostgreSQL support**, as a first-class alternative to the SQLite dev
   database — same code, same schema (mechanically adapted), selected via
   one environment variable. Verified against a real, separately installed
   Postgres 16 instance, not just written and assumed correct.
7. **Full Admin CRUD**: equipment (create/edit any field/retire — retiring
   is always a soft delete to preserve the audit trail), equipment
   categories (create/rename), airports (create/edit, incl. per-airport
   **shift pattern** — 3 shifts of morning/evening/night or 2 shifts of
   morning/night at 12hr each, toggleable by CFRO on their own airport or
   Admin/GM Fire anywhere, blocked if it would orphan an open shift), a CFRO
   can also create/manage stations at their own airport, users
   (create/edit name/role/airport/status/password — a **CFRO can now do
   this too**, scoped to Team Leader/fire crew/driver/maintenance roles at
   their own airport only), checklist templates (add/edit/retire items
   without breaking historical records), and **shift groups** — rotation
   crews (e.g. "A", "B", "C", "D") for Team Leaders, the four firefighter
   ranks, and Drivers, each assignable to a shift type matching the
   airport's pattern, as a simple roster board a CFRO uses to appoint people
   to crews.

Every one of the above has been exercised end to end with a 35-point
integration test (`web/integration-test.mjs`) that replicates every fetch
call the web dashboard makes and walks the full lifecycle — shift creation →
vehicle assignment → driver submits checklists for two vehicles
independently (this specifically regression-tests a bug found after initial
use — see `backend/README.md`) → a critical fault auto-grounds a vehicle →
Mechanical Technician diagnoses → Mechanical Officer resolves → vehicle
auto-reactivates → Team Leader generates the report and downloads a real PDF
(verified by file signature, content-type, and a separate 45-row pagination
test) → CFRO views the national fleet, opens a shift, appoints fire crew
(and is rejected appointing a CFRO/Admin/GM Fire role or staff at another
airport), and toggles their airport's shift pattern (rejected while an
incompatible open shift exists) → Admin exercises every CRUD capability
including shift-group roster assignment. **All 35 checks pass against both
SQLite and Postgres**, from a completely fresh clone with a fresh
`npm install` each time.

If you're upgrading an existing (pre-rank-split) database rather than
starting fresh, run `npm run upgrade:rank-split` once from `backend/` before
`npm run migrate` — see `backend/src/db/upgrade-2026-08-rank-split.ts` for
exactly what it changes (it renames the old SUPERINTENDENT/SUPERVISOR role
rows in place, preserving every user's assignment, and backfills the new
per-airport shift pattern column).

See the *System Architecture & Design Document* (delivered earlier in this
project) for the full data model, roadmap, and rationale behind these
decisions.

## What's next for a real deployment

- **Real push/SMS transport** for alerts (currently recorded in the database
  but not actually dispatched anywhere — see `backend/src/utils/alerts.ts`).
- **A background scheduler** for automatic alert escalation (currently
  surfaced as a computed `isOverdue` flag rather than an active push).
- **The native mobile app** (React Native, per the Architecture Document) for
  true offline-first driver use in the field — this web dashboard's driver
  screen works in a phone browser today, but doesn't work offline.
- Native camera capture for fault photo evidence (today a placeholder URL field).
- Postgres backups, connection pooling tuning, and a managed hosting choice
  for the actual production database instance.
- No visual/pixel-level browser QA has been done (no headless browser was
  available in the environment this was built in) — every data contract
  between frontend and backend has been exercised via the integration test,
  but the first real click-through in an actual browser is worth treating
  as the true first UI test.
