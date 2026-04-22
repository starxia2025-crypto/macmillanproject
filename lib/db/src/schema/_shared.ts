import { sql } from "drizzle-orm";
import { boolean, int, longtext, mysqlTable, timestamp } from "drizzle-orm/mysql-core";

export const helpdeskTable = mysqlTable;

export function idColumn(name = "id") {
  return int(name).autoincrement().primaryKey();
}

export function createdAtColumn(name = "created_at") {
  return timestamp(name, { mode: "date", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`);
}

export function updatedAtColumn(name = "updated_at") {
  return timestamp(name, { mode: "date", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`);
}

export function boolColumn(name: string, defaultValue: boolean) {
  return boolean(name).notNull().default(defaultValue);
}

export function jsonTextColumn<T>(name: string, fallbackJson: string | null = null) {
  const column = longtext(name).$type<string | null>();
  return fallbackJson === null ? column : column.notNull().default(fallbackJson);
}
