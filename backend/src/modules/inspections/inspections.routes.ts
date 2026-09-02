import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client";
import { requireAuth, requireRole, canAccessAirport } from "../../middleware/auth";
import { newId } from "../../utils/id";
import { logAction } from "../../utils/audit";
import { dispatchAlertsForFault } from "../../utils/alerts";

const router = Router();

// GET /shifts/today-for-me — Driver convenience lookup: which shift(s) today
// have a vehicle assigned to the calling driver, without needing to already
// know a shift ID (which in practice a Team Leader would otherwise have to
// hand them). Returns the most recent first.
router.get("/today-for-me", requireAuth, requireRole("DRIVER"), async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = (await db
    .prepare(
      `SELECT s.id, s.shift_date, s.shift_type
       FROM shifts s
       JOIN shift_assignments sa ON sa.shift_id = s.id
       WHERE sa.driver_id = ? AND s.shift_date = ?
       GROUP BY s.id, s.shift_date, s.shift_type, s.created_at
       ORDER BY s.created_at DESC`
    )
    .all(req.user!.userId, today)) as any[];

  res.json(rows.map((s) => ({ id: s.id, shiftDate: s.shift_date, shiftType: s.shift_type })));
});

// GET /shifts/:shiftId/my-assignments — EVERY vehicle assigned to the
// calling driver for this shift (a driver can have more than one — e.g.
// covering two vehicles in a short-staffed shift). Architecture Doc 7.1,
// step 2. Scoped to the calling driver: never returns another driver's
// assignments.
router.get("/:shiftId/my-assignments", requireAuth, requireRole("DRIVER"), async (req, res) => {
  const shift = (await db.prepare(`SELECT id, airport_id FROM shifts WHERE id = ?`).get(req.params.shiftId)) as
    | { id: string; airport_id: string }
    | undefined;
  if (!shift) return res.status(404).json({ error: "Shift not found" });
  if (!canAccessAirport(req.user!, shift.airport_id)) {
    return res.status(403).json({ error: "Forbidden — outside your assigned airport" });
  }

  const rows = (await db
    .prepare(
      `SELECT sa.id, sa.status, sa.equipment_id, e.reg_no, e.current_odometer,
              sub.id AS submission_id
       FROM shift_assignments sa
       JOIN equipment e ON e.id = sa.equipment_id
       LEFT JOIN inspection_submissions sub ON sub.shift_id = sa.shift_id AND sub.equipment_id = sa.equipment_id
       WHERE sa.shift_id = ? AND sa.driver_id = ?
       ORDER BY e.reg_no ASC`
    )
    .all(req.params.shiftId, req.user!.userId)) as any[];

  res.json(
    rows.map((a) => ({
      assignmentId: a.id,
      status: a.status,
      alreadySubmitted: !!a.submission_id,
      equipment: { id: a.equipment_id, regNo: a.reg_no, currentOdometer: a.current_odometer },
    }))
  );
});

// GET /shifts/:shiftId/my-assignments/:assignmentId — one specific
// assignment's vehicle + checklist form. This is what the driver's app
// fetches after picking which vehicle to inspect from the list above.
router.get("/:shiftId/my-assignments/:assignmentId", requireAuth, requireRole("DRIVER"), async (req, res) => {
  const shift = (await db.prepare(`SELECT id, airport_id FROM shifts WHERE id = ?`).get(req.params.shiftId)) as
    | { id: string; airport_id: string }
    | undefined;
  if (!shift) return res.status(404).json({ error: "Shift not found" });
  if (!canAccessAirport(req.user!, shift.airport_id)) {
    return res.status(403).json({ error: "Forbidden — outside your assigned airport" });
  }

  const assignment = (await db
    .prepare(
      `SELECT sa.id, sa.status, sa.equipment_id, e.reg_no, e.category_id, e.current_odometer,
              sub.id AS submission_id
       FROM shift_assignments sa
       JOIN equipment e ON e.id = sa.equipment_id
       LEFT JOIN inspection_submissions sub ON sub.shift_id = sa.shift_id AND sub.equipment_id = sa.equipment_id
       WHERE sa.id = ? AND sa.shift_id = ? AND sa.driver_id = ?`
    )
    .get(req.params.assignmentId, req.params.shiftId, req.user!.userId)) as any;

  if (!assignment) return res.status(404).json({ error: "Assignment not found, or not assigned to you" });

  const template = (await db
    .prepare(`SELECT id, version FROM checklist_templates WHERE category_id = ? AND is_active = 1 ORDER BY version DESC LIMIT 1`)
    .get(assignment.category_id)) as { id: string; version: number } | undefined;
  if (!template) return res.status(404).json({ error: "No active checklist template for this vehicle's category" });

  const items = (await db
    .prepare(
      `SELECT id, section, label, input_type, is_critical FROM checklist_items
       WHERE template_id = ? AND is_active = 1 ORDER BY sort_order ASC`
    )
    .all(template.id)) as any[];

  res.json({
    assignmentId: assignment.id,
    alreadySubmitted: !!assignment.submission_id,
    equipment: { id: assignment.equipment_id, regNo: assignment.reg_no, currentOdometer: assignment.current_odometer },
    checklist: {
      templateId: template.id,
      version: template.version,
      items: items.map((i) => ({
        id: i.id,
        section: i.section,
        label: i.label,
        inputType: i.input_type,
        isCritical: !!i.is_critical,
      })),
    },
  });
});

const responseSchema = z.object({
  checklistItemId: z.string().min(1),
  value: z.string().min(1), // "pass" | "fail" for boolean items; raw value for numeric/text
  remarks: z.string().optional(),
  photoUrl: z.string().optional(),
});

