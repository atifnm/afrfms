import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client";
import { requireAuth, requireRole, requireAirportScope, canAccessAirport } from "../../middleware/auth";
import { newId } from "../../utils/id";
import { logAction } from "../../utils/audit";
import { nowSql } from "../../utils/now";

const airportFaultsRouter = Router();
const faultDetailRouter = Router();
const router = airportFaultsRouter; // list route below uses `router`

// Escalation thresholds referenced by the Architecture Doc (6.5): unacknowledged
// critical alerts should escalate after ~15 minutes, minor after ~45. There is
// no background scheduler in this foundation (see README), so this is surfaced
// as a computed `isOverdue` flag on read rather than an active push — a real
// deployment would run a periodic job that queries this same condition and
// fires the escalation Alert automatically.
const CRITICAL_OVERDUE_MINUTES = 15;
const MINOR_OVERDUE_MINUTES = 45;

// GET /airports/:airportId/faults?status=&severity= — fault queue for an
// airport (Architecture Doc 6.7 — Mechanical Officer's live fault queue).
router.get(
  "/:airportId/faults",
  requireAuth,
  requireAirportScope,
  requireRole("MECH_TECHNICIAN", "MECH_OFFICER", "SUPVR", "SR_SUPDT", "SUPDT", "CFRO", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const { status, severity } = req.query as { status?: string; severity?: string };

    let sql = `
      SELECT f.id, f.description, f.severity, f.status, f.reported_at, f.resolved_at,
             e.reg_no, e.id AS equipment_id,
             (SELECT MIN(a.acknowledged_at) FROM alerts a WHERE a.fault_id = f.id) AS earliest_ack
      FROM faults f
      JOIN equipment e ON e.id = f.equipment_id
      WHERE e.airport_id = ?`;
    const params: any[] = [req.params.airportId];
    if (status) {
      sql += ` AND f.status = ?`;
      params.push(status);
    }
    if (severity) {
      sql += ` AND f.severity = ?`;
      params.push(severity);
    }
    sql += ` ORDER BY f.reported_at DESC`;

    const rows = await db.prepare(sql).all(...params) as any[];
    const now = Date.now();

    res.json(
      rows.map((f) => {
        const ageMinutes = (now - new Date(f.reported_at + "Z").getTime()) / 60000;
        const threshold = f.severity === "critical" ? CRITICAL_OVERDUE_MINUTES : MINOR_OVERDUE_MINUTES;
        const isOverdue = f.status === "open" && !f.earliest_ack && ageMinutes > threshold;
        return {
          id: f.id,
          description: f.description,
          severity: f.severity,
          status: f.status,
          equipment: { id: f.equipment_id, regNo: f.reg_no },
          reportedAt: f.reported_at,
          resolvedAt: f.resolved_at,
          isOverdue,
        };
      })
    );
  }
);

// GET /faults/:faultId — full detail: alerts (who was notified + ack state) and diagnosis/repair log.
faultDetailRouter.get(
  "/:faultId",
  requireAuth,
  requireRole("MECH_TECHNICIAN", "MECH_OFFICER", "SUPVR", "SR_SUPDT", "SUPDT", "CFRO", "ADMIN", "GM_FIRE"),
  async (req, res) => {
    const fault = await db.prepare(
        `SELECT f.*, e.reg_no, e.airport_id
         FROM faults f JOIN equipment e ON e.id = f.equipment_id
         WHERE f.id = ?`
      )
      .get(req.params.faultId) as any;
    if (!fault) return res.status(404).json({ error: "Fault not found" });
    if (!canAccessAirport(req.user!, fault.airport_id)) {
      return res.status(403).json({ error: "Forbidden — outside your assigned airport" });
    }

    const alerts = await db.prepare(
        `SELECT a.id, a.recipient_role, a.channel, a.sent_at, a.acknowledged_at, a.resolved_at, u.full_name
         FROM alerts a JOIN users u ON u.id = a.recipient_user_id
         WHERE a.fault_id = ? ORDER BY a.sent_at ASC`
      )
      .all(fault.id) as any[];

    const logs = await db.prepare(
        `SELECT l.id, l.note, l.created_at, u.full_name, u2.name AS role_name
         FROM fault_logs l
         JOIN users u ON u.id = l.user_id
         JOIN roles u2 ON u2.id = u.role_id
         WHERE l.fault_id = ? ORDER BY l.created_at ASC`
      )
      .all(fault.id) as any[];

    res.json({
      id: fault.id,
      description: fault.description,
      severity: fault.severity,
      status: fault.status,
      equipment: { id: fault.equipment_id, regNo: fault.reg_no },
      reportedAt: fault.reported_at,
      resolvedAt: fault.resolved_at,
      alerts: alerts.map((a) => ({
        id: a.id,
        recipient: a.full_name,
        role: a.recipient_role,
        channel: a.channel,
        sentAt: a.sent_at,
        acknowledgedAt: a.acknowledged_at,
        resolvedAt: a.resolved_at,
      })),
      logs: logs.map((l) => ({ id: l.id, note: l.note, author: l.full_name, role: l.role_name, createdAt: l.created_at })),
    });
  }
);

