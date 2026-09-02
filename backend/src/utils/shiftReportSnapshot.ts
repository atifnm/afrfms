import { db } from "../db/client";

export interface EquipmentSnapshot {
  equipmentId: string;
  regNo: string;
  category: string;
  equipmentStatus: string;
  shiftStatus: "completed" | "exception" | "not_assigned";
  exceptionReason: string | null;
  checkedBy: string | null;
  supervisorOnDuty: string | null;
  superintendentOnDuty: string | null;
  previousOdometer: number | null;
  currentOdometer: number;
  faults: { description: string; severity: string; status: string; rectified: boolean }[];
}

export interface ShiftReportSnapshot {
  airportName: string;
  shiftDate: string;
  shiftType: string;
  currentShiftLeaderName: string | null;
  previousShiftLeaderName: string | null;
  equipment: EquipmentSnapshot[];
}

const SHIFT_ORDER: Record<string, number> = { morning: 1, evening: 2, night: 3 };

/**
 * Builds the complete fleet breakdown for a shift's handover report: every
 * piece of equipment at the airport (not just what was assigned this
 * shift), its odometer reading this shift vs. the last known reading
 * before it, who checked it, and any faults raised — plus who led the
 * previous shift, for the handover signature block. This is computed once
 * at report-generation time and stored as a JSON snapshot (shift_reports.
 * details) rather than recomputed on every PDF download, so the handover
 * document reflects what was true at handover time even if faults are
 * resolved or equipment edited afterward.
 */
export async function buildShiftReportSnapshot(airportId: string, shiftId: string): Promise<ShiftReportSnapshot> {
  const shift = (await db
    .prepare(`SELECT id, shift_date, shift_type, team_leader_id FROM shifts WHERE id = ?`)
    .get(shiftId)) as { id: string; shift_date: string; shift_type: string; team_leader_id: string };

  const airport = (await db.prepare(`SELECT name FROM airports WHERE id = ?`).get(airportId)) as { name: string };

  const equipmentRows = (await db
    .prepare(
      `SELECT e.id, e.reg_no, e.status, e.current_odometer, c.name AS category_name
       FROM equipment e JOIN equipment_categories c ON c.id = e.category_id
       WHERE e.airport_id = ? ORDER BY e.reg_no ASC`
    )
    .all(airportId)) as any[];

  const equipment: EquipmentSnapshot[] = [];
  for (const eq of equipmentRows) {
    const assignment = (await db
      .prepare(
        `SELECT sa.status, sa.exception_reason, u.full_name AS driver_name,
                sup.full_name AS supervisor_name, spt.full_name AS superintendent_name
         FROM shift_assignments sa
         JOIN users u ON u.id = sa.driver_id
         LEFT JOIN users sup ON sup.id = sa.supervisor_id
         LEFT JOIN users spt ON spt.id = sa.superintendent_id
         WHERE sa.shift_id = ? AND sa.equipment_id = ?`
      )
      .get(shiftId, eq.id)) as
      | { status: string; exception_reason: string | null; driver_name: string; supervisor_name: string | null; superintendent_name: string | null }
      | undefined;

    const submission = (await db
      .prepare(`SELECT id, odometer_reading, submitted_at FROM inspection_submissions WHERE shift_id = ? AND equipment_id = ?`)
      .get(shiftId, eq.id)) as { id: string; odometer_reading: number; submitted_at: string } | undefined;

    let previousOdometer: number | null = null;
    if (submission) {
      const prev = (await db
        .prepare(
          `SELECT odometer_reading FROM inspection_submissions
           WHERE equipment_id = ? AND submitted_at < ? ORDER BY submitted_at DESC LIMIT 1`
        )
        .get(eq.id, submission.submitted_at)) as { odometer_reading: number } | undefined;
      previousOdometer = prev ? Number(prev.odometer_reading) : null;
    } else {
      const prev = (await db
        .prepare(`SELECT odometer_reading FROM inspection_submissions WHERE equipment_id = ? ORDER BY submitted_at DESC LIMIT 1`)
        .get(eq.id)) as { odometer_reading: number } | undefined;
      previousOdometer = prev ? Number(prev.odometer_reading) : null;
    }

    const currentOdometer = submission ? Number(submission.odometer_reading) : Number(eq.current_odometer);

    let faults: EquipmentSnapshot["faults"] = [];
    if (submission) {
      const faultRows = (await db
        .prepare(`SELECT description, severity, status FROM faults WHERE submission_id = ?`)
        .all(submission.id)) as { description: string; severity: string; status: string }[];
      faults = faultRows.map((f) => ({ ...f, rectified: f.status === "resolved" }));
    }

    equipment.push({
      equipmentId: eq.id,
      regNo: eq.reg_no,
      category: eq.category_name,
      equipmentStatus: eq.status,
      shiftStatus: assignment ? (assignment.status as "completed" | "exception") : "not_assigned",
      exceptionReason: assignment?.exception_reason ?? null,
      checkedBy: assignment?.status === "completed" ? assignment.driver_name : null,
      supervisorOnDuty: assignment?.supervisor_name ?? null,
      superintendentOnDuty: assignment?.superintendent_name ?? null,
      previousOdometer,
      currentOdometer,
      faults,
    });
  }

  const thisOrder = SHIFT_ORDER[shift.shift_type];
  const priorShifts = (await db
    .prepare(
      `SELECT s.shift_date, s.shift_type, u.full_name
       FROM shifts s JOIN users u ON u.id = s.team_leader_id
       WHERE s.airport_id = ? AND s.id != ?
       ORDER BY s.shift_date DESC`
    )
    .all(airportId, shiftId)) as { shift_date: string; shift_type: string; full_name: string }[];

  const previousShift = priorShifts.find(
    (s) => s.shift_date < shift.shift_date || (s.shift_date === shift.shift_date && SHIFT_ORDER[s.shift_type] < thisOrder)
  );

  const currentShiftLeader = (await db.prepare(`SELECT full_name FROM users WHERE id = ?`).get(shift.team_leader_id)) as
    | { full_name: string }
    | undefined;

  return {
    airportName: airport.name,
    shiftDate: shift.shift_date,
    shiftType: shift.shift_type,
    currentShiftLeaderName: currentShiftLeader?.full_name ?? null,
    previousShiftLeaderName: previousShift?.full_name ?? null,
    equipment,
  };
}
