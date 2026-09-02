# AFRFMS Backend — Complete Foundation

Backend API for the Airport Fire & Rescue Fleet Management System (Pakistan
Airport Authority). This covers the full Phase 1 workflow end to end:

1. **Auth + RBAC** — login, roles, airport scoping.
2. **Checklist engine & driver submission** — dynamic per-category
   checklists, shifts, vehicle assignments, driver submission.
3. **Fault alerting & resolution** — automatic Fault + Alert creation on a
   failed checklist item, acknowledge/diagnose/resolve workflow, manual
   escalation, automatic equipment reactivation.
4. **Shift report generation** — Team Leader compiles and issues an
   auto-calculated equipment-health report once every vehicle has either an
   inspection or a logged exception.

Every one of these has been tested live end to end (see "What's been
verified" below) — this isn't just code that compiles, it's code that's been
run through the actual workflows with curl.

## Role hierarchy

Updated from the original architecture doc based on real operational
feedback:

- **Admin** and **GM Fire** — the two highest-authority roles, both
  national-scope with equivalent permissions everywhere (equipment,
  airports, users, checklist templates, shift groups). Both can appoint any
  user to any airport. GM Fire exists as a second, business-side "admin" so
  the platform-configuration role (Admin) and the operational-oversight role
  (GM Fire) don't have to be the same person.
- **CFRO** — airport-scoped (appointed to one specific airport, not
  national). Has full shift-management authority at that airport: opens
  shifts, assigns vehicles, logs exceptions, generates reports — the same
  powers Team Leader/Superintendent have. Also appoints staff to shift-
  rotation crews (A/B/C/D) and allots each crew's shift type (morning/
  evening/night) at their airport — see "Shift groups" below.
- **Team Leader** — appoints the crew for each vehicle each shift: the
  Driver (required), and optionally the Supervisor and Superintendent on
  duty for that vehicle. This is a separate concept from shift-rotation
  crews — it's who's actually assigned to a specific vehicle for a specific
  shift, editable until that vehicle's checklist is submitted.

See the companion *System Architecture & Design Document* for the full data
model and roadmap.

## Stack

- **Express + TypeScript**
- **PostgreSQL or SQLite**, selected via `DB_DRIVER` — SQLite (Node's
  built-in `node:sqlite`, zero setup) for local development, PostgreSQL for
  staging/production. Both run behind the exact same `db.prepare(sql).get/
  all/run(...)` interface (`src/db/client.ts`), so no application code knows
  or cares which one is active.
- **JWT** auth (`jsonwebtoken`) with role + airport claims baked into the token
- **bcryptjs** for password hashing
- **zod** for request validation
- **express-async-errors** — routes async errors to a global JSON error
  handler instead of crashing the process (Express 4 doesn't do this by
  default; see "Error handling" below)

## Project layout

```
src/
  db/
    schema.sqlite.sql     -- table definitions (SQLite driver): Roles, Users,
                             Airports, Stations, Shift Groups, Equipment,
                             Equipment Categories, Checklist Templates &
                             Items, Shifts, Shift Assignments, Inspection
                             Submissions & Responses, Faults, Alerts, Fault
                             Logs, Shift Reports (+ PDF snapshot), Audit Logs
    schema.postgres.sql    -- the same schema, mechanically adapted for Postgres
    client.ts               -- unified async db client; DB_DRIVER env var picks sqlite or postgres
    migrate.ts               -- applies the correct schema file for the active driver
    seed.ts                    -- demo roles, airports, checklist templates, a demo
                                  shift with vehicle assignments, and one user per role
  utils/
    shiftReportSnapshot.ts  -- builds the full per-equipment fleet breakdown for a shift report
    shiftReportPdf.ts         -- renders that breakdown as a paginated PDF via pdfkit
  middleware/
    auth.ts               -- requireAuth, requireRole, requireAirportScope, canAccessAirport
  modules/
    auth/                  -- POST /auth/login, GET /auth/me
    users/                  -- GET/POST/PATCH /users (Admin, GM Fire)
    airports/                -- airports, stations, and shift-group (crew) CRUD
    equipment/                -- GET /airports/:airportId/equipment (scoped)
    checklists/                -- equipment categories + checklist templates, both with Admin CRUD
    shifts/                     -- open shifts, assign vehicles, live shift view,
                                    exception marking, shift report generation
    inspections/                  -- driver's assignment lookup + checklist submission
    faults/                        -- fault queue, detail, acknowledge, logs, resolve, escalate
  utils/
    jwt.ts, audit.ts, id.ts, alerts.ts
  index.ts                -- app entry point (also wires up error handling)
```

