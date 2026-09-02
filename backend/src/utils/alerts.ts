import { db } from "../db/client";
import { newId } from "./id";

/**
 * Dispatches Alerts for a newly created Fault (Architecture Doc, Section
 * 6.5, steps 1–2). Minor faults notify the Technician queue only; critical
 * faults also notify Mechanical Officers immediately. Real push/SMS
 * transport (FCM, SMS gateway) is an integration layer that would call out
 * from here in production — this creates the Alert rows that record who
 * was notified and when, and that acknowledge/resolve tracking hangs off.
 */
export async function dispatchAlertsForFault(
  faultId: string,
  equipmentAirportId: string,
  severity: "minor" | "critical"
): Promise<number> {
  const roles = severity === "critical" ? ["MECH_TECHNICIAN", "MECH_OFFICER"] : ["MECH_TECHNICIAN"];
  const placeholders = roles.map(() => "?").join(", ");

  const recipients = (await db
    .prepare(
      `SELECT u.id, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.airport_id = ? AND r.name IN (${placeholders}) AND u.status = 'active'`
    )
    .all(equipmentAirportId, ...roles)) as { id: string; role_name: string }[];

  for (const recipient of recipients) {
    await db
      .prepare(`INSERT INTO alerts (id, fault_id, recipient_user_id, recipient_role, channel) VALUES (?, ?, ?, ?, ?)`)
      .run(newId(), faultId, recipient.id, recipient.role_name, severity === "critical" ? "sms" : "in_app");
  }

  return recipients.length;
}
