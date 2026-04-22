import { int, varchar, timestamp, longtext } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";
import { schoolsTable } from "./schools";
import { createdAtColumn, helpdeskTable, idColumn, jsonTextColumn, updatedAtColumn } from "./_shared";

export const ticketStatusEnum = ["nuevo", "pendiente", "en_revision", "en_proceso", "esperando_cliente", "resuelto", "cerrado"] as const;
export type TicketStatus = typeof ticketStatusEnum[number];

export const ticketPriorityEnum = ["baja", "media", "alta", "urgente"] as const;
export type TicketPriority = typeof ticketPriorityEnum[number];

export const ticketsTable = helpdeskTable("SOP_tickets", {
  id: idColumn(),
  ticketNumber: varchar("ticket_number", { length: 50 }).notNull().unique(),
  title: varchar("title", { length: 500 }).notNull(),
  description: longtext("description").notNull(),
  status: varchar("status", { length: 50 }).notNull().default("nuevo"),
  priority: varchar("priority", { length: 20 }).notNull().default("media"),
  category: varchar("category", { length: 255 }),
  tenantId: int("tenant_id").notNull().references(() => tenantsTable.id),
  schoolId: int("school_id").references(() => schoolsTable.id),
  createdById: int("created_by_id").notNull().references(() => usersTable.id),
  assignedToId: int("assigned_to_id").references(() => usersTable.id),
  customFields: jsonTextColumn<Record<string, unknown> | null>("custom_fields"),
  resolvedAt: timestamp("resolved_at", { mode: "date", fsp: 3 }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const insertTicketSchema = createInsertSchema(ticketsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Ticket = typeof ticketsTable.$inferSelect;