## Getting started

```bash
npm install
cp .env.example .env
npm run migrate     # creates dev.db and applies the schema
npm run seed         # creates roles, 3 demo airports, checklist templates,
                      # a demo shift with 2 vehicle assignments, and one user per role
npm run dev            # starts the API on http://localhost:4000
```

### Using Postgres instead of SQLite

The default `.env` uses SQLite for zero-setup local dev. To run against
Postgres instead — recommended for staging/production, and for any real
multi-airport load:

```bash
# 1. Create a database
createdb afrfms   # or: psql -c "CREATE DATABASE afrfms;"

# 2. Point .env at it
DB_DRIVER="postgres"
DATABASE_URL="postgres://USER:PASSWORD@HOST:5432/afrfms"

# 3. Same commands as above — migrate.ts and seed.ts both detect DB_DRIVER
#    and do the right thing automatically
npm run migrate
npm run seed
npm run dev
```

No application code changes between the two — `src/db/client.ts` is the only
file that knows which database is active. Both `schema.sqlite.sql` and
`schema.postgres.sql` define the same tables; the Postgres variant only
differs in how a handful of timestamp column defaults are expressed (Postgres
has no `datetime('now')`).

This has been verified against a real PostgreSQL 16 instance, not just
written and assumed correct — see "What's been verified" below. One real
bug the switch caught and fixed: Postgres returns `COUNT(*)` as a string
(`bigint`), not a JS number, so a `=== 0` check that worked fine against
SQLite silently failed against Postgres — the vehicle-reactivation-on-fault-
resolve logic wouldn't fire. Every `COUNT(*)` result in the codebase is now
explicitly coerced with `Number(...)` before use.

## Demo logins

The seed script prints all credentials, but for reference — every seeded
user shares the same password:

| Role | CNIC | Password |
|---|---|---|
| GM Fire | `10000-0000009-9` | `Passw0rd!123` |
| CFRO | `10000-0000001-1` | `Passw0rd!123` |
| Superintendent | `10000-0000002-2` | `Passw0rd!123` |
| Supervisor | `10000-0000003-3` | `Passw0rd!123` |
| Team Leader | `10000-0000004-4` | `Passw0rd!123` |
| Driver | `10000-0000005-5` | `Passw0rd!123` |
| Mechanical Technician | `10000-0000006-6` | `Passw0rd!123` |
| Mechanical Officer | `10000-0000007-7` | `Passw0rd!123` |
| Admin | `10000-0000008-8` | `Passw0rd!123` |

**Change or remove these before any real deployment.**

The seed script also creates a demo shift for today's date at the primary
airport, with the two demo vehicles (FCT-001, AMB-004) both assigned to the
demo Driver. Its ID is printed to the console when you run `npm run seed`.

## Endpoints