// POST /faults/:faultId/acknowledge — Technician/Officer acknowledges the alert
// routed to them; moves the fault from open -> in_progress (Architecture Doc 7.2).
faultDetailRouter.post(
  "/:faultId/acknowledge",
  requireAuth,
  requireRole("MECH_TECHNICIAN", "MECH_OFFICER"),
  async (req, res) => {
    const fault = await db.prepare(`SELECT f.id, f.status, e.airport_id FROM faults f JOIN equipment e ON e.id = f.equipment_id WHERE f.id = ?`)
      .get(req.params.faultId) as { id: string; status: string; airport_id: string } | undefined;
    if (!fault) return res.status(404).json({ error: "Fault not found" });
    if (!canAccessAirport(req.user!, fault.airport_id)) {
      return res.status(403).json({ error: "Forbidden — outside your assigned airport" });
    }

    const alert = await db.prepare(`SELECT id FROM alerts WHERE fault_id = ? AND recipient_user_id = ?`)
      .get(fault.id, req.user!.userId) as { id: string } | undefined;
    if (!alert) return res.status(404).json({ error: "You were not alerted for this fault" });

    await db.prepare(`UPDATE alerts SET acknowledged_at = ? WHERE id = ?`).run(nowSql(), alert.id);
    if (fault.status === "open") {
      await db.prepare(`UPDATE faults SET status = 'in_progress' WHERE id = ?`).run(fault.id);
    }
    await logAction(req.user!.userId, "FAULT_ACKNOWLEDGED", "Fault", fault.id);
    res.json({ ok: true, faultStatus: fault.status === "open" ? "in_progress" : fault.status });
  }
);

const logSchema = z.object({ note: z.string().min(1) });

// POST /faults/:faultId/logs — Technician/Officer adds a diagnosis or repair note.
faultDetailRouter.post("/:faultId/logs", requireAuth, requireRole("MECH_TECHNICIAN", "MECH_OFFICER"), async (req, res) => {
  const parsed = logSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const fault = await db.prepare(`SELECT f.id, f.status, e.airport_id FROM faults f JOIN equipment e ON e.id = f.equipment_id WHERE f.id = ?`)
    .get(req.params.faultId) as { id: string; status: string; airport_id: string } | undefined;
  if (!fault) return res.status(404).json({ error: "Fault not found" });
  if (!canAccessAirport(req.user!, fault.airport_id)) {
    return res.status(403).json({ error: "Forbidden — outside your assigned airport" });
  }
  if (fault.status === "resolved") {
    return res.status(400).json({ error: "This fault is already resolved" });
  }

  const logId = newId();
  await db.prepare(`INSERT INTO fault_logs (id, fault_id, user_id, note) VALUES (?, ?, ?, ?)`).run(
    logId,
    fault.id,
    req.user!.userId,
    parsed.data.note
  );
  if (fault.status === "open") {
    await db.prepare(`UPDATE faults SET status = 'in_progress' WHERE id = ?`).run(fault.id);
  }
  await logAction(req.user!.userId, "FAULT_LOG_ADDED", "Fault", fault.id);
  res.status(201).json({ id: logId });
});

const resolveSchema = z.object({ resolutionNotes: z.string().min(1) });

