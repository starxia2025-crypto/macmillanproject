import { int, varchar, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { boolColumn, createdAtColumn, helpdeskTable, idColumn, updatedAtColumn } from "./_shared";

export const schoolsTable = helpdeskTable("SOP_schools", {
  id: idColumn(),
  tenantId: int("tenant_id").notNull().references(() => tenantsTable.id),
  parentSchoolId: int("parent_school_id"),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 120 }).notNull(),
  code: varchar("code", { length: 80 }),
  isHeadquarters: boolColumn("is_headquarters", false),
  externalApiEnabled: boolColumn("external_api_enabled", false),
  externalApiClientId: varchar("external_api_client_id", { length: 160 }).unique(),
  externalApiKeyHash: varchar("external_api_key_hash", { length: 255 }),
  externalApiKeyCreatedAt: timestamp("external_api_key_created_at", { mode: "date", fsp: 3 }),
  active: boolColumn("active", true),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const insertSchoolSchema = createInsertSchema(schoolsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSchool = z.infer<typeof insertSchoolSchema>;
export type School = typeof schoolsTable.$inferSelect;