| Method & Path | Access | Notes |
|---|---|---|
| `POST /auth/login` | Public | Body: `{ cnic, password }` → JWT + user profile |
| `GET /auth/me` | Any authenticated user | Returns the caller's own profile |
| `GET /users` | Admin, GM Fire | Lists all users, all airports |
| `POST /users` | Admin, GM Fire | Creates a user; airport-scoped roles require `airportId` |
| `PATCH /users/:userId` | Admin, GM Fire | Edit name, role, airport, status (active/suspended), and/or reset password |
| `GET /airports` | Any authenticated user | CFRO/Admin see all; everyone else sees only their own |
| `POST /airports` | Admin, GM Fire | Onboards a new airport `{ name, icaoCode, region }` |
| `PATCH /airports/:airportId` | Admin, GM Fire | Edit airport details |
| `GET /airports/:airportId/stations` | Any authenticated user (scoped) | Fire stations/depots at that airport |
| `POST /airports/:airportId/stations` | Superintendent, Admin | Adds a station `{ name }` |
| `GET /airports/:airportId/drivers` | Team Leader, Superintendent, CFRO, Admin, GM Fire | Scoped driver roster, for vehicle-assignment pickers |
| `GET /airports/:airportId/equipment` | Any authenticated user | 403 if `:airportId` isn't the caller's own airport (unless CFRO/Admin) |
| `POST /airports/:airportId/equipment` | Superintendent, Admin | Registers a vehicle `{ regNo, categoryId, make?, model?, year?, stationId? }` |
| `PATCH /airports/:airportId/equipment/:equipmentId` | Superintendent, Admin | Edit any field, including manually setting `status` |
| `DELETE /airports/:airportId/equipment/:equipmentId` | Admin, GM Fire | **Soft** delete — sets `status: 'retired'`; never a hard delete (preserves the historical audit trail) |
| `GET /categories` | Any authenticated user | Lists every equipment category |
| `POST /categories` | Admin, GM Fire | Adds a new equipment category `{ name }` |
| `PATCH /categories/:categoryId` | Admin, GM Fire | Renames a category |
| `GET /categories/:categoryId/checklist-template` | Any authenticated user | Active checklist template (sectioned items) for that equipment category |
| `PATCH /categories/:categoryId/checklist-template` | Admin, GM Fire | Full sync of the template's items — update, add, or retire in one call |
| `GET /airports/:airportId/shift-groups` | Any authenticated user (scoped) | Rotation crews (e.g. "A", "B") with member counts, for the roster board |
| `POST /airports/:airportId/shift-groups` | CFRO (own airport), Admin, GM Fire | Creates a crew `{ name }` |
| `PATCH /airports/:airportId/shift-groups/:groupId` | CFRO (own airport), Admin, GM Fire | Rename and/or set which shift type (morning/evening/night) the crew currently covers |
| `DELETE /airports/:airportId/shift-groups/:groupId` | CFRO (own airport), Admin, GM Fire | Blocked if the crew still has members |
| `GET /airports/:airportId/shift-eligible-staff` | CFRO, Superintendent, Admin, GM Fire | Roster of Team Leaders/Superintendents/Supervisors/Drivers at the airport, with current crew |
| `POST /airports/:airportId/shift-groups/:groupId/members` | CFRO (own airport), Admin, GM Fire | Appoints a staff member to this crew `{ userId }` — narrower than the general user-edit endpoint; can't touch role/status/password |
| `DELETE /airports/:airportId/shift-groups/:groupId/members/:userId` | CFRO (own airport), Admin, GM Fire | Removes someone from a crew |
| `POST /airports/:airportId/shifts` | Team Leader, Superintendent, CFRO, Admin, GM Fire | Opens a shift `{ shiftDate, shiftType, stationId? }` |
| `GET /airports/:airportId/shifts?date=` | Team Leader, Supervisor, Superintendent, CFRO, Admin, GM Fire | Browse shifts for an airport |
| `POST /airports/:airportId/shifts/:shiftId/assignments` | Team Leader, Superintendent, CFRO, Admin, GM Fire | Assigns an active vehicle to a driver, and optionally the on-duty Supervisor/Superintendent `{ equipmentId, driverId, supervisorId?, superintendentId? }` |
| `PATCH /airports/:airportId/shifts/:shiftId/assignments/:assignmentId` | Team Leader, Superintendent, CFRO, Admin, GM Fire | Updates the crew on a still-pending assignment `{ driverId?, supervisorId?, superintendentId? }` — locked once that vehicle's checklist is submitted |
| `GET /airports/:airportId/shifts/:shiftId` | Team Leader, Supervisor, Superintendent, CFRO, Admin, GM Fire | Live view: every assignment (incl. crew) + whether it's been checked in |
| `POST /airports/:airportId/shifts/:shiftId/assignments/:assignmentId/exception` | Team Leader, Superintendent, CFRO, Admin, GM Fire | Logs a vehicle as not-in-service for the shift `{ reason }` (instead of an inspection) |
| `POST /airports/:airportId/shifts/:shiftId/report` | Team Leader, Superintendent, CFRO, Admin, GM Fire | Issues the shift report `{ summary? }`; requires every assignment to be `completed` or `exception` |
| `GET /airports/:airportId/shifts/:shiftId/report` | Team Leader, Supervisor, Superintendent, CFRO, Admin, GM Fire | Retrieves an issued report (JSON, including the full fleet breakdown) |
| `GET /airports/:airportId/shifts/:shiftId/report/pdf` | Team Leader, Supervisor, Superintendent, CFRO, Admin, GM Fire | Downloads the same report as a formatted PDF handover document |
| `GET /shifts/today-for-me` | Driver | Which shift(s) today have a vehicle assigned to the caller |
| `GET /shifts/:shiftId/my-assignments` | Driver | **Every** vehicle assigned to the caller for this shift — a driver can have more than one |
| `GET /shifts/:shiftId/my-assignments/:assignmentId` | Driver | One specific assignment's vehicle + checklist form |
| `POST /shifts/:shiftId/my-assignments/:assignmentId/inspection` | Driver | Submits the checklist for that one vehicle `{ odometerReading, responses: [{checklistItemId, value, remarks?, photoUrl?}] }` |
| `GET /airports/:airportId/faults?status=&severity=` | Mech. Technician, Mech. Officer, Supervisor, Superintendent, CFRO, Admin, GM Fire | Fault queue for the airport, with a computed `isOverdue` flag |
| `GET /faults/:faultId` | Mech. Technician, Mech. Officer, Supervisor, Superintendent, CFRO, Admin, GM Fire | Full detail: alerts (who was notified, ack state) + diagnosis/repair log |
| `POST /faults/:faultId/acknowledge` | Mech. Technician, Mech. Officer | Acknowledges the alert routed to the caller; `open` → `in_progress` |
| `POST /faults/:faultId/logs` | Mech. Technician, Mech. Officer | Adds a diagnosis/repair note `{ note }` |
| `POST /faults/:faultId/resolve` | Mech. Officer, Admin, GM Fire | Closes the fault `{ resolutionNotes }`; reactivates the vehicle if no other open critical fault remains |
| `POST /faults/:faultId/escalate` | Mech. Officer, Admin, GM Fire | Manually escalates to the airport's Superintendent(s) and CFRO `{ reason }` |

