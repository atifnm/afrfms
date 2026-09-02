import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client";
import { requireAuth, requireAirportScope, requireRole } from "../../middleware/auth";
import { newId } from "../../utils/id";
import { logAction } from "../../utils/audit";

const router = Router();

// GET /airports/:airportId/equipment — scoped: a Superintendent, Team
// Leader, Driver, etc. can only ever pull their own airport's fleet;
// CFRO/ADMIN can pull any airport's fleet. Enforced server-side regardless
// of what the client requests (Architecture Doc, Section 9.3).
router.get("/:airportId/equipment", requireAuth, requireAirportScope, async (req, res) => {
  const rows = (await db
    .prepare(
      `SELECT e.id, e.reg_no, e.make, e.model, e.year, e.status, e.current_odometer,
              e.category_id, c.name AS category_name, e.station_id, s.name AS station_name
       FROM equipment e
       JOIN equipment_categories c ON c.id = e.category_id
       LEFT JOIN stations s ON s.id = e.station_id
       WHERE e.airport_id = ?
       ORDER BY e.reg_no ASC`
    )
    .all(req.params.airportId)) as any[];

  res.json(
    rows.map((e) => ({
      id: e.id,
      regNo: e.reg_no,
      make: e.make,
      model: e.model,
      year: e.year,
      category: e.category_name,
      categoryId: e.category_id,
      station: e.station_name ?? null,
      stationId: e.station_id,
      status: e.status,
      currentOdometer: e.current_odometer,
    }))
  );
});

const createEquipmentSchema = z.object({
  regNo: z.string().min(1),
  categoryId: z.string().min(1),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().optional(),
  stationId: z.string().optional(),
  currentOdometer: z.number().int().nonnegative().optional(),
});

// POST /airports/:airportId/equipment — Superintendent (their own airport)
// or Admin (any airport) registers a new vehicle. Architecture Doc 6.2.
router.post(
  "/:airportId/equipment",
  requireAuth,
  requireAirportScope,
  requireRole("SR_SUPDT", "SUPDT", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const parsed = createEquipmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const category = await db.prepare(`SELECT id FROM equipment_categories WHERE id = ?`).get(parsed.data.categoryId);
    if (!category) return res.status(400).json({ error: "Unknown equipment category" });

    if (parsed.data.stationId) {
      const station = await db
        .prepare(`SELECT id FROM stations WHERE id = ? AND airport_id = ?`)
        .get(parsed.data.stationId, req.params.airportId);
      if (!station) return res.status(400).json({ error: "Station not found at this airport" });
    }

    const existing = await db.prepare(`SELECT id FROM equipment WHERE reg_no = ?`).get(parsed.data.regNo);
    if (existing) return res.status(409).json({ error: "A vehicle with this registration number already exists" });

    const id = newId();
    await db
      .prepare(
        `INSERT INTO equipment (id, reg_no, make, model, year, current_odometer, airport_id, station_id, category_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        parsed.data.regNo,
        parsed.data.make ?? null,
        parsed.data.model ?? null,
        parsed.data.year ?? null,
        parsed.data.currentOdometer ?? 0,
        req.params.airportId,
        parsed.data.stationId ?? null,
        parsed.data.categoryId
      );

    await logAction(req.user!.userId, "EQUIPMENT_CREATED", "Equipment", id, { regNo: parsed.data.regNo });
    res.status(201).json({ id, regNo: parsed.data.regNo });
  }
);

const updateEquipmentSchema = z.object({
  regNo: z.string().min(1).optional(),
  make: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  categoryId: z.string().min(1).optional(),
  stationId: z.string().nullable().optional(),
  status: z.enum(["active", "grounded", "under_maintenance", "retired"]).optional(),
});

// PATCH /airports/:airportId/equipment/:equipmentId — Superintendent/Admin
// edits any field, including manually changing status (e.g. sending a
// vehicle to under_maintenance, or reactivating one) outside the automatic
// fault-driven grounding/reactivation flow.
router.patch(
  "/:airportId/equipment/:equipmentId",
  requireAuth,
  requireAirportScope,
  requireRole("SR_SUPDT", "SUPDT", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const parsed = updateEquipmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const equipment = await db
      .prepare(`SELECT id FROM equipment WHERE id = ? AND airport_id = ?`)
      .get(req.params.equipmentId, req.params.airportId);
    if (!equipment) return res.status(404).json({ error: "Equipment not found at this airport" });

    if (parsed.data.categoryId) {
      const category = await db.prepare(`SELECT id FROM equipment_categories WHERE id = ?`).get(parsed.data.categoryId);
      if (!category) return res.status(400).json({ error: "Unknown equipment category" });
    }
    if (parsed.data.stationId) {
      const station = await db
        .prepare(`SELECT id FROM stations WHERE id = ? AND airport_id = ?`)
        .get(parsed.data.stationId, req.params.airportId);
      if (!station) return res.status(400).json({ error: "Station not found at this airport" });
    }

    const fields: string[] = [];
    const values: any[] = [];
    const columnMap: Record<string, string> = {
      regNo: "reg_no",
      make: "make",
      model: "model",
      year: "year",
      categoryId: "category_id",
      stationId: "station_id",
      status: "status",
    };
    for (const [key, column] of Object.entries(columnMap)) {
      if (key in parsed.data && (parsed.data as any)[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push((parsed.data as any)[key]);
      }
    }
    if (fields.length === 0) return res.status(400).json({ error: "No fields to update" });

    values.push(req.params.equipmentId);
    await db.prepare(`UPDATE equipment SET ${fields.join(", ")} WHERE id = ?`).run(...values);

    await logAction(req.user!.userId, "EQUIPMENT_UPDATED", "Equipment", req.params.equipmentId, parsed.data);
    res.json({ ok: true });
  }
);

// DELETE /airports/:airportId/equipment/:equipmentId — Admin only. This is
// a soft delete (status -> 'retired'), never a hard SQL delete: the vehicle
// is referenced by historical inspection submissions, faults, and shift
// assignments, and removing those records would destroy the audit trail
// the Architecture Doc's compliance requirements depend on.
router.delete("/:airportId/equipment/:equipmentId", requireAuth, requireAirportScope, requireRole("ADMIN", "GM_FIRE"), async (req, res) => {
  const equipment = await db
    .prepare(`SELECT id, status FROM equipment WHERE id = ? AND airport_id = ?`)
    .get(req.params.equipmentId, req.params.airportId);
  if (!equipment) return res.status(404).json({ error: "Equipment not found at this airport" });

  await db.prepare(`UPDATE equipment SET status = 'retired' WHERE id = ?`).run(req.params.equipmentId);
  await logAction(req.user!.userId, "EQUIPMENT_RETIRED", "Equipment", req.params.equipmentId);
  res.json({ ok: true, status: "retired" });
});

export default router;
