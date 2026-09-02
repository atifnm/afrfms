import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client";
import { requireAuth, requireRole, requireAirportScope } from "../../middleware/auth";
import { newId } from "../../utils/id";
import { logAction } from "../../utils/audit";
import { SHIFT_PATTERNS, ShiftPattern, isShiftTypeValidForPattern } from "../../utils/shiftPatterns";

const router = Router();

// GET /airports — National-scope users (ADMIN, GM_FIRE) see every airport.
// Airport-scoped users (CFRO and below) see only their own assignment. This
// is the same scoping pattern every future fleet/checklist/report endpoint
// reuses.
router.get("/", requireAuth, async (req, res) => {
  const rows = req.user!.isNational
    ? (await db.prepare(
          `SELECT a.id, a.name, a.icao_code, a.region, a.shift_pattern,
                  (SELECT COUNT(*) FROM stations s WHERE s.airport_id = a.id) AS station_count,
                  (SELECT COUNT(*) FROM equipment e WHERE e.airport_id = a.id) AS equipment_count
           FROM airports a ORDER BY a.name ASC`
        )
        .all() as any[])
    : (await db.prepare(
          `SELECT a.id, a.name, a.icao_code, a.region, a.shift_pattern,
                  (SELECT COUNT(*) FROM stations s WHERE s.airport_id = a.id) AS station_count,
                  (SELECT COUNT(*) FROM equipment e WHERE e.airport_id = a.id) AS equipment_count
           FROM airports a WHERE a.id = ? ORDER BY a.name ASC`
        )
        .all(req.user!.airportId ?? "__none__") as any[]);

  res.json(
    rows.map((a) => ({
      id: a.id,
      name: a.name,
      icaoCode: a.icao_code,
      region: a.region,
      shiftPattern: a.shift_pattern,
      stationCount: Number(a.station_count),
      equipmentCount: Number(a.equipment_count),
    }))
  );
});

// GET /airports/:airportId/drivers — a scoped roster (id + name only, no
// credentials) so a Team Leader can pick a driver when assigning a vehicle
// to a shift, without needing the Admin-only /users endpoint.
router.get(
  "/:airportId/drivers",
  requireAuth,
  requireAirportScope,
  requireRole("TEAM_LEADER", "SR_SUPDT", "SUPDT", "CFRO", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const rows = await db.prepare(
        `SELECT u.id, u.full_name
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.airport_id = ? AND r.name = 'DRIVER' AND u.status = 'active'
         ORDER BY u.full_name ASC`
      )
      .all(req.params.airportId) as { id: string; full_name: string }[];
    res.json(rows.map((r) => ({ id: r.id, fullName: r.full_name })));
  }
);

const airportSchema = z.object({
  name: z.string().min(1),
  icaoCode: z.string().min(3).max(4),
  region: z.string().min(1),
  shiftPattern: z.enum(SHIFT_PATTERNS as [ShiftPattern, ...ShiftPattern[]]).optional(),
});

// POST /airports — Admin only. Onboards a new airport nationwide
// (Architecture Doc 3: "configure airports and equipment master data").
router.post("/", requireAuth, requireRole("ADMIN", "GM_FIRE"), async (req, res) => {
  const parsed = airportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const existing = await db.prepare(`SELECT id FROM airports WHERE icao_code = ?`).get(parsed.data.icaoCode);
  if (existing) return res.status(409).json({ error: "An airport with this ICAO code already exists" });

  const id = newId();
  const shiftPattern = parsed.data.shiftPattern ?? "3_shift";
  await db
    .prepare(`INSERT INTO airports (id, name, icao_code, region, shift_pattern) VALUES (?, ?, ?, ?, ?)`)
    .run(id, parsed.data.name, parsed.data.icaoCode, parsed.data.region, shiftPattern);

  await logAction(req.user!.userId, "AIRPORT_CREATED", "Airport", id, { ...parsed.data, shiftPattern });
  res.status(201).json({ id, ...parsed.data, shiftPattern });
});

const updateAirportSchema = z.object({
  name: z.string().min(1).optional(),
  icaoCode: z.string().min(3).max(4).optional(),
  region: z.string().min(1).optional(),
});