### Why assignments are addressed explicitly (`:assignmentId`, not just "the driver's vehicle")

A driver can have more than one vehicle assigned in the same shift — e.g.
covering two vehicles in a short-staffed shift. Every driver-facing endpoint
therefore operates on one named assignment at a time rather than assuming
"the" assignment; `GET .../my-assignments` lists all of them, and the
detail/submit endpoints take an explicit `:assignmentId`. Submitting for one
vehicle never affects the others.

## How checklist submission → fault → alert works

- Each boolean checklist item answered `"fail"` automatically creates a
  **Fault** record.
- If the failed item is flagged `isCritical` in the template, the fault's
  severity is `critical` **and the vehicle is immediately set to `grounded`**.
- Every fault dispatches **Alerts**: minor faults notify Mechanical
  Technicians at that airport; critical faults notify Technicians *and*
  Mechanical Officers.
- A vehicle can only be submitted once per shift (`409` on a repeat attempt).

## Admin (and Superintendent, where noted) management capabilities

- **Equipment** — Superintendent (own airport) or Admin (any airport) can
  register new vehicles, edit any field (including manually setting status —
  e.g. sending one to `under_maintenance`), and retire vehicles. Retiring is
  always a soft delete (`status: 'retired'`), never a hard delete, since the
  vehicle is referenced by historical inspections and faults.
- **Equipment categories** — Admin can add new categories (e.g. a vehicle
  class not covered by the defaults) and rename existing ones. Renaming is
  safe everywhere: vehicles and checklist templates reference a category by
  id, not name, so nothing else needs to change.
- **Airports** — Admin can onboard new airports and edit existing ones.
- **Stations** — Superintendent/Admin can add fire depots/stations at an airport.
- **Shift groups (rotation crews)** — Admin can organize Team Leaders,
  Superintendents, Supervisors, and Drivers into named crews (e.g. "A", "B",
  "C", "D") per airport, and set which shift type (morning/evening/night)
  each crew currently covers — a simple roster board. This is independent of
  the day-to-day Shift records Team Leaders open; it's a scheduling aid, not
  itself part of the inspection workflow.
- **Users** — Admin can edit any user's name, role, airport assignment,
  shift-group (crew) assignment, active/suspended status, and reset their
  password. Changing role re-validates the same national-vs-airport-scope
  rule as user creation, and clears the shift group if the new role doesn't
  rotate through one (only Team Leader/Superintendent/Supervisor/Driver do).
- **Checklist templates** — Admin can edit the inspection checklist per
  equipment category: update existing items, add new ones, and retire ones
  no longer needed — all in a single `PATCH` call. Retired items are never
  hard-deleted (so historical inspection responses that reference them stay
  intact); they're just excluded from the active template going forward.

## The PDF shift handover report

