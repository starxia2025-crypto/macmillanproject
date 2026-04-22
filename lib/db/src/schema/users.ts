import { int, timestamp, varchar, longtext } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { schoolsTable } from "./schools";
import { boolColumn, createdAtColumn, helpdeskTable, idColumn, updatedAtColumn } from "./_shared";

export const userRoleEnum = ["superadmin", "admin_cliente", "manager", "tecnico", "usuario_cliente", "visor_cliente"] as const;
export type UserRole = typeof userRoleEnum[number];
export const userScopeTypeEnum = ["global", "tenant", "school"] as const;
export type UserScopeType = typeof userScopeTypeEnum[number];

export const usersTable = helpdeskTable("SOP_users", {
  id: idColumn(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  passwordHash: longtext("password_hash").notNull(),
  role: varchar("role", { length: 50 }).notNull().default("usuario_cliente"),
  tenantId: int("tenant_id").references(() => tenantsTable.id),
  schoolId: int("school_id").references(() => schoolsTable.id),
  scopeType: varchar("scope_type", { length: 20 }).notNull().default("school"),
  active: boolColumn("active", true),
  mustChangePassword: boolColumn("must_change_password", false),
  failedLoginAttempts: int("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { mode: "date", fsp: 3 }),
  resetPasswordTokenHash: varchar("reset_password_token_hash", { length: 255 }),
  resetPasswordExpiresAt: timestamp("reset_password_expires_at", { mode: "date", fsp: 3 }),
  lastLoginAt: timestamp("last_login_at", { mode: "date", fsp: 3 }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