// PATCH /airports/:airportId — Admin only.
router.patch("/:airportId", requireAuth, requireRole("ADMIN", "GM_FIRE"), async (req, res) => {
  const parsed = updateAirportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const airport = await db.prepare(`SELECT id FROM airports WHERE id = ?`).get(req.params.airportId);
  if (!airport) return res.status(404).json({ error: "Airport not found" });

  const columnMap: Record<string, string> = { name: "name", icaoCode: "icao_code", region: "region" };
  const fields: string[] = [];
  const values: any[] = [];
  for (const [key, column] of Object.entries(columnMap)) {
    if ((parsed.data as any)[key] !== undefined) {
      fields.push(`${column} = ?`);
      values.push((parsed.data as any)[key]);
    }
  }
  if (fields.length === 0) return res.status(400).json({ error: "No fields to update" });

  values.push(req.params.airportId);
  await db.prepare(`UPDATE airports SET ${fields.join(", ")} WHERE id = ?`).run(...values);

  await logAction(req.user!.userId, "AIRPORT_UPDATED", "Airport", req.params.airportId, parsed.data);
  res.json({ ok: true });
});

const shiftPatternSchema = z.object({
  shiftPattern: z.enum(SHIFT_PATTERNS as [ShiftPattern, ...ShiftPattern[]]),
});

// PATCH /airports/:airportId/shift-pattern — CFRO (own airport) or
// Admin/GM_FIRE (any airport) toggles whether this airport runs three
// 8-hour shifts (morning/evening/night) or two 12-hour shifts (morning/
// night). Blocked if it would leave any currently-open (not yet reported)
// shift on a shift_type the new pattern doesn't support, so in-progress
// shifts never end up orphaned from an invalid type.
router.patch(
  "/:airportId/shift-pattern",
  requireAuth,
  requireAirportScope,
  requireRole("CFRO", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const parsed = shiftPatternSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const airport = await db.prepare(`SELECT id, shift_pattern FROM airports WHERE id = ?`).get(req.params.airportId) as
      | { id: string; shift_pattern: ShiftPattern }
      | undefined;
    if (!airport) return res.status(404).json({ error: "Airport not found" });

    if (parsed.data.shiftPattern !== airport.shift_pattern) {
      const openShiftTypes = (await db
        .prepare(
          `SELECT DISTINCT s.shift_type FROM shifts s
           LEFT JOIN shift_reports r ON r.shift_id = s.id
           WHERE s.airport_id = ? AND r.id IS NULL`
        )
        .all(req.params.airportId)) as { shift_type: string }[];
      const incompatible = openShiftTypes.filter((s) => !isShiftTypeValidForPattern(s.shift_type, parsed.data.shiftPattern));
      if (incompatible.length > 0) {
        return res.status(400).json({
          error: `Cannot switch pattern — there's an open shift of type '${incompatible[0].shift_type}' that isn't valid under the new pattern. Issue its report first.`,
        });
      }
    }

    await db.prepare(`UPDATE airports SET shift_pattern = ? WHERE id = ?`).run(parsed.data.shiftPattern, req.params.airportId);
    await logAction(req.user!.userId, "AIRPORT_SHIFT_PATTERN_UPDATED", "Airport", req.params.airportId, { shiftPattern: parsed.data.shiftPattern });
    res.json({ ok: true, shiftPattern: parsed.data.shiftPattern });
  }
);

// GET /airports/:airportId/stations — scoped list, for populating the
// station dropdown when creating/editing equipment.
router.get("/:airportId/stations", requireAuth, requireAirportScope, async (req, res) => {
  const rows = (await db
    .prepare(`SELECT id, name FROM stations WHERE airport_id = ? ORDER BY name ASC`)
    .all(req.params.airportId)) as { id: string; name: string }[];
  res.json(rows.map((s) => ({ id: s.id, name: s.name })));
});

const stationSchema = z.object({ name: z.string().min(1) });

// POST /airports/:airportId/stations — CFRO (their own airport) or Admin/
// GM_FIRE adds a fire depot/station at an airport (large airports may run
// more than one, Architecture Doc Section 4).
router.post(
  "/:airportId/stations",
  requireAuth,
  requireAirportScope,
  requireRole("CFRO", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const parsed = stationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const id = newId();
    await db.prepare(`INSERT INTO stations (id, name, airport_id) VALUES (?, ?, ?)`).run(id, parsed.data.name, req.params.airportId);
    await logAction(req.user!.userId, "STATION_CREATED", "Station", id, { name: parsed.data.name });
    res.status(201).json({ id, name: parsed.data.name });
  }
);

