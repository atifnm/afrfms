# AFRFMS Web — Dashboard

The web app for the Airport Fire & Rescue Fleet Management System. Covers
every role except Driver-on-the-move (which this same app also serves, on a
phone browser, via a mobile-first checklist screen).

Wired to, and integration-tested against, the `afrfms-backend` in the sibling
folder — see that project's README for API details.

## What's in it, by role

| Role | Screens |
|---|---|
| Driver | **My Shift** — every vehicle assigned to them this shift (a driver can have more than one), pick one, checklist form, submit; the others stay independently available |
| Team Leader | **Shifts** — open a shift, assign a vehicle's crew (driver required; supervisor/superintendent optional), live shift view, log exceptions, generate the shift report, **download the PDF handover report** |
| CFRO | Airport-scoped (appointed to one airport): full **Shifts** management (same as Team Leader/Superintendent), plus **Shift Groups** — create rotation crews (A/B/C/D), appoint staff to them, and allot each crew's shift (morning/evening/night) |
| Supervisor / Superintendent | **Shifts** (read, incl. PDF download), **Fault Queue** (read), **Airports & Fleet** |
| Superintendent | Also: create/edit/retire equipment, add stations, at their own airport |
| Mechanical Technician | **Fault Queue**, fault detail — acknowledge, add diagnosis notes |
| Mechanical Officer | Same as Technician, plus **resolve** and **escalate** |
| Admin / GM Fire | Equivalent national-scope authority everywhere: **Users** (create + edit name/role/airport/shift-group/status/password), **Airports & Fleet** (create/edit airports, full equipment CRUD, any airport), **Checklist Templates** (create/rename equipment categories, edit inspection items), **Shift Groups** (any airport) |

## Stack

- **React 18 + TypeScript + Vite**
- **React Router v6** for routing and role-gated routes
- **Tailwind CSS** with a small custom token set (see "Design" below)
- Plain `fetch` — no heavy data-fetching library, the API surface is small
  enough that a thin typed client (`src/api/client.ts`) is clearer than
  adding a dependency

## Getting started

The backend must be running first (see `../afrfms-backend/README.md`).

```bash
npm install
cp .env.example .env      # points at http://localhost:4000 by default
npm run dev                 # http://localhost:5173
```

Log in with any of the demo credentials from the backend's seed script
(e.g. Team Leader: CNIC `10000-0000004-4`, password `Passw0rd!123`).

## Project layout

```
src/
  api/
    client.ts        -- typed wrapper for every backend endpoint
    types.ts          -- shared TypeScript types mirroring API response shapes
  auth/
    AuthContext.tsx    -- login state, token persistence (localStorage), current user
    guards.tsx           -- RequireAuth, RequireRole route guards
  components/
    Layout.tsx           -- sidebar (desktop) / top bar (mobile) navigation, filtered by role
    StatusBeacon.tsx      -- the app's signature status indicator, used everywhere
    ui.tsx                 -- Card, Button, Field, LoadingSpinner, EmptyState, ErrorBanner
  pages/
    LoginPage.tsx
    DriverAssignmentPage.tsx  -- mobile-first checklist form; lists ALL of a driver's
                                 vehicle assignments for the shift and lets them work
                                 through each independently
    ShiftsPage.tsx / ShiftDetailPage.tsx
    FaultsPage.tsx / FaultDetailPage.tsx
    AirportsPage.tsx           -- fleet view + full equipment/airport CRUD for
                                   Superintendent/Admin (create, edit, retire)
    ChecklistAdminPage.tsx      -- Admin: create/rename equipment categories, edit checklist items
    ShiftGroupsPage.tsx          -- Admin: rotation crews (A/B/C/D) and their shift-type assignment
    UsersPage.tsx                  -- Admin: create + edit any user, incl. shift-group assignment
  utils/
    localId.ts          -- client-side-only IDs for unsaved new rows (e.g. a checklist
                            item not yet saved) — never sent to the API
  App.tsx             -- routes + role-based default landing page
  main.tsx
```

## Design

Built around the Pakistan Airport Authority's own brand colors (deep green
`#00401A`, gold `#CAA202`, sampled directly from the authority's logo) rather
than a generic dashboard template:

- **Type**: Space Grotesk for headings (a technical, instrument-panel feel),
  Inter for UI text and tables, IBM Plex Mono for data — odometer readings,
  registration numbers, CNICs, timestamps — so numbers read like readouts.
- **Signature element**: the *status beacon* — a small dot with a soft ring,
  used consistently for every equipment/fault/alert status throughout the
  app. It's a deliberate echo of the rotating warning beacons on the vehicles
  this system tracks, not a generic badge.
- **Restraint**: a single dashed gold rule (a taxiway-centerline motif) marks
  every page header — used once, not scattered.
- **Mobile-first where it matters**: the Driver's checklist screen — the
  highest-volume, most time-pressured flow — uses large tap targets (Pass/
  Fail as big buttons, not checkboxes) and a fixed bottom submit bar, because
  it's built to be used on a phone on the tarmac, not at a desk.
- Visible keyboard focus and `prefers-reduced-motion` are respected throughout.

## What's been verified

There's no headless browser available in the environment this was built in,
so instead of skipping verification, `integration-test.mjs` in this folder
replicates every single fetch call every page makes — same URLs, same
payload shapes, same response-parsing assumptions — and walks the full
lifecycle end to end against a live backend:

Team Leader opens a shift → assigns vehicles → Driver submits a checklist
for vehicle #1, then independently for vehicle #2 (see below) with a
critical fault on it → equipment grounds automatically → Mechanical
Technician acknowledges and logs a diagnosis → Mechanical Officer resolves
the fault → equipment reactivates automatically → Team Leader generates the
shift report and downloads the PDF handover document → CFRO views the
national airport list → Admin exercises every CRUD capability (equipment,
equipment categories, airports, users, shift-group crews and roster
assignment, checklist templates).

**Includes a specific regression test** for a bug found after initial use: a
driver with more than one vehicle assigned in the same shift couldn't
inspect the second one. The test explicitly asserts that after submitting
vehicle #1, vehicle #2 is still independently fetchable and not incorrectly
marked as submitted — proving the fix actually works, not just that the API
responds.

Run it yourself:

```bash
# with the backend running and freshly migrated+seeded:
node integration-test.mjs
```

All 30 checks pass with zero server-side errors, against both the SQLite and
Postgres backend drivers. This is the strongest verification possible
without a real browser — every data contract between this frontend and the
backend has been exercised, just not the rendered pixels themselves.

## What's not done

- No actual camera-based photo capture for fault evidence — the checklist
  form has a plain "Photo reference / URL" text field as a placeholder. A
  native mobile app (or a browser `<input type="file" capture>`) would
  replace this with real capture.
- No visual/pixel-level QA (screenshots) — see above.
- No offline support in this web build — the Architecture Document's
  offline-first requirement for drivers is intended for the native mobile
  app (React Native), not this browser dashboard.
