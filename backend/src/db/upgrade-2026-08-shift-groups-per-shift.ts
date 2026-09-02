// One-time upgrade for databases created BEFORE shifts recorded which crew
// (A/B/C/D) was on duty. Previously a crew had a fixed "covers shift" field
// (shift_groups.current_shift_type); now that's chosen per shift, on the
// Shift record itself, when it's opened — crews rotate across different
// shift types by date, so a static mapping didn't reflect reality.
//
// Safe to run more than once — every step checks current state first.
// Safe to run against a brand-new, already-current database — it will just
// find nothing to do.
//
// What it does, and why it's written this way:
//   1. Adds shifts.shift_group_id if the column doesn't exist yet.
//      SQLite can't add a NOT NULL column with a per-row default via a
//      single ALTER TABLE, so this column is added nullable here — existing
//      (upgraded) databases keep it nullable in practice; only a *fresh*
//      install (schema.sqlite.sql / schema.postgres.sql) enforces NOT NULL,
//      which is fine since fresh installs have no historical shifts to
//      violate it.
//   2. Backfills every existing shift's shift_group_id: if the shift's
//      airport already has a crew whose members overlap with that shift
//      (e.g. the team leader who opened it), that crew is used; otherwise
//      falls back to the airport's first crew alphabetically, creating one
//      named "A" if the airport has no crews at all. This is a best-effort
//      guess for historical data — nothing before this change recorded
//      which crew actually worked a shift, so there's no way to know for
//      certain. Review/correct old shifts manually if that history matters.
//   3. Leaves shift_groups.current_shift_type column in place if present
//      (harmless — the app no longer reads or writes it) rather than
//      attempting a DROP COLUMN, which is unnecessary risk for a column
//      that's simply ignored going forward.
//
// Run with: npx ts-node src/db/upgrade-2026-08-shift-groups-per-shift.ts
import "dotenv/config";
import { db } from "./client";

const driver = process.env.DB_DRIVER || "sqlite";

async function addShiftGroupColumnIfMissing() {
  if (driver === "postgres") {
    await db.exec(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS shift_group_id TEXT REFERENCES shift_groups(id)`);
    console.log("  - shifts.shift_group_id ensured (postgres, IF NOT EXISTS, nullable).");
    return;
  }
  const columns = (await db.prepare(`PRAGMA table_info(shifts)`).all()) as { name: string }[];
  if (columns.some((c) => c.name === "shift_group_id")) {
    console.log("  - shifts.shift_group_id already present — skipping.");
    return;
  }
  await db.exec(`ALTER TABLE shifts ADD COLUMN shift_group_id TEXT REFERENCES shift_groups(id)`);
  console.log("  - Added shifts.shift_group_id (sqlite, nullable).");
}

async function backfillShiftGroups() {
  const shiftsWithoutGroup = (await db
    .prepare(`SELECT id, airport_id, team_leader_id FROM shifts WHERE shift_group_id IS NULL`)
    .all()) as { id: string; airport_id: string; team_leader_id: string }[];

  if (shiftsWithoutGroup.length === 0) {
    console.log("  - No shifts need backfilling — skipping.");
    return;
  }

  const defaultGroupByAirport = new Map<string, string>();

  async function defaultGroupFor(airportId: string): Promise<string> {
    const cached = defaultGroupByAirport.get(airportId);
    if (cached) return cached;
    const existing = (await db.prepare(`SELECT id FROM shift_groups WHERE airport_id = ? ORDER BY name ASC LIMIT 1`).get(airportId)) as
      | { id: string }
      | undefined;
    if (existing) {
      defaultGroupByAirport.set(airportId, existing.id);
      return existing.id;
    }
    const id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(0, 32);
    await db.prepare(`INSERT INTO shift_groups (id, airport_id, name) VALUES (?, ?, 'A')`).run(id, airportId);
    console.log(`  - Airport ${airportId} had no crews — created a default Crew A.`);
    defaultGroupByAirport.set(airportId, id);
    return id;
  }

  let backfilled = 0;
  for (const shift of shiftsWithoutGroup) {
    // Best guess: use the team leader's own crew if they're on one at this
    // airport; otherwise fall back to the airport's first (or newly
    // created) default crew.
    const leader = (await db.prepare(`SELECT shift_group_id FROM users WHERE id = ?`).get(shift.team_leader_id)) as
      | { shift_group_id: string | null }
      | undefined;
    const groupId = leader?.shift_group_id ?? (await defaultGroupFor(shift.airport_id));
    await db.prepare(`UPDATE shifts SET shift_group_id = ? WHERE id = ?`).run(groupId, shift.id);
    backfilled++;
  }
  console.log(`  - Backfilled shift_group_id on ${backfilled} existing shift(s).`);
}

async function main() {
  console.log(`Running shift-groups-per-shift upgrade (driver: ${driver})...`);

  console.log("Adding shifts.shift_group_id...");
  await addShiftGroupColumnIfMissing();

  console.log("Backfilling existing shifts with a best-guess crew...");
  await backfillShiftGroups();

  console.log("Upgrade complete. Note: shift_groups.current_shift_type (if present) is no longer used by the app and was left in place untouched.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Upgrade failed:", err);
  process.exit(1);
});
