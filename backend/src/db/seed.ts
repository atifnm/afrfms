import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "./client";
import { newId } from "../utils/id";

interface RoleDef {
  name: string;
  description: string;
  isNational: boolean;
}

const ROLES: RoleDef[] = [
  { name: "GM_FIRE", description: "General Manager Fire — national oversight and full administrative authority", isNational: true },
  { name: "ADMIN", description: "Developer / System Admin — platform configuration, full administrative authority", isNational: true },
  { name: "CFRO", description: "Chief Fire & Rescue Officer — command at their appointed airport; appoints the Team Leader and all fire crew there and sets their shift assignments", isNational: false },
  { name: "TEAM_LEADER", description: "Shift-in-charge for a rotation crew (A/B/C/D)", isNational: false },
  { name: "SR_SUPDT", description: "Senior Superintendent — firefighter rank, senior to Supdt", isNational: false },
  { name: "SUPDT", description: "Superintendent — firefighter rank", isNational: false },
  { name: "SUPVR", description: "Supervisor — firefighter rank", isNational: false },
  { name: "ASSTT", description: "Assistant — firefighter rank", isNational: false },
  { name: "DRIVER", description: "Special Vehicle Driver", isNational: false },
  { name: "MECH_TECHNICIAN", description: "Mechanical Technician — first-line maintenance", isNational: false },
  { name: "MECH_OFFICER", description: "Mechanical Officer — maintenance sign-off authority", isNational: false },
];

const AIRPORTS = [
  { name: "Jinnah International Airport", icaoCode: "OPKC", region: "Sindh", shiftPattern: "3_shift" as const },
  { name: "Allama Iqbal International Airport", icaoCode: "OPLA", region: "Punjab", shiftPattern: "3_shift" as const },
  // Smaller station: covers around the clock with two 12-hour shifts instead of three 8-hour ones.
  { name: "Bacha Khan International Airport", icaoCode: "OPPS", region: "Khyber Pakhtunkhwa", shiftPattern: "2_shift" as const },
];

const CATEGORIES = ["Fire Crash Tender", "Domestic Fire Tender", "Ambulance", "Bowser", "Jeep"];

const DEMO_PASSWORD = "Passw0rd!123"; // demo/dev only — every seeded user shares this password

async function upsertRole(r: RoleDef): Promise<{ id: string; isNational: boolean }> {
  const existing = (await db.prepare(`SELECT id FROM roles WHERE name = ?`).get(r.name)) as { id: string } | undefined;
  if (existing) return { id: existing.id, isNational: r.isNational };
  const id = newId();
  await db
    .prepare(`INSERT INTO roles (id, name, description, is_national) VALUES (?, ?, ?, ?)`)
    .run(id, r.name, r.description, r.isNational ? 1 : 0);
  return { id, isNational: r.isNational };
}

async function upsertAirport(a: { name: string; icaoCode: string; region: string; shiftPattern: "2_shift" | "3_shift" }): Promise<string> {
  const existing = (await db.prepare(`SELECT id FROM airports WHERE icao_code = ?`).get(a.icaoCode)) as
    | { id: string }
    | undefined;
  if (existing) return existing.id;
  const id = newId();
  await db
    .prepare(`INSERT INTO airports (id, name, icao_code, region, shift_pattern) VALUES (?, ?, ?, ?, ?)`)
    .run(id, a.name, a.icaoCode, a.region, a.shiftPattern);
  return id;
}

async function upsertCategory(name: string): Promise<string> {
  const existing = (await db.prepare(`SELECT id FROM equipment_categories WHERE name = ?`).get(name)) as
    | { id: string }
    | undefined;
  if (existing) return existing.id;
  const id = newId();
  await db.prepare(`INSERT INTO equipment_categories (id, name) VALUES (?, ?)`).run(id, name);
  return id;
}

interface ItemDef {
  section: string;
  label: string;
  inputType: "boolean" | "numeric" | "text";
  isCritical: boolean;
}

