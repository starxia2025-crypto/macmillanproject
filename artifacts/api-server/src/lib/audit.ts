import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db/schema";
import { stringifyDbJson } from "./db-json.js";

export async function createAuditLog(params: {
  action: string;
  entityType: string;
  entityId: number;
  userId: number;
  tenantId?: number | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
}) {
  try {
    await db.insert(auditLogsTable).values({
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      userId: params.userId,
      tenantId: params.tenantId ?? null,
      oldValues: stringifyDbJson(params.oldValues ?? null),
      newValues: stringifyDbJson(params.newValues ?? null),
    } as any);
  } catch (err) {
    // Audit log failure should not block the main operation
    console.error("Failed to write audit log", err);
  }
}
