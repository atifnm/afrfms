import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../../db/client";
import { requireAuth, requireRole } from "../../middleware/auth";
import { logAction } from "../../utils/audit";
import { newId } from "../../utils/id";
import { ROLE_ENUM, SHIFT_GROUP_ROLES as SHIFT_GROUP_ROLES_LIST, CFRO_MANAGEABLE_ROLES } from "../../utils/roles";

const router = Router();

// Only these roles rotate through crews A/B/C/D per the CFRO's roster board.
const SHIFT_GROUP_ROLES = new Set<string>(SHIFT_GROUP_ROLES_LIST);
const CFRO_MANAGEABLE_ROLE_SET = new Set<string>(CFRO_MANAGEABLE_ROLES);

// GET /users — Admin/GM_FIRE see every user nationwide. A CFRO sees only the
// staff at their own airport — this is how they review who's already there
// before appointing a Team Leader, fire crew, or shift assignments (see the
// hierarchy note in utils/roles.ts).
router.get("/", requireAuth, requireRole("ADMIN", "GM_FIRE", "CFRO"), async (req, res) => {
  const scoped = req.user!.role === "CFRO";
  const users = (await db
    .prepare(
      `SELECT u.id, u.full_name, u.cnic, u.status, u.last_login_at, u.airport_id, u.shift_group_id,
              r.name AS role_name, a.name AS airport_name, g.name AS shift_group_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN airports a ON a.id = u.airport_id
       LEFT JOIN shift_groups g ON g.id = u.shift_group_id
       ${scoped ? "WHERE u.airport_id = ?" : ""}
       ORDER BY u.created_at DESC`
    )
    .all(...(scoped ? [req.user!.airportId ?? "__none__"] : []))) as any[];

  res.json(
    users.map((u) => ({
      id: u.id,
      fullName: u.full_name,
      cnic: u.cnic,
      role: u.role_name,
      airportId: u.airport_id,
      airport: u.airport_name ?? "National",
      shiftGroupId: u.shift_group_id,
      shiftGroupName: u.shift_group_name,
      status: u.status,
      lastLoginAt: u.last_login_at,
    }))
  );
});

const createUserSchema = z.object({
  fullName: z.string().min(1),
  cnic: z.string().min(1),
  phone: z.string().optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  roleName: z.enum(ROLE_ENUM),
  airportId: z.string().optional(),
  shiftGroupId: z.string().optional(),
});

