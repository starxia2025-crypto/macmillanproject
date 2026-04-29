import { foreignKey, int, longtext, varchar } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { assistanceRequestsTable } from "./assistance_requests";
import { usersTable } from "./users";
import { createdAtColumn, helpdeskTable, idColumn, updatedAtColumn } from "./_shared";

export const assistanceRequestNotesTable = helpdeskTable("SOP_assistance_request_notes", {
  id: idColumn(),
  assistanceRequestId: int("assistance_request_id").notNull(),
  authorUserId: int("author_user_id").notNull(),
  noteType: varchar("note_type", { length: 40 }).notNull().default("internal"),
  content: longtext("content").notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
}, (table) => [
  foreignKey({
    columns: [table.assistanceRequestId],
    foreignColumns: [assistanceRequestsTable.id],
    name: "fk_ar_notes_request",
  }),
  foreignKey({
    columns: [table.authorUserId],
    foreignColumns: [usersTable.id],
    name: "fk_ar_notes_author",
  }),
]);

export const insertAssistanceRequestNoteSchema = createInsertSchema(assistanceRequestNotesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAssistanceRequestNote = z.infer<typeof insertAssistanceRequestNoteSchema>;
export type AssistanceRequestNote = typeof assistanceRequestNotesTable.$inferSelect;