`GET /airports/:airportId/shifts/:shiftId/report/pdf` renders a formatted,
downloadable PDF version of an issued shift report — built for an actual
physical or digital handover between outgoing and incoming shift leaders:

- **Every vehicle at the airport**, not just ones assigned to this shift —
  so nothing in the fleet is silently left off the handover document.
- **Previous vs. current odometer reading** per vehicle: the previous
  reading is the most recent inspection submission before this shift's (or
  the last known reading, if the vehicle wasn't inspected this shift).
- **Who checked each vehicle** (the driver), and its status this shift —
  inspected, logged as an exception (with the reason), or not assigned.
- **Every fault raised this shift**, with severity and whether it was
  rectified (resolved) by the time the report was issued.
- **The Team Leader's handover comments** (the `summary` text).
- **A signature block** for the current and previous shift leader — the
  previous shift leader is looked up automatically (the most recent earlier
  shift at the same airport, ordered by date then morning/evening/night).

The data is captured as a JSON snapshot (`shift_reports.details`) at the
moment the report is generated, not recomputed on every download — so the
document a leader signs reflects what was true at handover time, unaffected
by faults being resolved or equipment being edited afterward. The table
paginates automatically (tested with 45 synthetic rows across 3 pages, with
the header and footer correctly repeating on each).

## How fault resolution works

- A Technician or Officer **acknowledges** their alert, which moves the fault
  `open` → `in_progress`.
- Either can add **diagnosis/repair log entries** as they work the fault.
- Only a **Mechanical Officer** (or Admin) can **resolve** a fault — this
  matches the Architecture Doc's "Mechanical Officer reviews and closes the
  Fault" sign-off rule. On resolve, if the vehicle has no other open/
  in-progress critical fault, it's automatically set back to `active`.
- A Mechanical Officer can also **escalate** a fault to the airport's
  Superintendent(s) at any time.
