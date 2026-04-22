import { int, varchar } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { tenantsTable } from "./tenants";
import { createdAtColumn, helpdeskTable, idColumn, jsonTextColumn } from "./_shared";

export const auditLogsTable = helpdeskTable("SOP_audit_logs", {
  id: idColumn(),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entity_type", { length: 100 }).notNull(),
  entityId: int("entity_id").notNull(),
  userId: int("user_id").notNull().references(() => usersTable.id),
  tenantId: int("tenant_id").references(() => tenantsTable.id),
  oldValues: jsonTextColumn<Record<string, unknown> | null>("old_values"),
  newValues: jsonTextColumn<Record<string, unknown> | null>("new_values"),
  createdAt: createdAtColumn(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