async function seedTemplate(categoryId: string, items: ItemDef[]) {
  const existing = (await db
    .prepare(`SELECT id FROM checklist_templates WHERE category_id = ? AND is_active = 1`)
    .get(categoryId)) as { id: string } | undefined;
  if (existing) return;

  const templateId = newId();
  await db
    .prepare(`INSERT INTO checklist_templates (id, category_id, version, is_active) VALUES (?, ?, 1, 1)`)
    .run(templateId, categoryId);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    await db
      .prepare(
        `INSERT INTO checklist_items (id, template_id, section, label, input_type, is_critical, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(newId(), templateId, item.section, item.label, item.inputType, item.isCritical ? 1 : 0, i);
  }
}

const FIRE_CRASH_TENDER_ITEMS: ItemDef[] = [
  { section: "General", label: "Visible body damage", inputType: "boolean", isCritical: false },
  { section: "Engine & Chassis", label: "Engine oil level", inputType: "boolean", isCritical: true },
  { section: "Engine & Chassis", label: "Coolant level", inputType: "boolean", isCritical: true },
  { section: "Engine & Chassis", label: "Visible fluid leaks", inputType: "boolean", isCritical: true },
  { section: "Water/Foam/Pump System", label: "Water tank level", inputType: "boolean", isCritical: true },
  { section: "Water/Foam/Pump System", label: "Foam concentrate level", inputType: "boolean", isCritical: true },
  { section: "Water/Foam/Pump System", label: "Pump pressure test", inputType: "boolean", isCritical: true },
  { section: "Electrical & Lighting", label: "Beacon lights", inputType: "boolean", isCritical: false },
  { section: "Electrical & Lighting", label: "Siren", inputType: "boolean", isCritical: false },
  { section: "Tyres & Brakes", label: "Tyre pressure/tread (all wheels)", inputType: "boolean", isCritical: true },
  { section: "Tyres & Brakes", label: "Brake response", inputType: "boolean", isCritical: true },
  { section: "Safety & PPE", label: "Breathing apparatus present", inputType: "boolean", isCritical: false },
  { section: "General", label: "Remarks", inputType: "text", isCritical: false },
];

const AMBULANCE_ITEMS: ItemDef[] = [
  { section: "General", label: "Interior cleanliness", inputType: "boolean", isCritical: false },
  { section: "Medical Equipment", label: "Oxygen cylinder level", inputType: "boolean", isCritical: true },
  { section: "Medical Equipment", label: "Stretcher condition", inputType: "boolean", isCritical: false },
  { section: "Medical Equipment", label: "First-aid kit stock", inputType: "boolean", isCritical: true },
  { section: "Engine & Chassis", label: "Engine oil/coolant level", inputType: "boolean", isCritical: true },
  { section: "Electrical & Lighting", label: "Emergency lights", inputType: "boolean", isCritical: false },
  { section: "Electrical & Lighting", label: "Siren", inputType: "boolean", isCritical: false },
  { section: "Tyres & Brakes", label: "Tyre condition", inputType: "boolean", isCritical: true },
  { section: "Tyres & Brakes", label: "Brake response", inputType: "boolean", isCritical: true },
  { section: "General", label: "Remarks", inputType: "text", isCritical: false },
];

async function main() {
  console.log(`Seeding (driver: ${process.env.DB_DRIVER || "sqlite"})...`);

  console.log("Seeding roles...");
  const roleRecords: Record<string, { id: string; isNational: boolean }> = {};
  for (const r of ROLES) roleRecords[r.name] = await upsertRole(r);

  console.log("Seeding equipment categories...");
  const categoryIds: Record<string, string> = {};
  for (const name of CATEGORIES) categoryIds[name] = await upsertCategory(name);

  console.log("Seeding checklist templates...");
  await seedTemplate(categoryIds["Fire Crash Tender"], FIRE_CRASH_TENDER_ITEMS);
  await seedTemplate(categoryIds["Ambulance"], AMBULANCE_ITEMS);

  console.log("Seeding airports...");
  const airportIds: string[] = [];
  for (const a of AIRPORTS) airportIds.push(await upsertAirport(a));
  const primaryAirportId = airportIds[0];

  console.log("Seeding a fire station and a couple of demo vehicles...");
  const existingStation = (await db.prepare(`SELECT id FROM stations WHERE airport_id = ? LIMIT 1`).get(primaryAirportId)) as
    | { id: string }
    | undefined;
  let stationId: string;
  if (existingStation) {
    stationId = existingStation.id;
  } else {
    stationId = newId();
    await db
      .prepare(`INSERT INTO stations (id, name, airport_id) VALUES (?, ?, ?)`)
      .run(stationId, "Main Fire Station", primaryAirportId);
  }

  async function upsertEquipment(
    regNo: string,
    make: string,
    model: string,
    year: number,
    odometer: number,
    categoryId: string
  ) {
    const existing = await db.prepare(`SELECT id FROM equipment WHERE reg_no = ?`).get(regNo);
    if (existing) return;
    await db
      .prepare(
        `INSERT INTO equipment (id, reg_no, make, model, year, current_odometer, airport_id, station_id, category_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(newId(), regNo, make, model, year, odometer, primaryAirportId, stationId, categoryId);
  }

  await upsertEquipment("FCT-001", "Rosenbauer", "Panther 6x6", 2021, 18342, categoryIds["Fire Crash Tender"]);
  await upsertEquipment("AMB-004", "Toyota", "Hiace", 2019, 76210, categoryIds["Ambulance"]);

  console.log("Seeding one demo user per role...");
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const demoUsers: { cnic: string; fullName: string; role: string; airportId?: string }[] = [
    { cnic: "10000-0000009-9", fullName: "Zainab Rashid (GM Fire)", role: "GM_FIRE" },
    { cnic: "10000-0000001-1", fullName: "Ayesha Farooq (CFRO)", role: "CFRO", airportId: primaryAirportId },
    { cnic: "10000-0000002-2", fullName: "Imran Sheikh (Sr Supdt)", role: "SR_SUPDT", airportId: primaryAirportId },
    { cnic: "10000-0000010-0", fullName: "Adeel Butt (Supdt)", role: "SUPDT", airportId: primaryAirportId },
    { cnic: "10000-0000003-3", fullName: "Bilal Ahmed (Supvr)", role: "SUPVR", airportId: primaryAirportId },
    { cnic: "10000-0000011-1", fullName: "Hamza Tariq (Asstt)", role: "ASSTT", airportId: primaryAirportId },
    { cnic: "10000-0000004-4", fullName: "Sana Malik (Team Leader)", role: "TEAM_LEADER", airportId: primaryAirportId },
    { cnic: "10000-0000005-5", fullName: "Waqas Iqbal (Driver)", role: "DRIVER", airportId: primaryAirportId },
    { cnic: "10000-0000006-6", fullName: "Kamran Yousaf (Mech. Technician)", role: "MECH_TECHNICIAN", airportId: primaryAirportId },
    { cnic: "10000-0000007-7", fullName: "Fahad Raza (Mech. Officer)", role: "MECH_OFFICER", airportId: primaryAirportId },
    { cnic: "10000-0000008-8", fullName: "Dev Admin", role: "ADMIN" },
  ];

  for (const u of demoUsers) {
    const existing = await db.prepare(`SELECT id FROM users WHERE cnic = ?`).get(u.cnic);
    if (existing) continue;
    const role = roleRecords[u.role];
    await db
      .prepare(`INSERT INTO users (id, full_name, cnic, password_hash, role_id, airport_id) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(newId(), u.fullName, u.cnic, passwordHash, role.id, role.isNational ? null : u.airportId ?? null);
  }

  console.log("Seeding a demo shift with vehicle assignments...");
  const teamLeader = (await db.prepare(`SELECT id FROM users WHERE cnic = '10000-0000004-4'`).get()) as
    | { id: string }
    | undefined;
  const driver = (await db.prepare(`SELECT id FROM users WHERE cnic = '10000-0000005-5'`).get()) as
    | { id: string }
    | undefined;
  const fct = (await db.prepare(`SELECT id FROM equipment WHERE reg_no = 'FCT-001'`).get()) as { id: string } | undefined;
  const amb = (await db.prepare(`SELECT id FROM equipment WHERE reg_no = 'AMB-004'`).get()) as { id: string } | undefined;

  let demoShiftGroupId: string;
  const existingShiftGroup = (await db.prepare(`SELECT id FROM shift_groups WHERE airport_id = ? AND name = 'A'`).get(primaryAirportId)) as
    | { id: string }
    | undefined;
  if (existingShiftGroup) {
    demoShiftGroupId = existingShiftGroup.id;
  } else {
    demoShiftGroupId = newId();
    await db.prepare(`INSERT INTO shift_groups (id, airport_id, name) VALUES (?, ?, 'A')`).run(demoShiftGroupId, primaryAirportId);
  }
  if (teamLeader) {
    await db.prepare(`UPDATE users SET shift_group_id = ? WHERE id = ? AND shift_group_id IS NULL`).run(demoShiftGroupId, teamLeader.id);
  }
  if (driver) {
    await db.prepare(`UPDATE users SET shift_group_id = ? WHERE id = ? AND shift_group_id IS NULL`).run(demoShiftGroupId, driver.id);
  }

  if (teamLeader && driver && fct && amb) {
    const today = new Date().toISOString().slice(0, 10);
    const existingShift = (await db
      .prepare(`SELECT id FROM shifts WHERE airport_id = ? AND shift_date = ? AND shift_type = 'morning'`)
      .get(primaryAirportId, today)) as { id: string } | undefined;

    let shiftId: string;
    if (existingShift) {
      shiftId = existingShift.id;
    } else {
      shiftId = newId();
      await db
        .prepare(
          `INSERT INTO shifts (id, airport_id, station_id, shift_group_id, shift_date, shift_type, team_leader_id)
           VALUES (?, ?, ?, ?, ?, 'morning', ?)`
        )
        .run(shiftId, primaryAirportId, stationId, demoShiftGroupId, today, teamLeader.id);
    }

    const driverId = driver.id;
    async function assign(equipmentId: string) {
      const existing = await db
        .prepare(`SELECT id FROM shift_assignments WHERE shift_id = ? AND equipment_id = ?`)
        .get(shiftId, equipmentId);
      if (existing) return;
      await db
        .prepare(`INSERT INTO shift_assignments (id, shift_id, equipment_id, driver_id) VALUES (?, ?, ?, ?)`)
        .run(newId(), shiftId, equipmentId, driverId);
    }
    await assign(fct.id);
    await assign(amb.id);
    console.log(`  Demo shift ${shiftId} (${today}, morning) — both demo vehicles assigned to Waqas Iqbal`);
  }

  console.log("\nSeed complete. Demo login credentials (all share the same password):");
  console.log(`  Password: ${DEMO_PASSWORD}\n`);
  for (const u of demoUsers) {
    console.log(`  ${u.role.padEnd(16)} CNIC: ${u.cnic}   (${u.fullName})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
