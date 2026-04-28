import { int, timestamp, varchar } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { schoolsTable } from "./schools";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";
import { boolColumn, createdAtColumn, helpdeskTable, idColumn, updatedAtColumn } from "./_shared";

export const externalApiClientsTable = helpdeskTable("SOP_external_api_clients", {
  id: idColumn(),
  tenantId: int("tenant_id").notNull().references(() => tenantsTable.id),
  schoolId: int("school_id").references(() => schoolsTable.id),
  name: varchar("name", { length: 255 }).notNull(),
  clientId: varchar("client_id", { length: 160 }).notNull().unique(),
  apiKeyHash: varchar("api_key_hash", { length: 255 }).notNull(),
  apiKeyLastFour: varchar("api_key_last_four", { length: 4 }).notNull(),
  active: boolColumn("active", true),
  createdByUserId: int("created_by_user_id").references(() => usersTable.id),
  updatedByUserId: int("updated_by_user_id").references(() => usersTable.id),
  lastRotatedByUserId: int("last_rotated_by_user_id").references(() => usersTable.id),
  lastRotatedAt: timestamp("last_rotated_at", { mode: "date", fsp: 3 }),
  lastCallAt: timestamp("last_call_at", { mode: "date", fsp: 3 }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const insertExternalApiClientSchema = createInsertSchema(externalApiClientsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertExternalApiClient = z.infer<typeof insertExternalApiClientSchema>;
export type ExternalApiClient = typeof externalApiClientsTable.$inferSelect;
