-- AFRFMS production database schema (PostgreSQL).
-- Mechanically derived from schema.sqlite.sql (see that file for the dev
-- equivalent) — same tables, same TEXT-based ids/timestamps for a 1:1 app-
-- code match, only the `datetime('now')` defaults differ (Postgres has no
-- such built-in; to_char(...) reproduces the exact same string format).
-- See the Architecture Document (Section 5) for the full entity rationale.


CREATE TABLE IF NOT EXISTS roles (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE, -- GM_FIRE | ADMIN | CFRO | TEAM_LEADER | SR_SUPDT | SUPDT | SUPVR | ASSTT | DRIVER | MECH_TECHNICIAN | MECH_OFFICER
  description  TEXT NOT NULL,
  is_national  INTEGER NOT NULL DEFAULT 0 -- 1 = national-scope role (GM_FIRE, ADMIN), 0 = airport-scoped
);

CREATE TABLE IF NOT EXISTS airports (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  icao_code     TEXT NOT NULL UNIQUE,
  region        TEXT NOT NULL,
  shift_pattern TEXT NOT NULL DEFAULT '3_shift', -- 3_shift (morning/evening/night, 8hr each) | 2_shift (morning/night, 12hr each)
  created_at    TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- ---------------------------------------------------------------------------
-- Shift crew groups ("A", "B", "C", "D" rotation crews) — Architecture Doc
-- extension: CFRO organizes Team Leaders, Sr Supdts/Supdts, Supvrs, Asstts,
-- and Drivers into named rotating crews per airport. Which crew actually
-- works a given shift is chosen when that Shift is opened (shifts.shift_group_id
-- below) — a crew has no fixed shift type of its own, since crews rotate
-- across different shifts by date.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shift_groups (
  id                  TEXT PRIMARY KEY,
  airport_id          TEXT NOT NULL REFERENCES airports(id),
  name                TEXT NOT NULL -- e.g. "A", "B", "C", "D"
);
CREATE INDEX IF NOT EXISTS idx_shift_groups_airport ON shift_groups(airport_id);

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  full_name      TEXT NOT NULL,
  cnic           TEXT NOT NULL UNIQUE,
  phone          TEXT,
  password_hash  TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active', -- active | suspended
  created_at     TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  last_login_at  TEXT,
  role_id        TEXT NOT NULL REFERENCES roles(id),
  airport_id     TEXT REFERENCES airports(id), -- NULL for national-scope users (CFRO, ADMIN)
  shift_group_id TEXT REFERENCES shift_groups(id) -- NULL if not on a rotation crew
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_airport ON users(airport_id);
CREATE INDEX IF NOT EXISTS idx_users_shift_group ON users(shift_group_id);

CREATE TABLE IF NOT EXISTS stations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  airport_id  TEXT NOT NULL REFERENCES airports(id)
);
CREATE INDEX IF NOT EXISTS idx_stations_airport ON stations(airport_id);

CREATE TABLE IF NOT EXISTS equipment_categories (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE -- Fire Crash Tender, Domestic Fire Tender, Ambulance, Bowser, Jeep, ...
);

CREATE TABLE IF NOT EXISTS equipment (
  id                TEXT PRIMARY KEY,
  reg_no            TEXT NOT NULL UNIQUE,
  make              TEXT,
  model             TEXT,
  year              INTEGER,
  current_odometer  INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'active', -- active | grounded | under_maintenance | retired
  airport_id        TEXT NOT NULL REFERENCES airports(id),
  station_id        TEXT REFERENCES stations(id),
  category_id       TEXT NOT NULL REFERENCES equipment_categories(id)
);
CREATE INDEX IF NOT EXISTS idx_equipment_airport ON equipment(airport_id);
CREATE INDEX IF NOT EXISTS idx_equipment_category ON equipment(category_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id           TEXT PRIMARY KEY,
  action       TEXT NOT NULL, -- e.g. LOGIN, USER_CREATED, EQUIPMENT_GROUNDED
  entity_type  TEXT,
  entity_id    TEXT,
  metadata     TEXT, -- JSON-encoded string
  timestamp    TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  user_id      TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);

