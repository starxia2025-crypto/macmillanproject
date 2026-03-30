import { pgTable, serial, text, boolean, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

export const documentTypeEnum = ["manual", "tutorial", "video", "faq", "link", "other"] as const;
export type DocumentType = typeof documentTypeEnum[number];

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  type: varchar("type", { length: 50 }).notNull().default("other"),
  category: varchar("category", { length: 255 }),
  url: text("url"),
  content: text("content"),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  tags: text("tags").array().notNull().default([]),
  visibleToRoles: text("visible_to_roles").array().notNull().default(["usuario_cliente", "visor_cliente", "tecnico", "admin_cliente", "superadmin"]),
  published: boolean("published").notNull().default(false),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