// GET /airports/:airportId/shift-groups — scoped list of rotation crews
// ("A", "B", "C", "D"), with member counts by role, for the roster board.
// Crews have no fixed shift type of their own — which crew covers which
// shift is chosen per shift when it's opened (see POST .../shifts).
router.get("/:airportId/shift-groups", requireAuth, requireAirportScope, async (req, res) => {
  const rows = (await db
    .prepare(
      `SELECT g.id, g.name,
              (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE u.shift_group_id = g.id AND r.name = 'TEAM_LEADER') AS team_leaders,
              (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE u.shift_group_id = g.id AND r.name = 'SR_SUPDT') AS sr_supdts,
              (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE u.shift_group_id = g.id AND r.name = 'SUPDT') AS supdts,
              (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE u.shift_group_id = g.id AND r.name = 'SUPVR') AS supvrs,
              (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE u.shift_group_id = g.id AND r.name = 'ASSTT') AS asstts,
              (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE u.shift_group_id = g.id AND r.name = 'DRIVER') AS drivers
       FROM shift_groups g WHERE g.airport_id = ? ORDER BY g.name ASC`
    )
    .all(req.params.airportId)) as any[];

  res.json(
    rows.map((g) => ({
      id: g.id,
      name: g.name,
      memberCounts: {
        teamLeaders: Number(g.team_leaders),
        srSupdts: Number(g.sr_supdts),
        supdts: Number(g.supdts),
        supvrs: Number(g.supvrs),
        asstts: Number(g.asstts),
        drivers: Number(g.drivers),
      },
    }))
  );
});

const shiftGroupSchema = z.object({ name: z.string().min(1) });

// POST /airports/:airportId/shift-groups — CFRO (own airport) or Admin/GM_FIRE
// (any airport). Creates a rotation crew.
router.post("/:airportId/shift-groups", requireAuth, requireAirportScope, requireRole("CFRO", "ADMIN", "GM_FIRE"), async (req, res) => {
  const parsed = shiftGroupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const existing = await db
    .prepare(`SELECT id FROM shift_groups WHERE airport_id = ? AND name = ?`)
    .get(req.params.airportId, parsed.data.name);
  if (existing) return res.status(409).json({ error: "A shift group with this name already exists at this airport" });

  const id = newId();
  await db.prepare(`INSERT INTO shift_groups (id, airport_id, name) VALUES (?, ?, ?)`).run(id, req.params.airportId, parsed.data.name);
  await logAction(req.user!.userId, "SHIFT_GROUP_CREATED", "ShiftGroup", id, { name: parsed.data.name });
  res.status(201).json({ id, name: parsed.data.name });
});

const updateShiftGroupSchema = z.object({
  name: z.string().min(1),
});

// PATCH /airports/:airportId/shift-groups/:groupId — CFRO (own airport) or
// Admin/GM_FIRE. Renames a crew.
router.patch(
  "/:airportId/shift-groups/:groupId",
  requireAuth,
  requireAirportScope,
  requireRole("CFRO", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const parsed = updateShiftGroupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const group = await db
      .prepare(`SELECT id FROM shift_groups WHERE id = ? AND airport_id = ?`)
      .get(req.params.groupId, req.params.airportId);
    if (!group) return res.status(404).json({ error: "Shift group not found at this airport" });

    await db.prepare(`UPDATE shift_groups SET name = ? WHERE id = ?`).run(parsed.data.name, req.params.groupId);
    await logAction(req.user!.userId, "SHIFT_GROUP_UPDATED", "ShiftGroup", req.params.groupId, parsed.data);
    res.json({ ok: true });
  }
);

// DELETE /airports/:airportId/shift-groups/:groupId — CFRO (own airport) or
// Admin/GM_FIRE. Blocked if anyone is still a member, so a crew can't
// silently vanish out from under assigned personnel.
router.delete(
  "/:airportId/shift-groups/:groupId",
  requireAuth,
  requireAirportScope,
  requireRole("CFRO", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const group = await db
      .prepare(`SELECT id FROM shift_groups WHERE id = ? AND airport_id = ?`)
      .get(req.params.groupId, req.params.airportId);
    if (!group) return res.status(404).json({ error: "Shift group not found at this airport" });

    const memberCount = (await db.prepare(`SELECT COUNT(*) AS cnt FROM users WHERE shift_group_id = ?`).get(req.params.groupId)) as {
      cnt: number;
    };
    if (Number(memberCount.cnt) > 0) {
      return res.status(400).json({ error: "Remove all members from this shift group before deleting it" });
    }

    await db.prepare(`DELETE FROM shift_groups WHERE id = ?`).run(req.params.groupId);
    await logAction(req.user!.userId, "SHIFT_GROUP_DELETED", "ShiftGroup", req.params.groupId);
    res.json({ ok: true });
  }
);