-- ---------------------------------------------------------------------------
-- Checklist engine (Architecture Doc, Section 6.3): templates are configured
-- per EquipmentCategory, not hard-coded per vehicle. Only one template per
-- category should have is_active = 1 at a time; older versions are kept for
-- historical accuracy (past submissions still reference the item ids they
-- were answered against).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS checklist_templates (
  id              TEXT PRIMARY KEY,
  category_id     TEXT NOT NULL REFERENCES equipment_categories(id),
  version         INTEGER NOT NULL DEFAULT 1,
  is_active       INTEGER NOT NULL DEFAULT 1,
  effective_date  TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_templates_category ON checklist_templates(category_id);

CREATE TABLE IF NOT EXISTS checklist_items (
  id           TEXT PRIMARY KEY,
  template_id  TEXT NOT NULL REFERENCES checklist_templates(id),
  section      TEXT NOT NULL, -- e.g. "Engine & Chassis", "Water/Foam System"
  label        TEXT NOT NULL,
  input_type   TEXT NOT NULL, -- boolean | numeric | text
  is_critical  INTEGER NOT NULL DEFAULT 0, -- 1 = a "fail" auto-grounds the vehicle
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1 -- 0 = retired/edited-out; kept for historical response integrity
);
CREATE INDEX IF NOT EXISTS idx_items_template ON checklist_items(template_id);

-- ---------------------------------------------------------------------------
-- Shifts & assignments (Architecture Doc, Section 4 & 7.1)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shifts (
  id             TEXT PRIMARY KEY,
  airport_id     TEXT NOT NULL REFERENCES airports(id),
  station_id     TEXT REFERENCES stations(id),
  shift_group_id TEXT NOT NULL REFERENCES shift_groups(id), -- the crew (A/B/C/D) on duty for this shift
  shift_date     TEXT NOT NULL, -- YYYY-MM-DD
  shift_type     TEXT NOT NULL, -- morning | evening | night (3_shift airports) or morning | night (2_shift airports, 12hr each)
  team_leader_id TEXT NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_shifts_airport ON shifts(airport_id);
CREATE INDEX IF NOT EXISTS idx_shifts_shift_group ON shifts(shift_group_id);

CREATE TABLE IF NOT EXISTS shift_assignments (
  id                TEXT PRIMARY KEY,
  shift_id          TEXT NOT NULL REFERENCES shifts(id),
  equipment_id      TEXT NOT NULL REFERENCES equipment(id),
  driver_id         TEXT NOT NULL REFERENCES users(id),
  supervisor_id     TEXT REFERENCES users(id), -- optional: the Supervisor on duty for this vehicle this shift
  superintendent_id TEXT REFERENCES users(id), -- optional: the Superintendent on duty for this vehicle this shift
  status            TEXT NOT NULL DEFAULT 'pending', -- pending | completed | exception
  exception_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_assignments_shift ON shift_assignments(shift_id);
CREATE INDEX IF NOT EXISTS idx_assignments_driver ON shift_assignments(driver_id);

-- ---------------------------------------------------------------------------
-- Daily inspection submissions (Architecture Doc, Section 6.4 & 7.1)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inspection_submissions (
  id               TEXT PRIMARY KEY,
  equipment_id     TEXT NOT NULL REFERENCES equipment(id),
  shift_id         TEXT NOT NULL REFERENCES shifts(id),
  driver_id        TEXT NOT NULL REFERENCES users(id),
  template_id      TEXT NOT NULL REFERENCES checklist_templates(id),
  odometer_reading INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'submitted', -- submitted (draft/offline-queued handled client-side)
  submitted_at     TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_submissions_shift ON inspection_submissions(shift_id);
CREATE INDEX IF NOT EXISTS idx_submissions_equipment ON inspection_submissions(equipment_id);

CREATE TABLE IF NOT EXISTS inspection_responses (
  id                 TEXT PRIMARY KEY,
  submission_id      TEXT NOT NULL REFERENCES inspection_submissions(id),
  checklist_item_id  TEXT NOT NULL REFERENCES checklist_items(id),
  value              TEXT NOT NULL, -- "pass" | "fail" for boolean items; raw value otherwise
  remarks            TEXT,
  photo_url          TEXT
);
CREATE INDEX IF NOT EXISTS idx_responses_submission ON inspection_responses(submission_id);

-- ---------------------------------------------------------------------------
-- Faults (Architecture Doc, Section 6.5) — created automatically from any
-- failed checklist item. Alerting/notification dispatch is a later module;
-- this table is the record that a future Alert will reference.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS faults (
  id             TEXT PRIMARY KEY,
  submission_id  TEXT NOT NULL REFERENCES inspection_submissions(id),
  response_id    TEXT NOT NULL REFERENCES inspection_responses(id),
  equipment_id   TEXT NOT NULL REFERENCES equipment(id),
  description    TEXT NOT NULL,
  severity       TEXT NOT NULL, -- minor | critical
  status         TEXT NOT NULL DEFAULT 'open', -- open | in_progress | resolved
  reported_at    TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  resolved_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_faults_equipment ON faults(equipment_id);
CREATE INDEX IF NOT EXISTS idx_faults_status ON faults(status);

-- ---------------------------------------------------------------------------
-- Alerts (Architecture Doc, Section 6.5) — one row per person notified about
-- a Fault. Real push/SMS dispatch is an integration concern (FCM/SMS gateway
-- per the Architecture Doc's tech stack); this table is the system-of-record
-- for who was notified, when, and whether they acknowledged.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS alerts (
  id                TEXT PRIMARY KEY,
  fault_id          TEXT NOT NULL REFERENCES faults(id),
  recipient_user_id TEXT NOT NULL REFERENCES users(id),
  recipient_role    TEXT NOT NULL,
  channel           TEXT NOT NULL DEFAULT 'in_app', -- in_app | sms
  sent_at           TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  acknowledged_at   TEXT,
  resolved_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_fault ON alerts(fault_id);
CREATE INDEX IF NOT EXISTS idx_alerts_recipient ON alerts(recipient_user_id);

-- Diagnosis/repair log entries a Technician or Officer adds while working a fault.
CREATE TABLE IF NOT EXISTS fault_logs (
  id          TEXT PRIMARY KEY,
  fault_id    TEXT NOT NULL REFERENCES faults(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  note        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_fault_logs_fault ON fault_logs(fault_id);

-- ---------------------------------------------------------------------------
-- Shift Reports (Architecture Doc, Section 6.6 & 7.3) — auto-compiled,
-- Team-Leader-issued summary of a completed shift.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shift_reports (
  id                       TEXT PRIMARY KEY,
  shift_id                 TEXT NOT NULL UNIQUE REFERENCES shifts(id),
  generated_by             TEXT NOT NULL REFERENCES users(id),
  summary_text             TEXT,
  fleet_health_score       INTEGER NOT NULL,
  vehicles_inspected       INTEGER NOT NULL,
  vehicles_exception       INTEGER NOT NULL DEFAULT 0,
  faults_raised_critical   INTEGER NOT NULL DEFAULT 0,
  faults_raised_minor      INTEGER NOT NULL DEFAULT 0,
  faults_resolved          INTEGER NOT NULL DEFAULT 0,
  details                  TEXT, -- JSON snapshot: full per-equipment fleet breakdown at generation time, for the PDF handover document
  generated_at             TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);