- **Auto-escalation timers** (the Architecture Doc's "escalate after 15/45
  minutes if unacknowledged"): there's no background scheduler in this
  foundation, so this is surfaced as a computed `isOverdue` flag on
  `GET /airports/:airportId/faults` rather than an active push. A real
  deployment would run a periodic job (cron / worker queue) that checks the
  same condition and fires the escalation Alert automatically — see the
  comment above `CRITICAL_OVERDUE_MINUTES` in `faults.routes.ts`.

## How shift report generation works

- A shift report can only be generated once **every** vehicle assignment on
  that shift is either `completed` (inspection submitted) or `exception`
  (logged as not-in-service by the Team Leader) — never while any are still
  `pending`.
- The report is auto-compiled: vehicles inspected, vehicles excepted, faults
  raised (by severity), faults resolved during the shift, and a computed
  **fleet health score** (100, minus 20 per critical fault and 5 per minor
  fault, floored at 0).
- The Team Leader can add a free-text summary; once issued, a report can't be
  regenerated for the same shift (`409` on a repeat attempt) — this matches
  the Architecture Doc's "finalized report is locked" behavior.

## How the access control works

Every protected route runs `requireAuth` first, which verifies the JWT and
attaches `{ userId, role, isNational, airportId }` to `req.user` — **the
server never trusts client-claimed identity, only what it decoded from a
validly signed token.**

- `requireRole(...roles)` — allow-lists which roles can hit a route.
- `requireAirportScope` — for routes with an `:airportId` URL param, blocks
  the request unless the caller is national-scope (CFRO/Admin) or the
  `:airportId` matches the caller's own assigned airport.
- `canAccessAirport(user, airportId)` — the same rule as a plain function,
  for routes (like `/faults/:faultId` or `/shifts/:shiftId/inspections`)
  that must look up which airport a resource belongs to *before* they can
  check access.

## Error handling

Express 4 does not automatically catch errors thrown inside `async` route
handlers — left unpatched, an error in one request can crash the *entire
process*. This project uses `express-async-errors` (imported once, at the
top of `index.ts`) to route those errors to a global error-handling
middleware instead, which logs the error and returns a clean
`500 { error: "Internal server error" }` — one bad request can no longer take
the whole API down.

## Quick manual test

```bash
# Login as a Driver
curl -s -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"cnic":"10000-0000005-5","password":"Passw0rd!123"}'

# See every vehicle assigned to you for today's seeded demo shift
# (grab <shiftId> from the seed script's console output — the demo driver
# has TWO vehicles assigned, exactly to exercise the multi-vehicle path)
curl -s http://localhost:4000/shifts/<shiftId>/my-assignments -H "Authorization: Bearer <token>"

# Fetch the checklist for one specific vehicle (grab <assignmentId> from above)
curl -s http://localhost:4000/shifts/<shiftId>/my-assignments/<assignmentId> -H "Authorization: Bearer <token>"

# Submit the checklist for that vehicle — a "fail" on a critical item grounds
# it, creates a Fault, and dispatches Alerts (equipmentGrounded: true in the
# response). The OTHER assigned vehicle is unaffected and still submittable.
curl -s -X POST http://localhost:4000/shifts/<shiftId>/my-assignments/<assignmentId>/inspection \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"odometerReading": 18400, "responses": [{"checklistItemId":"<itemId>","value":"fail","remarks":"Oil low"}]}'

# As the Mechanical Officer, resolve the fault it created — the vehicle
# reactivates automatically
curl -s -X POST http://localhost:4000/faults/<faultId>/resolve \
  -H "Authorization: Bearer <officerToken>" -H "Content-Type: application/json" \
  -d '{"resolutionNotes":"Oil topped up, pressure-tested OK"}'
```

## What's been verified

Every module below was tested live against a running server (not just
type-checked) — login for all 8 roles; cross-airport 403s; role-guard 403s;
a critical checklist fail creating a Fault, dispatching Alerts to the right
roles, and grounding the vehicle; acknowledge → diagnose → resolve moving a
fault through its full lifecycle and reactivating the vehicle; a Team Leader
being blocked from generating a report until every vehicle has a submission
or a logged exception, then successfully generating one; and duplicate
report generation correctly rejected.

The 30-point test in `../web/integration-test.mjs` specifically includes a
regression check for a real bug reported after initial use: a driver with
**more than one vehicle** assigned in the same shift couldn't inspect the
second one (the old `/my-assignment` endpoint only ever returned the first
match). The test explicitly submits vehicle #1, asserts vehicle #2 is still
independently fetchable and *not* marked submitted, then submits #2 too —
proving the fix rather than just the API shape. It also covers every Admin/
GM Fire CRUD capability: equipment create/update/retire, equipment category
create/rename, airport create/update, user edit (name/role/airport/
shift-group/status/password), checklist template editing, shift-group
(crew) creation and roster assignment, and the PDF handover report (verified
as a real, non-trivial PDF file — checked file signature, content-type, and
minimum size, plus a separate synthetic 45-row test to confirm multi-page
pagination, headers, and footers all render correctly). It also confirms a
non-Admin role is correctly blocked (403) from the checklist-editing
endpoint, that a national role (GM Fire) cannot be assigned a shift group,
that CFRO is genuinely airport-scoped now (sees only their own airport, not
all of them), and that CFRO can open shifts and manage shift-group crews at
their airport while GM Fire retains full national CRUD.

This full sequence has been run against **both drivers** — SQLite and a
real, separately installed PostgreSQL 16 instance — with all 30 checks
passing on each. The Postgres run is what caught the `COUNT(*)`
bigint-as-string bug mentioned above; it would not have surfaced under
SQLite-only testing.

## Production notes

- Set a strong, random `JWT_SECRET` (e.g. `openssl rand -hex 32`).
- Use `DB_DRIVER=postgres` (see above) — SQLite is fine for local dev but
  not intended for concurrent multi-airport production load.
- Create a dedicated Postgres role for the app rather than using a superuser;
  grant it only what it needs on the `afrfms` database.
- Put this behind HTTPS/TLS; never run it in plaintext HTTP outside local dev.
- Rotate/replace all seeded demo passwords before go-live.
- Replace the `isOverdue` computed flag with a real scheduled job (cron /
  worker queue) that dispatches actual escalation Alerts, and wire real
  push/SMS transport (FCM, SMS gateway) into `dispatchAlertsForFault`
  (`src/utils/alerts.ts`) — right now Alerts are recorded in the database but
  not actually pushed anywhere.
- Set up regular Postgres backups (`pg_dump` on a schedule, or your hosting
  provider's managed backup feature) — there is none configured here.

## What's next

Per the Architecture Document's roadmap: a web dashboard (CFRO/Superintendent
fleet-readiness views, Mechanical Officer's fault queue UI) and/or the
mobile driver app, real push/SMS integration, and — further out — Phase 3
items like spare-parts inventory and crew scheduling.