// GET /airports/:airportId/shift-eligible-staff — every Team Leader, Sr
// Supdt, Supdt, Supvr, Asstt, and Driver at this airport, with their
// current shift-group (crew) membership. Two callers rely on this: a CFRO
// appointing people to a crew (ShiftGroupsPage), and a Team Leader/Sr Supdt/
// Supdt picking the Supvr/Sr Supdt/Supdt on duty for a vehicle assignment
// (ShiftDetailPage) — so Team Leader must be included here too.
router.get(
  "/:airportId/shift-eligible-staff",
  requireAuth,
  requireAirportScope,
  requireRole("TEAM_LEADER", "CFRO", "SR_SUPDT", "SUPDT", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const rows = (await db
      .prepare(
        `SELECT u.id, u.full_name, r.name AS role_name, u.shift_group_id, g.name AS shift_group_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN shift_groups g ON g.id = u.shift_group_id
         WHERE u.airport_id = ? AND r.name IN ('TEAM_LEADER', 'SR_SUPDT', 'SUPDT', 'SUPVR', 'ASSTT', 'DRIVER') AND u.status = 'active'
         ORDER BY r.name ASC, u.full_name ASC`
      )
      .all(req.params.airportId)) as any[];

    res.json(
      rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        role: r.role_name,
        shiftGroupId: r.shift_group_id,
        shiftGroupName: r.shift_group_name,
      }))
    );
  }
);

// POST /airports/:airportId/shift-groups/:groupId/members — CFRO (own
// airport) or Admin/GM_FIRE appoints a staff member to this crew. This is
// deliberately a narrower endpoint than the general /users PATCH — a CFRO
// can move people between crews at their own airport, but cannot change
// anyone's role, status, or password.
router.post(
  "/:airportId/shift-groups/:groupId/members",
  requireAuth,
  requireAirportScope,
  requireRole("CFRO", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const parsed = z.object({ userId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const group = await db
      .prepare(`SELECT id FROM shift_groups WHERE id = ? AND airport_id = ?`)
      .get(req.params.groupId, req.params.airportId);
    if (!group) return res.status(404).json({ error: "Shift group not found at this airport" });

    const user = (await db
      .prepare(
        `SELECT u.id, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.id = ? AND u.airport_id = ?`
      )
      .get(parsed.data.userId, req.params.airportId)) as { id: string; role_name: string } | undefined;
    if (!user) return res.status(404).json({ error: "User not found at this airport" });
    if (!["TEAM_LEADER", "SR_SUPDT", "SUPDT", "SUPVR", "ASSTT", "DRIVER"].includes(user.role_name)) {
      return res.status(400).json({ error: `${user.role_name} is not a shift-rotation role` });
    }

    await db.prepare(`UPDATE users SET shift_group_id = ? WHERE id = ?`).run(req.params.groupId, user.id);
    await logAction(req.user!.userId, "SHIFT_GROUP_MEMBER_ADDED", "ShiftGroup", req.params.groupId, { userId: user.id });
    res.json({ ok: true });
  }
);

// DELETE /airports/:airportId/shift-groups/:groupId/members/:userId — CFRO
// (own airport) or Admin/GM_FIRE removes someone from a crew.
router.delete(
  "/:airportId/shift-groups/:groupId/members/:userId",
  requireAuth,
  requireAirportScope,
  requireRole("CFRO", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const user = (await db
      .prepare(`SELECT id, shift_group_id FROM users WHERE id = ? AND airport_id = ?`)
      .get(req.params.userId, req.params.airportId)) as { id: string; shift_group_id: string | null } | undefined;
    if (!user) return res.status(404).json({ error: "User not found at this airport" });
    if (user.shift_group_id !== req.params.groupId) {
      return res.status(400).json({ error: "This user is not a member of that shift group" });
    }

    await db.prepare(`UPDATE users SET shift_group_id = NULL WHERE id = ?`).run(user.id);
    await logAction(req.user!.userId, "SHIFT_GROUP_MEMBER_REMOVED", "ShiftGroup", req.params.groupId, { userId: user.id });
    res.json({ ok: true });
  }
);

export default router;
