import { pgTable, serial, text, boolean, timestamp, integer, varchar, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

export const ticketStatusEnum = ["nuevo", "pendiente", "en_revision", "en_proceso", "esperando_cliente", "resuelto", "cerrado"] as const;
export type TicketStatus = typeof ticketStatusEnum[number];

export const ticketPriorityEnum = ["baja", "media", "alta", "urgente"] as const;
export type TicketPriority = typeof ticketPriorityEnum[number];

export const ticketsTable = pgTable("tickets", {
  id: serial("id").primaryKey(),
  ticketNumber: varchar("ticket_number", { length: 50 }).notNull().unique(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description").notNull(),
  status: varchar("status", { length: 50 }).notNull().default("nuevo"),
  priority: varchar("priority", { length: 20 }).notNull().default("media"),
  category: varchar("category", { length: 255 }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id),
  assignedToId: integer("assigned_to_id").references(() => usersTable.id),
  customFields: jsonb("custom_fields"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTicketSchema = createInsertSchema(ticketsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Ticket = typeof ticketsTable.$inferSelect;
