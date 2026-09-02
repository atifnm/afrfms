import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client";
import { requireAuth, requireRole, requireAirportScope } from "../../middleware/auth";
import { newId } from "../../utils/id";
import { logAction } from "../../utils/audit";
import { buildShiftReportSnapshot } from "../../utils/shiftReportSnapshot";
import { renderShiftReportPdf } from "../../utils/shiftReportPdf";
import { isShiftTypeValidForPattern, ShiftPattern } from "../../utils/shiftPatterns";

const router = Router();

const createShiftSchema = z.object({
  shiftDate: z.string().min(1), // YYYY-MM-DD
  shiftType: z.enum(["morning", "evening", "night"]),
  shiftGroupId: z.string().min(1, "Select which crew (A/B/C/D) is on duty for this shift"),
  stationId: z.string().optional(),
});

// POST /airports/:airportId/shifts — Team Leader opens a shift (Architecture
// Doc 7.1, step 1). Sr Supdt/Supdt/CFRO/Admin can also open shifts on a Team
// Leader's behalf. shiftType must match the airport's configured shift
// pattern — morning/evening/night for a 3_shift airport, or just
// morning/night (12hr each) for a 2_shift airport. shiftGroupId names which
// rotation crew (A/B/C/D) is on duty for this shift — crews rotate across
// different shift types by date, so this is chosen per shift rather than
// being a fixed property of the crew.
router.post(
  "/:airportId/shifts",
  requireAuth,
  requireAirportScope,
  requireRole("TEAM_LEADER", "SR_SUPDT", "SUPDT", "CFRO", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const parsed = createShiftSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const airport = await db.prepare(`SELECT shift_pattern FROM airports WHERE id = ?`).get(req.params.airportId) as
      | { shift_pattern: ShiftPattern }
      | undefined;
    if (!airport) return res.status(404).json({ error: "Airport not found" });
    if (!isShiftTypeValidForPattern(parsed.data.shiftType, airport.shift_pattern)) {
      return res.status(400).json({
        error: `This airport runs a ${airport.shift_pattern === "2_shift" ? "2-shift (morning/night)" : "3-shift (morning/evening/night)"} pattern — '${parsed.data.shiftType}' is not valid here`,
      });
    }

    const shiftGroup = await db
      .prepare(`SELECT id, name FROM shift_groups WHERE id = ? AND airport_id = ?`)
      .get(parsed.data.shiftGroupId, req.params.airportId) as { id: string; name: string } | undefined;
    if (!shiftGroup) return res.status(400).json({ error: "Select a valid crew (A/B/C/D) for this airport" });

    const id = newId();
    await db.prepare(
      `INSERT INTO shifts (id, airport_id, station_id, shift_group_id, shift_date, shift_type, team_leader_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, req.params.airportId, parsed.data.stationId ?? null, shiftGroup.id, parsed.data.shiftDate, parsed.data.shiftType, req.user!.userId);

    await logAction(req.user!.userId, "SHIFT_OPENED", "Shift", id, {
      shiftDate: parsed.data.shiftDate,
      shiftType: parsed.data.shiftType,
      shiftGroup: shiftGroup.name,
    });
    res.status(201).json({ id, shiftDate: parsed.data.shiftDate, shiftType: parsed.data.shiftType, shiftGroupId: shiftGroup.id, shiftGroupName: shiftGroup.name });
  }
);

const assignSchema = z.object({
  equipmentId: z.string().min(1),
  driverId: z.string().min(1),
  supervisorId: z.string().optional(),
  superintendentId: z.string().optional(),
});

// POST /airports/:airportId/shifts/:shiftId/assignments — Team Leader (or
// CFRO/Superintendent/Admin/GM_FIRE) assigns an active vehicle to a driver
// for the shift, and optionally names the Supervisor and/or Superintendent
// on duty for that vehicle this shift — the crew roster the Team Leader is
// responsible for appointing (Architecture Doc 7.1, extended).
router.post(
  "/:airportId/shifts/:shiftId/assignments",
  requireAuth,
  requireAirportScope,
  requireRole("TEAM_LEADER", "SR_SUPDT", "SUPDT", "CFRO", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const shift = await db.prepare(`SELECT id FROM shifts WHERE id = ? AND airport_id = ?`).get(req.params.shiftId, req.params.airportId);
    if (!shift) return res.status(404).json({ error: "Shift not found for this airport" });

    const equipment = await db.prepare(`SELECT id, status FROM equipment WHERE id = ? AND airport_id = ?`)
      .get(parsed.data.equipmentId, req.params.airportId) as { id: string; status: string } | undefined;
    if (!equipment) return res.status(404).json({ error: "Equipment not found for this airport" });
    if (equipment.status !== "active") {
      return res.status(400).json({ error: `Equipment is currently '${equipment.status}' and cannot be assigned` });
    }

    const driver = await db.prepare(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND r.name = 'DRIVER' AND u.airport_id = ?`)
      .get(parsed.data.driverId, req.params.airportId);
    if (!driver) return res.status(400).json({ error: "driverId must be a Driver assigned to this airport" });

    if (parsed.data.supervisorId) {
      const supervisor = await db
        .prepare(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND r.name = 'SUPVR' AND u.airport_id = ?`)
        .get(parsed.data.supervisorId, req.params.airportId);
      if (!supervisor) return res.status(400).json({ error: "supervisorId must be a Supvr assigned to this airport" });
    }
    if (parsed.data.superintendentId) {
      const superintendent = await db
        .prepare(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND r.name IN ('SR_SUPDT', 'SUPDT') AND u.airport_id = ?`)
        .get(parsed.data.superintendentId, req.params.airportId);
      if (!superintendent) return res.status(400).json({ error: "superintendentId must be a Sr Supdt or Supdt assigned to this airport" });
    }

    const id = newId();
    await db.prepare(
      `INSERT INTO shift_assignments (id, shift_id, equipment_id, driver_id, supervisor_id, superintendent_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, req.params.shiftId, parsed.data.equipmentId, parsed.data.driverId, parsed.data.supervisorId ?? null, parsed.data.superintendentId ?? null);

    await logAction(req.user!.userId, "VEHICLE_ASSIGNED", "ShiftAssignment", id, parsed.data);
    res.status(201).json({ id, shiftId: req.params.shiftId, ...parsed.data, status: "pending" });
  }
);

const updateAssignmentSchema = z.object({
  driverId: z.string().optional(),
  supervisorId: z.string().nullable().optional(),
  superintendentId: z.string().nullable().optional(),
});

// PATCH /airports/:airportId/shifts/:shiftId/assignments/:assignmentId —
// update the crew on an existing (still-pending) assignment. Locked once
// the vehicle's checklist has been submitted, so the crew record on file
// always matches who actually did the work.
router.patch(
  "/:airportId/shifts/:shiftId/assignments/:assignmentId",
  requireAuth,
  requireAirportScope,
  requireRole("TEAM_LEADER", "SR_SUPDT", "SUPDT", "CFRO", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const parsed = updateAssignmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const assignment = await db
      .prepare(`SELECT id, status FROM shift_assignments WHERE id = ? AND shift_id = ?`)
      .get(req.params.assignmentId, req.params.shiftId) as { id: string; status: string } | undefined;
    if (!assignment) return res.status(404).json({ error: "Assignment not found for this shift" });
    if (assignment.status !== "pending") {
      return res.status(400).json({ error: "Crew can only be changed while the vehicle's checklist is still pending" });
    }

    if (parsed.data.driverId) {
      const driver = await db
        .prepare(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND r.name = 'DRIVER' AND u.airport_id = ?`)
        .get(parsed.data.driverId, req.params.airportId);
      if (!driver) return res.status(400).json({ error: "driverId must be a Driver assigned to this airport" });
    }
    if (parsed.data.supervisorId) {
      const supervisor = await db
        .prepare(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND r.name = 'SUPVR' AND u.airport_id = ?`)
        .get(parsed.data.supervisorId, req.params.airportId);
      if (!supervisor) return res.status(400).json({ error: "supervisorId must be a Supvr assigned to this airport" });
    }
    if (parsed.data.superintendentId) {
      const superintendent = await db
        .prepare(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND r.name IN ('SR_SUPDT', 'SUPDT') AND u.airport_id = ?`)
        .get(parsed.data.superintendentId, req.params.airportId);
      if (!superintendent) return res.status(400).json({ error: "superintendentId must be a Sr Supdt or Supdt assigned to this airport" });
    }

    const fields: string[] = [];
    const values: any[] = [];
    if (parsed.data.driverId !== undefined) {
      fields.push("driver_id = ?");
      values.push(parsed.data.driverId);
    }
    if (parsed.data.supervisorId !== undefined) {
      fields.push("supervisor_id = ?");
      values.push(parsed.data.supervisorId);
    }
    if (parsed.data.superintendentId !== undefined) {
      fields.push("superintendent_id = ?");
      values.push(parsed.data.superintendentId);
    }
    if (fields.length === 0) return res.status(400).json({ error: "No fields to update" });

    values.push(req.params.assignmentId);
    await db.prepare(`UPDATE shift_assignments SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    await logAction(req.user!.userId, "SHIFT_ASSIGNMENT_CREW_UPDATED", "ShiftAssignment", req.params.assignmentId, parsed.data);
    res.json({ ok: true });
  }
);

// GET /airports/:airportId/shifts/:shiftId — live shift view: every
// assignment plus whether that vehicle has been checked in yet
// (Architecture Doc 7.1, step 5 — the Team Leader's real-time monitor).
router.get(
  "/:airportId/shifts/:shiftId",
  requireAuth,
  requireAirportScope,
  requireRole("TEAM_LEADER", "SUPVR", "SR_SUPDT", "SUPDT", "CFRO", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const shift = await db.prepare(
      `SELECT s.id, s.shift_date, s.shift_type, s.team_leader_id, s.shift_group_id, g.name AS shift_group_name
       FROM shifts s LEFT JOIN shift_groups g ON g.id = s.shift_group_id
       WHERE s.id = ? AND s.airport_id = ?`
    ).get(req.params.shiftId, req.params.airportId) as any;
    if (!shift) return res.status(404).json({ error: "Shift not found for this airport" });

    const assignments = await db.prepare(
        `SELECT sa.id, sa.status, sa.equipment_id, sa.driver_id, sa.supervisor_id, sa.superintendent_id,
                e.reg_no, e.status AS equipment_status, u.full_name AS driver_name,
                sup.full_name AS supervisor_name, spt.full_name AS superintendent_name,
                sub.id AS submission_id, sub.odometer_reading, sub.submitted_at
         FROM shift_assignments sa
         JOIN equipment e ON e.id = sa.equipment_id
         JOIN users u ON u.id = sa.driver_id
         LEFT JOIN users sup ON sup.id = sa.supervisor_id
         LEFT JOIN users spt ON spt.id = sa.superintendent_id
         LEFT JOIN inspection_submissions sub ON sub.shift_id = sa.shift_id AND sub.equipment_id = sa.equipment_id
         WHERE sa.shift_id = ?
         ORDER BY e.reg_no ASC`
      )
      .all(req.params.shiftId) as any[];

    res.json({
      id: shift.id,
      shiftDate: shift.shift_date,
      shiftType: shift.shift_type,
      shiftGroupId: shift.shift_group_id,
      shiftGroupName: shift.shift_group_name,
      assignments: assignments.map((a) => ({
        assignmentId: a.id,
        status: a.status,
        equipment: { id: a.equipment_id, regNo: a.reg_no, status: a.equipment_status },
        driver: { id: a.driver_id, name: a.driver_name },
        supervisor: a.supervisor_id ? { id: a.supervisor_id, name: a.supervisor_name } : null,
        superintendent: a.superintendent_id ? { id: a.superintendent_id, name: a.superintendent_name } : null,
        submission: a.submission_id
          ? { id: a.submission_id, odometerReading: a.odometer_reading, submittedAt: a.submitted_at }
          : null,
      })),
    });
  }
);

// GET /airports/:airportId/shifts?date=YYYY-MM-DD — browse shifts for an airport.
router.get(
  "/:airportId/shifts",
  requireAuth,
  requireAirportScope,
  requireRole("TEAM_LEADER", "SUPVR", "SR_SUPDT", "SUPDT", "CFRO", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const { date } = req.query as { date?: string };
    let sql = `SELECT s.id, s.shift_date, s.shift_type, s.team_leader_id, s.shift_group_id, g.name AS shift_group_name
               FROM shifts s LEFT JOIN shift_groups g ON g.id = s.shift_group_id
               WHERE s.airport_id = ?`;
    const params: any[] = [req.params.airportId];
    if (date) {
      sql += ` AND s.shift_date = ?`;
      params.push(date);
    }
    sql += ` ORDER BY s.shift_date DESC, s.shift_type ASC`;
    const rows = await db.prepare(sql).all(...params) as any[];
    res.json(rows.map((s) => ({ id: s.id, shiftDate: s.shift_date, shiftType: s.shift_type, shiftGroupId: s.shift_group_id, shiftGroupName: s.shift_group_name })));
  }
);

const exceptionSchema = z.object({ reason: z.string().min(1) });

// POST /airports/:airportId/shifts/:shiftId/assignments/:assignmentId/exception
// — Team Leader logs a vehicle as not-in-service for the shift instead of an
// inspection submission (Architecture Doc 7.3, step 1: "...or a logged
// exception"). Required before a shift report can be generated if not every
// vehicle was actually inspected.
router.post(
  "/:airportId/shifts/:shiftId/assignments/:assignmentId/exception",
  requireAuth,
  requireAirportScope,
  requireRole("TEAM_LEADER", "SR_SUPDT", "SUPDT", "CFRO", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const parsed = exceptionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const assignment = await db.prepare(`SELECT id, status FROM shift_assignments WHERE id = ? AND shift_id = ?`)
      .get(req.params.assignmentId, req.params.shiftId) as { id: string; status: string } | undefined;
    if (!assignment) return res.status(404).json({ error: "Assignment not found for this shift" });
    if (assignment.status === "completed") {
      return res.status(400).json({ error: "This vehicle already has a submitted inspection" });
    }

    await db.prepare(`UPDATE shift_assignments SET status = 'exception', exception_reason = ? WHERE id = ?`).run(
      parsed.data.reason,
      assignment.id
    );
    await logAction(req.user!.userId, "ASSIGNMENT_EXCEPTION", "ShiftAssignment", assignment.id, { reason: parsed.data.reason });
    res.json({ ok: true, status: "exception" });
  }
);

function computeFleetHealthScore(vehiclesInspected: number, criticalFaults: number, minorFaults: number): number {
  if (vehiclesInspected === 0) return 100;
  const penalty = criticalFaults * 20 + minorFaults * 5;
  return Math.max(0, Math.min(100, 100 - penalty));
}

const reportSchema = z.object({ summary: z.string().optional() });

// POST /airports/:airportId/shifts/:shiftId/report — Team Leader compiles and
// issues the shift's equipment-health report (Architecture Doc 6.6 & 7.3).
// Requires every assignment to be 'completed' or 'exception' first.
router.post(
  "/:airportId/shifts/:shiftId/report",
  requireAuth,
  requireAirportScope,
  requireRole("TEAM_LEADER", "SR_SUPDT", "SUPDT", "CFRO", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const shift = await db.prepare(`SELECT id FROM shifts WHERE id = ? AND airport_id = ?`).get(req.params.shiftId, req.params.airportId);
    if (!shift) return res.status(404).json({ error: "Shift not found for this airport" });

    const existing = await db.prepare(`SELECT id FROM shift_reports WHERE shift_id = ?`).get(req.params.shiftId);
    if (existing) return res.status(409).json({ error: "A report has already been issued for this shift" });

    const assignments = await db.prepare(`SELECT status FROM shift_assignments WHERE shift_id = ?`)
      .all(req.params.shiftId) as { status: string }[];
    if (assignments.length === 0) {
      return res.status(400).json({ error: "This shift has no vehicle assignments yet" });
    }
    const outstanding = assignments.filter((a) => a.status === "pending").length;
    if (outstanding > 0) {
      return res.status(400).json({
        error: `${outstanding} vehicle(s) still have neither a submission nor a logged exception`,
      });
    }

    const vehiclesInspected = assignments.filter((a) => a.status === "completed").length;
    const vehiclesException = assignments.filter((a) => a.status === "exception").length;

    const faultStats = await db.prepare(
        `SELECT f.severity, COUNT(*) AS cnt
         FROM faults f
         JOIN inspection_submissions sub ON sub.id = f.submission_id
         WHERE sub.shift_id = ?
         GROUP BY f.severity`
      )
      .all(req.params.shiftId) as { severity: string; cnt: number }[];
    const faultsCritical = Number(faultStats.find((f) => f.severity === "critical")?.cnt ?? 0);
    const faultsMinor = Number(faultStats.find((f) => f.severity === "minor")?.cnt ?? 0);

    const faultsResolvedRow = await db.prepare(
        `SELECT COUNT(*) AS cnt
         FROM faults f
         JOIN inspection_submissions sub ON sub.id = f.submission_id
         WHERE sub.shift_id = ? AND f.status = 'resolved'`
      )
      .get(req.params.shiftId) as { cnt: number };
    const faultsResolved = Number(faultsResolvedRow.cnt);

    const fleetHealthScore = computeFleetHealthScore(vehiclesInspected, faultsCritical, faultsMinor);
    const snapshot = await buildShiftReportSnapshot(req.params.airportId, req.params.shiftId);

    const reportId = newId();
    await db.prepare(
      `INSERT INTO shift_reports
       (id, shift_id, generated_by, summary_text, fleet_health_score, vehicles_inspected, vehicles_exception,
        faults_raised_critical, faults_raised_minor, faults_resolved, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      reportId,
      req.params.shiftId,
      req.user!.userId,
      parsed.data.summary ?? null,
      fleetHealthScore,
      vehiclesInspected,
      vehiclesException,
      faultsCritical,
      faultsMinor,
      faultsResolved,
      JSON.stringify(snapshot)
    );

    await logAction(req.user!.userId, "SHIFT_REPORT_ISSUED", "ShiftReport", reportId, { fleetHealthScore });
    res.status(201).json({
      id: reportId,
      fleetHealthScore,
      vehiclesInspected,
      vehiclesException,
      faultsRaisedCritical: faultsCritical,
      faultsRaisedMinor: faultsMinor,
      faultsResolved,
      currentShiftLeaderName: snapshot.currentShiftLeaderName,
      previousShiftLeaderName: snapshot.previousShiftLeaderName,
      equipment: snapshot.equipment,
    });
  }
);

