import { foreignKey, int, timestamp, varchar, longtext } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { schoolsTable } from "./schools";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";
import { createdAtColumn, helpdeskTable, idColumn, updatedAtColumn } from "./_shared";

export const assistanceRequestStatusEnum = [
  "pendiente",
  "aceptada",
  "programada",
  "en_curso",
  "completada",
  "cancelada",
  "rechazada",
] as const;
export type AssistanceRequestStatus = typeof assistanceRequestStatusEnum[number];

export const assistanceTypeEnum = ["telefonica", "presencial", "remoto", "videoconferencia"] as const;
export type AssistanceType = typeof assistanceTypeEnum[number];

export const assistanceReasonEnum = [
  "incidencia",
  "consulta_general",
  "formacion_especifica",
  "ayuda_recursos_digitales",
  "otro",
] as const;
export type AssistanceReason = typeof assistanceReasonEnum[number];

export const assistanceRequestsTable = helpdeskTable("SOP_assistance_requests", {
  id: idColumn(),
  requestNumber: varchar("request_number", { length: 50 }).notNull().unique(),
  tenantId: int("tenant_id").notNull(),
  schoolId: int("school_id"),
  requesterUserId: int("requester_user_id"),
  requesterName: varchar("requester_name", { length: 255 }).notNull(),
  requesterPhone: varchar("requester_phone", { length: 60 }),
  requesterEmail: varchar("requester_email", { length: 255 }).notNull(),
  assistanceType: varchar("assistance_type", { length: 40 }).notNull(),
  reason: varchar("reason", { length: 60 }).notNull(),
  status: varchar("status", { length: 40 }).notNull().default("pendiente"),
  priority: varchar("priority", { length: 20 }).default("media"),
  productOrService: varchar("product_or_service", { length: 255 }),
  requestedAt: timestamp("requested_at", { mode: "date", fsp: 3 }),
  scheduledAt: timestamp("scheduled_at", { mode: "date", fsp: 3 }),
  scheduledEndAt: timestamp("scheduled_end_at", { mode: "date", fsp: 3 }),
  assignedToId: int("assigned_to_id"),
  description: longtext("description").notNull(),
  internalObservations: longtext("internal_observations"),
  meetingProvider: varchar("meeting_provider", { length: 60 }),
  meetingUrl: varchar("meeting_url", { length: 1000 }),
  meetingId: varchar("meeting_id", { length: 255 }),
  meetingNotes: longtext("meeting_notes"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
}, (table) => [
  foreignKey({
    columns: [table.tenantId],
    foreignColumns: [tenantsTable.id],
    name: "fk_ar_tenant",
  }),
  foreignKey({
    columns: [table.schoolId],
    foreignColumns: [schoolsTable.id],
    name: "fk_ar_school",
  }),
  foreignKey({
    columns: [table.requesterUserId],
    foreignColumns: [usersTable.id],
    name: "fk_ar_requester",
  }),
  foreignKey({
    columns: [table.assignedToId],
    foreignColumns: [usersTable.id],
    name: "fk_ar_assigned",
  }),
]);

export const insertAssistanceRequestSchema = createInsertSchema(assistanceRequestsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAssistanceRequest = z.infer<typeof insertAssistanceRequestSchema>;
export type AssistanceRequest = typeof assistanceRequestsTable.$inferSelect;