// POST /faults/:faultId/resolve — Mechanical Officer sign-off (Architecture
// Doc: "approve fault closure"). Clears the vehicle's grounded status if no
// other open/in-progress critical fault remains against it.
faultDetailRouter.post("/:faultId/resolve", requireAuth, requireRole("MECH_OFFICER", "ADMIN", "GM_FIRE"), async (req, res) => {
  const parsed = resolveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const fault = await db.prepare(`SELECT f.id, f.status, f.severity, f.equipment_id, e.airport_id FROM faults f JOIN equipment e ON e.id = f.equipment_id WHERE f.id = ?`)
    .get(req.params.faultId) as
    | { id: string; status: string; severity: string; equipment_id: string; airport_id: string }
    | undefined;
  if (!fault) return res.status(404).json({ error: "Fault not found" });
  if (!canAccessAirport(req.user!, fault.airport_id)) {
    return res.status(403).json({ error: "Forbidden — outside your assigned airport" });
  }
  if (fault.status === "resolved") {
    return res.status(400).json({ error: "This fault is already resolved" });
  }

  await db.prepare(`UPDATE faults SET status = 'resolved', resolved_at = ? WHERE id = ?`).run(nowSql(), fault.id);
  await db.prepare(`UPDATE alerts SET resolved_at = ? WHERE fault_id = ?`).run(nowSql(), fault.id);
  await db.prepare(`INSERT INTO fault_logs (id, fault_id, user_id, note) VALUES (?, ?, ?, ?)`).run(
    newId(),
    fault.id,
    req.user!.userId,
    `RESOLVED: ${parsed.data.resolutionNotes}`
  );

  const remainingCritical = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM faults WHERE equipment_id = ? AND severity = 'critical' AND status != 'resolved'`
    )
    .get(fault.equipment_id) as { cnt: number };

  let equipmentReactivated = false;
  if (Number(remainingCritical.cnt) === 0) {
    const equipment = await db.prepare(`SELECT status FROM equipment WHERE id = ?`).get(fault.equipment_id) as { status: string };
    if (equipment.status === "grounded") {
      await db.prepare(`UPDATE equipment SET status = 'active' WHERE id = ?`).run(fault.equipment_id);
      equipmentReactivated = true;
    }
  }

  await logAction(req.user!.userId, "FAULT_RESOLVED", "Fault", fault.id, { equipmentReactivated });
  res.json({ ok: true, equipmentReactivated });
});

const escalateSchema = z.object({ reason: z.string().min(1) });

// POST /faults/:faultId/escalate — Mechanical Officer manually escalates an
// unresolved critical fault to the Superintendent (Architecture Doc 6.5:
// "escalate unresolved critical faults"). See CRITICAL_OVERDUE_MINUTES note
// above re: automatic escalation.
faultDetailRouter.post("/:faultId/escalate", requireAuth, requireRole("MECH_OFFICER", "ADMIN", "GM_FIRE"), async (req, res) => {
  const parsed = escalateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const fault = await db.prepare(`SELECT f.id, f.status, e.airport_id FROM faults f JOIN equipment e ON e.id = f.equipment_id WHERE f.id = ?`)
    .get(req.params.faultId) as { id: string; status: string; airport_id: string } | undefined;
  if (!fault) return res.status(404).json({ error: "Fault not found" });
  if (!canAccessAirport(req.user!, fault.airport_id)) {
    return res.status(403).json({ error: "Forbidden — outside your assigned airport" });
  }
  if (fault.status === "resolved") {
    return res.status(400).json({ error: "This fault is already resolved" });
  }

  const escalationTargets = await db.prepare(
      `SELECT u.id, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.airport_id = ? AND r.name IN ('SR_SUPDT', 'SUPDT', 'CFRO') AND u.status = 'active'`
    )
    .all(fault.airport_id) as { id: string; role_name: string }[];

  for (const target of escalationTargets) {
    await db.prepare(`INSERT INTO alerts (id, fault_id, recipient_user_id, recipient_role, channel) VALUES (?, ?, ?, ?, 'sms')`).run(
      newId(),
      fault.id,
      target.id,
      target.role_name
    );
  }
  await db.prepare(`INSERT INTO fault_logs (id, fault_id, user_id, note) VALUES (?, ?, ?, ?)`).run(
    newId(),
    fault.id,
    req.user!.userId,
    `ESCALATED to Superintendent/CFRO: ${parsed.data.reason}`
  );

  await logAction(req.user!.userId, "FAULT_ESCALATED", "Fault", fault.id, { reason: parsed.data.reason });
  res.json({ ok: true, notified: escalationTargets.length });
});

export { airportFaultsRouter, faultDetailRouter };
export default airportFaultsRouter;