// GET /airports/:airportId/shifts/:shiftId/report — retrieve an issued report.
router.get(
  "/:airportId/shifts/:shiftId/report",
  requireAuth,
  requireAirportScope,
  requireRole("TEAM_LEADER", "SUPVR", "SR_SUPDT", "SUPDT", "CFRO", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const report = await db.prepare(
        `SELECT r.*, u.full_name AS generated_by_name
         FROM shift_reports r
         JOIN users u ON u.id = r.generated_by
         JOIN shifts s ON s.id = r.shift_id
         WHERE r.shift_id = ? AND s.airport_id = ?`
      )
      .get(req.params.shiftId, req.params.airportId) as any;
    if (!report) return res.status(404).json({ error: "No report has been issued for this shift yet" });

    const snapshot = report.details ? JSON.parse(report.details) : null;

    res.json({
      id: report.id,
      generatedBy: report.generated_by_name,
      generatedAt: report.generated_at,
      summary: report.summary_text,
      fleetHealthScore: report.fleet_health_score,
      vehiclesInspected: report.vehicles_inspected,
      vehiclesException: report.vehicles_exception,
      faultsRaisedCritical: report.faults_raised_critical,
      faultsRaisedMinor: report.faults_raised_minor,
      faultsResolved: report.faults_resolved,
      currentShiftLeaderName: snapshot?.currentShiftLeaderName ?? null,
      previousShiftLeaderName: snapshot?.previousShiftLeaderName ?? null,
      equipment: snapshot?.equipment ?? [],
    });
  }
);

