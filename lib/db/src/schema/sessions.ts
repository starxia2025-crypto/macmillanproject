import { int, varchar, timestamp } from "drizzle-orm/mysql-core";
import { usersTable } from "./users";
import { createdAtColumn, helpdeskTable, idColumn } from "./_shared";

export const sessionsTable = helpdeskTable("SOP_sessions", {
  id: idColumn(),
  sessionToken: varchar("session_token", { length: 255 }).notNull().unique(),
  userId: int("user_id").notNull().references(() => usersTable.id),
  expiresAt: timestamp("expires_at", { mode: "date", fsp: 3 }).notNull(),
  createdAt: createdAtColumn(),
});

export type Session = typeof sessionsTable.$inferSelect;
