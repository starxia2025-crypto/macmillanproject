import { varchar, longtext } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { boolColumn, createdAtColumn, helpdeskTable, idColumn, jsonTextColumn, updatedAtColumn } from "./_shared";

export const tenantsTable = helpdeskTable("SOP_tenants", {
  id: idColumn(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  legalName: varchar("legal_name", { length: 255 }),
  educationGroupType: varchar("education_group_type", { length: 80 }).default("school_group"),
  dbSchema: varchar("db_schema", { length: 100 }),
  active: boolColumn("active", true),
  logoUrl: longtext("logo_url"),
  primaryColor: varchar("primary_color", { length: 20 }),
  sidebarBackgroundColor: varchar("sidebar_background_color", { length: 20 }),
  sidebarTextColor: varchar("sidebar_text_color", { length: 20 }),
  hasMochilasAccess: boolColumn("has_mochilas_access", false),
  hasOrderLookup: boolColumn("has_order_lookup", false),
  hasReturnsAccess: boolColumn("has_returns_access", false),
  quickLinks: jsonTextColumn<Array<{ label: string; url: string; icon: string }>>("quick_links"),
  contactEmail: varchar("contact_email", { length: 255 }),
  supportEmail: varchar("support_email", { length: 255 }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const insertTenantSchema = createInsertSchema(tenantsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;
