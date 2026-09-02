// One-time upgrade for databases created BEFORE the rank-split change
// (SUPERINTENDENT/SUPERVISOR -> SR_SUPDT/SUPDT/SUPVR/ASSTT) and the
// per-airport shift_pattern column.
//
// Safe to run more than once — every step checks current state first.
// Safe to run against a brand-new, already-current database — it will just
// find nothing to do.
//
// What it does, and why it's written this way:
//   1. Renames the existing SUPERINTENDENT role row to SUPDT, and SUPERVISOR
//      to SUPVR, IN PLACE (same `id`). Every user's `role_id` foreign key is
//      untouched, so nobody's account silently changes what they can do —
//      existing superintendents become Supdt (not the new senior Sr Supdt
//      rank), matching the more common case. A CFRO/Admin can promote
//      specific people to Sr Supdt afterwards through the Users page.
//   2. Inserts the two new roles that didn't exist before, SR_SUPDT and
//      ASSTT, so they're immediately assignable.
//   3. Adds airports.shift_pattern if the column doesn't exist yet, filling
//      existing rows with '3_shift' (every airport's original assumed
//      behaviour, per the old shift_type comment).
//
// Run with: npx ts-node src/db/upgrade-2026-08-rank-split.ts
import "dotenv/config";
import { db } from "./client";

const driver = process.env.DB_DRIVER || "sqlite";

async function renameRole(oldName: string, newName: string, newDescription: string) {
  const existing = (await db.prepare(`SELECT id FROM roles WHERE name = ?`).get(oldName)) as { id: string } | undefined;
  if (!existing) {
    console.log(`  - No '${oldName}' role found (already renamed, or fresh DB) — skipping.`);
    return;
  }
  const alreadyRenamed = await db.prepare(`SELECT id FROM roles WHERE name = ?`).get(newName);
  if (alreadyRenamed) {
    console.log(`  - '${newName}' already exists — skipping rename of '${oldName}'.`);
    return;
  }
  await db.prepare(`UPDATE roles SET name = ?, description = ? WHERE id = ?`).run(newName, newDescription, existing.id);
  console.log(`  - Renamed role '${oldName}' -> '${newName}' (id unchanged, existing users unaffected).`);
}

async function insertRoleIfMissing(name: string, description: string, isNational: boolean) {
  const existing = await db.prepare(`SELECT id FROM roles WHERE name = ?`).get(name);
  if (existing) {
    console.log(`  - Role '${name}' already exists — skipping.`);
    return;
  }
  const id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(0, 32);
  await db.prepare(`INSERT INTO roles (id, name, description, is_national) VALUES (?, ?, ?, ?)`).run(id, name, description, isNational ? 1 : 0);
  console.log(`  - Inserted new role '${name}'.`);
}

async function addShiftPatternColumnIfMissing() {
  if (driver === "postgres") {
    await db.exec(`ALTER TABLE airports ADD COLUMN IF NOT EXISTS shift_pattern TEXT NOT NULL DEFAULT '3_shift'`);
    console.log("  - airports.shift_pattern ensured (postgres, IF NOT EXISTS).");
    return;
  }
  // sqlite: no IF NOT EXISTS for ADD COLUMN — check pragma table_info first.
  const columns = (await db.prepare(`PRAGMA table_info(airports)`).all()) as { name: string }[];
  if (columns.some((c) => c.name === "shift_pattern")) {
    console.log("  - airports.shift_pattern already present — skipping.");
    return;
  }
  await db.exec(`ALTER TABLE airports ADD COLUMN shift_pattern TEXT NOT NULL DEFAULT '3_shift'`);
  console.log("  - Added airports.shift_pattern (sqlite), defaulted every existing airport to '3_shift'.");
}

async function main() {
  console.log(`Running rank-split upgrade (driver: ${driver})...`);

  console.log("Renaming existing roles...");
  await renameRole("SUPERINTENDENT", "SUPDT", "Superintendent — firefighter rank");
  await renameRole("SUPERVISOR", "SUPVR", "Supervisor — firefighter rank");

  console.log("Adding new ranks...");
  await insertRoleIfMissing("SR_SUPDT", "Senior Superintendent — firefighter rank, senior to Supdt", false);
  await insertRoleIfMissing("ASSTT", "Assistant — firefighter rank", false);

  console.log("Adding per-airport shift pattern...");
  await addShiftPatternColumnIfMissing();

  console.log("Upgrade complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Upgrade failed:", err);
  process.exit(1);
});
