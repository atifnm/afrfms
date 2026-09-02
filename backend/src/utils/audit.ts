import { db } from "../db/client";
import { newId } from "./id";

export async function logAction(
  userId: string,
  action: string,
  entityType?: string,
  entityId?: string,
  metadata?: Record<string, unknown>
) {
  await db
    .prepare(
      `INSERT INTO audit_logs (id, action, entity_type, entity_id, metadata, user_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(newId(), action, entityType ?? null, entityId ?? null, metadata ? JSON.stringify(metadata) : null, userId);
}
