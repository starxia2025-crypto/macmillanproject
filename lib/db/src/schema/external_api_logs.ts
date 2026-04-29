import { foreignKey, int, longtext, varchar } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { externalApiClientsTable } from "./external_api_clients";
import { ticketsTable } from "./tickets";
import { createdAtColumn, helpdeskTable, idColumn, updatedAtColumn } from "./_shared";

export const externalApiLogsTable = helpdeskTable("SOP_external_api_logs", {
  id: idColumn(),
  externalApiClientId: int("external_api_client_id"),
  clientId: varchar("client_id", { length: 160 }).notNull(),
  requestPath: varchar("request_path", { length: 255 }).notNull(),
  externalId: varchar("external_id", { length: 255 }),
  eventType: varchar("event_type", { length: 60 }).notNull(),
  statusCode: int("status_code").notNull(),
  success: int("success").notNull().default(0),
  requestSummary: longtext("request_summary"),
  responseSummary: longtext("response_summary"),
  errorMessage: longtext("error_message"),
  sourceIp: varchar("source_ip", { length: 80 }),
  createdTicketId: int("created_ticket_id"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
}, (table) => [
  foreignKey({
    columns: [table.externalApiClientId],
    foreignColumns: [externalApiClientsTable.id],
    name: "fk_eal_client",
  }),
  foreignKey({
    columns: [table.createdTicketId],
    foreignColumns: [ticketsTable.id],
    name: "fk_eal_ticket",
  }),
]);

export const insertExternalApiLogSchema = createInsertSchema(externalApiLogsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertExternalApiLog = z.infer<typeof insertExternalApiLogSchema>;
export type ExternalApiLog = typeof externalApiLogsTable.$inferSelect;