// POST /users — Admin/GM_FIRE can create any user anywhere. A CFRO can also
// create users, but only airport-scoped ranks (Team Leader, the firefighter
// ranks, Drivers, and maintenance staff — never CFRO/ADMIN/GM_FIRE) and only
// at their own airport: this is the "appointing the Team Leader and all fire
// crew" responsibility (see utils/roles.ts).
router.post("/", requireAuth, requireRole("ADMIN", "GM_FIRE", "CFRO"), async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { fullName, cnic, phone, password, roleName } = parsed.data;
  let { airportId, shiftGroupId } = parsed.data;

  const isCfro = req.user!.role === "CFRO";
  if (isCfro) {
    if (!CFRO_MANAGEABLE_ROLE_SET.has(roleName)) {
      return res.status(403).json({ error: "A CFRO can only appoint Team Leader, fire crew, driver, or maintenance roles" });
    }
    // A CFRO can only appoint staff to their own airport, regardless of what's in the request body.
    airportId = req.user!.airportId ?? undefined;
    if (!airportId) return res.status(400).json({ error: "Your account has no airport assignment" });
  }

  const role = (await db.prepare(`SELECT id, is_national FROM roles WHERE name = ?`).get(roleName)) as
    | { id: string; is_national: number }
    | undefined;
  if (!role) return res.status(400).json({ error: "Unknown role" });

  if (!role.is_national && !airportId) {
    return res.status(400).json({ error: `${roleName} requires an airportId` });
  }
  if (shiftGroupId && !SHIFT_GROUP_ROLES.has(roleName)) {
    return res.status(400).json({ error: `${roleName} is not a shift-rotation role` });
  }
  if (shiftGroupId) {
    const group = await db.prepare(`SELECT id FROM shift_groups WHERE id = ? AND airport_id = ?`).get(shiftGroupId, airportId);
    if (!group) return res.status(400).json({ error: "Shift group not found at this airport" });
  }

  const existing = await db.prepare(`SELECT id FROM users WHERE cnic = ?`).get(cnic);
  if (existing) {
    return res.status(409).json({ error: "A user with this CNIC already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const id = newId();

  try {
    await db
      .prepare(
        `INSERT INTO users (id, full_name, cnic, phone, password_hash, role_id, airport_id, shift_group_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, fullName, cnic, phone ?? null, passwordHash, role.id, role.is_national ? null : airportId ?? null, shiftGroupId ?? null);

    await logAction(req.user!.userId, "USER_CREATED", "User", id, { roleName });
    res.status(201).json({ id, fullName, cnic });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const updateUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  roleName: z.enum(ROLE_ENUM).optional(),
  airportId: z.string().nullable().optional(),
  shiftGroupId: z.string().nullable().optional(),
  status: z.enum(["active", "suspended"]).optional(),
  newPassword: z.string().min(8).optional(),
});

// PATCH /users/:userId — Admin/GM_FIRE can edit any user. A CFRO can also
// edit users, but only staff currently at their own airport in an
// airport-scoped, CFRO-manageable rank — they can't touch a CFRO/ADMIN/
// GM_FIRE account, can't promote anyone into one of those, and can't move
// someone to a different airport. Edits name, role, airport, shift-group
// (crew), and/or status (active/suspended), and can optionally reset the
// password. Changing roleName re-validates the national/airport-scope rule
// the same way user creation does, and clears the shift group if the new
// role doesn't rotate through one.
router.patch("/:userId", requireAuth, requireRole("ADMIN", "GM_FIRE", "CFRO"), async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const user = (await db
    .prepare(
      `SELECT u.id, u.role_id, u.airport_id, u.shift_group_id, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`
    )
    .get(req.params.userId)) as
    | { id: string; role_id: string; airport_id: string | null; shift_group_id: string | null; role_name: string }
    | undefined;
  if (!user) return res.status(404).json({ error: "User not found" });

  const isCfro = req.user!.role === "CFRO";
  if (isCfro) {
    if (user.airport_id !== req.user!.airportId || !CFRO_MANAGEABLE_ROLE_SET.has(user.role_name)) {
      return res.status(403).json({ error: "You can only manage fire crew, Team Leader, driver, or maintenance staff at your own airport" });
    }
    if (parsed.data.roleName && !CFRO_MANAGEABLE_ROLE_SET.has(parsed.data.roleName)) {
      return res.status(403).json({ error: "A CFRO cannot assign the CFRO, Admin, or GM Fire role" });
    }
    if (parsed.data.airportId !== undefined && parsed.data.airportId !== req.user!.airportId) {
      return res.status(403).json({ error: "A CFRO cannot move staff to a different airport" });
    }
  }

  let roleId = user.role_id;
  let isNational: boolean | null = null;
  if (parsed.data.roleName) {
    const role = (await db.prepare(`SELECT id, is_national FROM roles WHERE name = ?`).get(parsed.data.roleName)) as
      | { id: string; is_national: number }
      | undefined;
    if (!role) return res.status(400).json({ error: "Unknown role" });
    roleId = role.id;
    isNational = !!role.is_national;
  }

  // Resolve the effective airport assignment after this update, to enforce
  // the same "airport-scoped roles need an airport, national roles don't"
  // rule that user creation enforces. A CFRO's target airport is always
  // their own (already validated above).
  const effectiveAirportId = isCfro
    ? req.user!.airportId
    : parsed.data.airportId !== undefined
      ? parsed.data.airportId
      : user.airport_id;
  if (isNational === false && !effectiveAirportId) {
    return res.status(400).json({ error: `${parsed.data.roleName} requires an airportId` });
  }

  // Resolve the effective role name (for the shift-group eligibility check)
  // whether or not roleName is being changed in this request.
  const effectiveRoleName =
    parsed.data.roleName ??
    ((await db.prepare(`SELECT name FROM roles WHERE id = ?`).get(roleId)) as { name: string }).name;

  let shiftGroupId: string | null | undefined = parsed.data.shiftGroupId;
  if (isNational === true) {
    // Switching to a national role — shift groups don't apply.
    shiftGroupId = null;
  } else if (!SHIFT_GROUP_ROLES.has(effectiveRoleName)) {
    if (shiftGroupId) {
      return res.status(400).json({ error: `${effectiveRoleName} is not a shift-rotation role` });
    }
    // Not explicitly provided and role doesn't rotate — leave as-is unless it's stale from a prior role.
    if (parsed.data.roleName && user.shift_group_id) shiftGroupId = null;
  }
  if (shiftGroupId) {
    const group = await db
      .prepare(`SELECT id FROM shift_groups WHERE id = ? AND airport_id = ?`)
      .get(shiftGroupId, effectiveAirportId ?? "__none__");
    if (!group) return res.status(400).json({ error: "Shift group not found at this airport" });
  }

  const fields: string[] = [];
  const values: any[] = [];
  if (parsed.data.fullName !== undefined) {
    fields.push("full_name = ?");
    values.push(parsed.data.fullName);
  }
  if (parsed.data.roleName !== undefined) {
    fields.push("role_id = ?");
    values.push(roleId);
    fields.push("airport_id = ?");
    values.push(isNational ? null : effectiveAirportId ?? null);
  } else if (parsed.data.airportId !== undefined) {
    fields.push("airport_id = ?");
    values.push(isCfro ? effectiveAirportId : parsed.data.airportId);
  }
  if (shiftGroupId !== undefined) {
    fields.push("shift_group_id = ?");
    values.push(shiftGroupId);
  }
  if (parsed.data.status !== undefined) {
    fields.push("status = ?");
    values.push(parsed.data.status);
  }
  if (parsed.data.newPassword) {
    fields.push("password_hash = ?");
    values.push(await bcrypt.hash(parsed.data.newPassword, 10));
  }

  if (fields.length === 0) return res.status(400).json({ error: "No fields to update" });

  values.push(req.params.userId);
  await db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);

  await logAction(req.user!.userId, "USER_UPDATED", "User", req.params.userId, {
    fields: Object.keys(parsed.data),
  });
  res.json({ ok: true });
});

export default router;
