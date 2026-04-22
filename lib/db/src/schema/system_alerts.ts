import { int, varchar, longtext } from "drizzle-orm/mysql-core";
import { usersTable } from "./users";
import { boolColumn, createdAtColumn, helpdeskTable, idColumn, updatedAtColumn } from "./_shared";

export const systemAlertTypeEnum = ["info", "warning", "urgent"] as const;
export type SystemAlertType = typeof systemAlertTypeEnum[number];

export const systemAlertsTable = helpdeskTable("SOP_system_alerts", {
  id: idColumn(),
  title: varchar("title", { length: 255 }).notNull(),
  message: longtext("message").notNull(),
  type: varchar("type", { length: 20 }).notNull().default("warning"),
  active: boolColumn("active", false),
  createdById: int("created_by_id").references(() => usersTable.id),
  updatedById: int("updated_by_id").references(() => usersTable.id),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export type SystemAlert = typeof systemAlertsTable.$inferSelect;