// GET /airports/:airportId/shifts/:shiftId/report/pdf — downloadable PDF
// handover document: every vehicle at the airport (not just this shift's
// assignments), its previous vs. current odometer reading, who checked it,
// any faults raised and whether they were rectified this shift, the shift
// leader's comments, and a signature block for the current and previous
// shift leaders. Renders from the same snapshot stored at generation time,
// so the document a leader signs matches what was true at handover — later
// fault resolutions or equipment edits don't silently change it.
router.get(
  "/:airportId/shifts/:shiftId/report/pdf",
  requireAuth,
  requireAirportScope,
  requireRole("TEAM_LEADER", "SUPVR", "SR_SUPDT", "SUPDT", "CFRO", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const report = await db.prepare(
        `SELECT r.*, u.full_name AS generated_by_name, a.name AS airport_name, s.shift_date, s.shift_type
         FROM shift_reports r
         JOIN users u ON u.id = r.generated_by
         JOIN shifts s ON s.id = r.shift_id
         JOIN airports a ON a.id = s.airport_id
         WHERE r.shift_id = ? AND s.airport_id = ?`
      )
      .get(req.params.shiftId, req.params.airportId) as any;
    if (!report) return res.status(404).json({ error: "No report has been issued for this shift yet" });
    if (!report.details) return res.status(500).json({ error: "This report has no fleet snapshot data to render" });

    const snapshot = JSON.parse(report.details);

    renderShiftReportPdf(res, {
      airportName: report.airport_name,
      shiftDate: report.shift_date,
      shiftType: report.shift_type,
      generatedByName: report.generated_by_name,
      generatedAt: report.generated_at,
      summary: report.summary_text,
      fleetHealthScore: report.fleet_health_score,
      vehiclesInspected: report.vehicles_inspected,
      vehiclesException: report.vehicles_exception,
      faultsRaisedCritical: report.faults_raised_critical,
      faultsRaisedMinor: report.faults_raised_minor,
      faultsResolved: report.faults_resolved,
      snapshot,
    });

    await logAction(req.user!.userId, "SHIFT_REPORT_PDF_DOWNLOADED", "ShiftReport", report.id);
  }
);

export default router;