const submitSchema = z.object({
  odometerReading: z.number().int().nonnegative(),
  responses: z.array(responseSchema).min(1),
});

// POST /shifts/:shiftId/my-assignments/:assignmentId/inspection — driver
// submits the checklist for ONE specific assigned vehicle (Architecture Doc
// 7.1, steps 3–4). Identifying the assignment explicitly (rather than just
// "the driver's assignment for this shift") is what lets a driver covering
// more than one vehicle in a shift submit for each of them in turn. Any
// "fail" on a boolean item auto-creates a Fault and dispatches Alerts
// (Section 6.5); a fail on a critical item also grounds the vehicle and
// notifies Mechanical Officers in addition to Technicians.
router.post("/:shiftId/my-assignments/:assignmentId/inspection", requireAuth, requireRole("DRIVER"), async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const shift = (await db.prepare(`SELECT id, airport_id FROM shifts WHERE id = ?`).get(req.params.shiftId)) as
    | { id: string; airport_id: string }
    | undefined;
  if (!shift) return res.status(404).json({ error: "Shift not found" });
  if (!canAccessAirport(req.user!, shift.airport_id)) {
    return res.status(403).json({ error: "Forbidden — outside your assigned airport" });
  }

  const assignment = (await db
    .prepare(`SELECT id, equipment_id, status FROM shift_assignments WHERE id = ? AND shift_id = ? AND driver_id = ?`)
    .get(req.params.assignmentId, req.params.shiftId, req.user!.userId)) as
    | { id: string; equipment_id: string; status: string }
    | undefined;
  if (!assignment) return res.status(404).json({ error: "Assignment not found, or not assigned to you" });

  const alreadySubmitted = await db
    .prepare(`SELECT id FROM inspection_submissions WHERE shift_id = ? AND equipment_id = ?`)
    .get(req.params.shiftId, assignment.equipment_id);
  if (alreadySubmitted) {
    return res.status(409).json({ error: "A submission already exists for this vehicle on this shift" });
  }

  const equipment = (await db.prepare(`SELECT id, category_id, airport_id FROM equipment WHERE id = ?`).get(assignment.equipment_id)) as
    | { id: string; category_id: string; airport_id: string }
    | undefined;
  if (!equipment) return res.status(404).json({ error: "Equipment not found" });

  const template = (await db
    .prepare(`SELECT id FROM checklist_templates WHERE category_id = ? AND is_active = 1 ORDER BY version DESC LIMIT 1`)
    .get(equipment.category_id)) as { id: string } | undefined;
  if (!template) return res.status(404).json({ error: "No active checklist template for this vehicle's category" });

  // Validate every submitted item actually belongs to this template.
  const validItemIds = new Set(
    ((await db.prepare(`SELECT id FROM checklist_items WHERE template_id = ?`).all(template.id)) as { id: string }[]).map(
      (r) => r.id
    )
  );
  for (const r of parsed.data.responses) {
    if (!validItemIds.has(r.checklistItemId)) {
      return res.status(400).json({ error: `checklistItemId ${r.checklistItemId} is not part of this vehicle's checklist` });
    }
  }

  const submissionId = newId();
  await db
    .prepare(
      `INSERT INTO inspection_submissions (id, equipment_id, shift_id, driver_id, template_id, odometer_reading)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(submissionId, equipment.id, req.params.shiftId, req.user!.userId, template.id, parsed.data.odometerReading);

  const faultsCreated: { id: string; label: string; severity: string; alertsSent: number }[] = [];
  let hasCriticalFault = false;

  for (const r of parsed.data.responses) {
    const responseId = newId();
    await db
      .prepare(
        `INSERT INTO inspection_responses (id, submission_id, checklist_item_id, value, remarks, photo_url)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(responseId, submissionId, r.checklistItemId, r.value, r.remarks ?? null, r.photoUrl ?? null);

    const item = (await db.prepare(`SELECT label, input_type, is_critical FROM checklist_items WHERE id = ?`).get(
      r.checklistItemId
    )) as { label: string; input_type: string; is_critical: number };

    const isFail = item.input_type === "boolean" && r.value.toLowerCase() === "fail";
    if (isFail) {
      const severity = item.is_critical ? "critical" : "minor";
      const faultId = newId();
      await db
        .prepare(
          `INSERT INTO faults (id, submission_id, response_id, equipment_id, description, severity)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(faultId, submissionId, responseId, equipment.id, r.remarks || item.label, severity);
      faultsCreated.push({ id: faultId, label: item.label, severity, alertsSent: 0 });
      if (severity === "critical") hasCriticalFault = true;
      const alertsSent = await dispatchAlertsForFault(faultId, equipment.airport_id, severity as "minor" | "critical");
      faultsCreated[faultsCreated.length - 1].alertsSent = alertsSent;
    }
  }

  await db.prepare(`UPDATE equipment SET current_odometer = ? WHERE id = ?`).run(parsed.data.odometerReading, equipment.id);
  if (hasCriticalFault) {
    await db.prepare(`UPDATE equipment SET status = 'grounded' WHERE id = ?`).run(equipment.id);
  }
  await db.prepare(`UPDATE shift_assignments SET status = 'completed' WHERE id = ?`).run(assignment.id);

  await logAction(req.user!.userId, "INSPECTION_SUBMITTED", "InspectionSubmission", submissionId, {
    equipmentId: equipment.id,
    faultCount: faultsCreated.length,
  });

  res.status(201).json({
    submissionId,
    equipmentGrounded: hasCriticalFault,
    faultsCreated,
  });
});

export default router;
