import crypto from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { externalApiClientsTable, externalApiLogsTable, schoolsTable, tenantsTable, ticketsTable, usersTable } from "@workspace/db/schema";
import { createAuditLog } from "../lib/audit.js";
import { hashPassword, requireAuth, requireRole, verifyPassword } from "../lib/auth.js";
import { stringifyDbJson } from "../lib/db-json.js";
import { logger } from "../lib/logger.js";

const router = Router();

const externalIntegrationTypeEnum = ["email_change", "cancellation"] as const;
const DEFAULT_RATE_LIMIT_MAX_PER_MINUTE = 30;

const basePayloadSchema = z.object({
  externalId: z.string().trim().min(1),
  type: z.enum(externalIntegrationTypeEnum),
  reporterEmail: z.string().trim().email(),
  affectedEmail: z.string().trim().email(),
  orderId: z.string().trim().min(1),
  title: z.string().trim().min(3),
  description: z.string().trim().min(10),
  reason: z.string().trim().min(1),
}).strict();

const emailChangePayloadSchema = basePayloadSchema.extend({
  type: z.literal("email_change"),
  newEmail: z.string().trim().email(),
}).strict();

const cancellationPayloadSchema = basePayloadSchema.extend({
  type: z.literal("cancellation"),
  isbn: z.string().trim().min(1),
}).strict();

const externalPayloadSchema = z.discriminatedUnion("type", [
  emailChangePayloadSchema,
  cancellationPayloadSchema,
]);

type ExternalPayload = z.infer<typeof externalPayloadSchema>;
type ExternalClientConfig = {
  clientId: string;
  apiKey: string | null;
  apiKeyHash: string | null;
  tenantId: number;
  schoolId: number | null;
  fallbackUserId: number | null;
  fallbackUserEmail: string | null;
};

const externalClientSchema = z.object({
  clientId: z.string().trim().min(1),
  apiKey: z.string().trim().min(1),
  tenantId: z.number().int().positive(),
  schoolId: z.number().int().positive().nullable().optional(),
  fallbackUserId: z.number().int().positive().nullable().optional(),
  fallbackUserEmail: z.string().trim().email().nullable().optional(),
}).strict();

const externalClientsSchema = z.array(externalClientSchema).min(1);
const supportClientStatusSchema = z.object({
  active: z.boolean(),
}).strict();

function generateTicketNumber() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `TKT-${timestamp}-${random}`;
}

function generateExternalApiKey() {
  return crypto.randomBytes(32).toString("hex");
}

function buildSchoolExternalClientId(tenantSlug: string, schoolSlug: string) {
  return `${tenantSlug}-${schoolSlug}-${crypto.randomBytes(4).toString("hex")}`.slice(0, 160);
}

function parsePositiveInteger(rawValue: string | undefined) {
  const parsedValue = rawValue ? Number(rawValue) : Number.NaN;
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

function getExternalClientId(requestClientId: string | undefined) {
  return requestClientId?.trim() || null;
}

function safeCompare(secretA: string, secretB: string) {
  const left = Buffer.from(secretA);
  const right = Buffer.from(secretB);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseExternalClientsFromJson() {
  const rawValue = process.env["EXTERNAL_INTEGRATION_CLIENTS_JSON"]?.trim();
  if (!rawValue) return [];

  const parsedValue = JSON.parse(rawValue) as unknown;
  return externalClientsSchema.parse(parsedValue).map((client) => ({
    clientId: client.clientId.trim(),
    apiKey: client.apiKey.trim(),
    apiKeyHash: null,
    tenantId: client.tenantId,
    schoolId: client.schoolId ?? null,
    fallbackUserId: client.fallbackUserId ?? null,
    fallbackUserEmail: client.fallbackUserEmail?.trim().toLowerCase() ?? null,
  }));
}

function getLegacyExternalClientConfig() {
  const apiKey = process.env["EXTERNAL_INTEGRATION_API_KEY"]?.trim();
  const tenantId = parsePositiveInteger(process.env["EXTERNAL_INTEGRATION_TENANT_ID"]);
  if (!apiKey || !tenantId) return null;

  return {
    clientId: process.env["EXTERNAL_INTEGRATION_CLIENT_ID"]?.trim() || "default",
    apiKey,
    apiKeyHash: null,
    tenantId,
    schoolId: parsePositiveInteger(process.env["EXTERNAL_INTEGRATION_SCHOOL_ID"]),
    fallbackUserId: parsePositiveInteger(process.env["EXTERNAL_INTEGRATION_FALLBACK_USER_ID"]),
    fallbackUserEmail: process.env["EXTERNAL_INTEGRATION_FALLBACK_USER_EMAIL"]?.trim().toLowerCase() || null,
  } satisfies ExternalClientConfig;
}

function getConfiguredExternalClients() {
  const jsonClients = parseExternalClientsFromJson();
  if (jsonClients.length > 0) {
    return jsonClients;
  }

  const legacyClient = getLegacyExternalClientConfig();
  return legacyClient ? [legacyClient] : [];
}

async function resolveExternalClient(clientId: string | null) {
  if (!clientId) return null;

  const schoolRows = await db
    .select({
      id: schoolsTable.id,
      tenantId: schoolsTable.tenantId,
      active: schoolsTable.active,
      externalApiEnabled: schoolsTable.externalApiEnabled,
      externalApiClientId: schoolsTable.externalApiClientId,
      externalApiKeyHash: schoolsTable.externalApiKeyHash,
    })
    .from(schoolsTable)
    .where(eq(schoolsTable.externalApiClientId, clientId))
    .limit(1);

  const school = schoolRows[0];
  if (school?.active && school.externalApiEnabled && school.externalApiClientId && school.externalApiKeyHash) {
    return {
      clientId: school.externalApiClientId,
      apiKey: null,
      apiKeyHash: school.externalApiKeyHash,
      tenantId: school.tenantId,
      schoolId: school.id,
      fallbackUserId: null,
      fallbackUserEmail: null,
    } satisfies ExternalClientConfig;
  }

  return getConfiguredExternalClients().find((client) => client.clientId === clientId) ?? null;
}

async function writeExternalApiLog(params: {
  clientId: string | null;
  requestPath: string;
  eventType: string;
  statusCode: number;
  success: boolean;
  externalId?: string | null;
  requestSummary?: Record<string, unknown> | null;
  responseSummary?: Record<string, unknown> | null;
  errorMessage?: string | null;
  sourceIp?: string | null;
  createdTicketId?: number | null;
}) {
  try {
    await db.insert(externalApiLogsTable).values({
      clientId: params.clientId ?? "unknown",
      requestPath: params.requestPath,
      externalId: params.externalId ?? null,
      eventType: params.eventType,
      statusCode: params.statusCode,
      success: params.success ? 1 : 0,
      requestSummary: stringifyDbJson(params.requestSummary ?? null),
      responseSummary: stringifyDbJson(params.responseSummary ?? null),
      errorMessage: params.errorMessage ?? null,
      sourceIp: params.sourceIp ?? null,
      createdTicketId: params.createdTicketId ?? null,
    } as any);
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.message : error }, "Failed to persist external API log");
  }
}

function getExternalRateLimitMaxPerMinute() {
  const parsedValue = parsePositiveInteger(process.env["EXTERNAL_INTEGRATION_RATE_LIMIT_MAX_PER_MINUTE"]);
  return parsedValue ?? DEFAULT_RATE_LIMIT_MAX_PER_MINUTE;
}

async function validateConfiguredTargets(tenantId: number, schoolId: number | null) {
  const tenantRows = await db
    .select({
      id: tenantsTable.id,
      active: tenantsTable.active,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  const tenant = tenantRows[0];
  if (!tenant) {
    return {
      ok: false as const,
      message: "EXTERNAL_INTEGRATION_TENANT_ID no existe en SOP_tenants.",
    };
  }

  if (!tenant.active) {
    return {
      ok: false as const,
      message: "El tenant configurado para la integracion externa esta inactivo.",
    };
  }

  if (!schoolId) {
    return { ok: true as const };
  }

  const schoolRows = await db
    .select({
      id: schoolsTable.id,
      tenantId: schoolsTable.tenantId,
      active: schoolsTable.active,
    })
    .from(schoolsTable)
    .where(eq(schoolsTable.id, schoolId))
    .limit(1);

  const school = schoolRows[0];
  if (!school) {
    return {
      ok: false as const,
      message: "EXTERNAL_INTEGRATION_SCHOOL_ID no existe en SOP_schools.",
    };
  }

  if (!school.active) {
    return {
      ok: false as const,
      message: "El colegio configurado para la integracion externa esta inactivo.",
    };
  }

  if (school.tenantId !== tenantId) {
    return {
      ok: false as const,
      message: "EXTERNAL_INTEGRATION_SCHOOL_ID no pertenece al tenant configurado.",
    };
  }

  return { ok: true as const };
}

function buildTicketCategory(type: ExternalPayload["type"]) {
  return type === "email_change" ? "modificar_correo" : "devolucion_cancelacion";
}

function buildCustomFields(payload: ExternalPayload, clientId: string) {
  const commonFields = {
    source: "external_integration",
    externalIntegration: {
      clientId,
      externalId: payload.externalId,
      type: payload.type,
      reporterEmail: payload.reporterEmail,
      affectedEmail: payload.affectedEmail,
      orderId: payload.orderId,
      reason: payload.reason,
      receivedAt: new Date().toISOString(),
    },
  };

  if (payload.type === "email_change") {
    return {
      ...commonFields,
      affectedEmail: payload.affectedEmail,
      newEmail: payload.newEmail,
      orderId: payload.orderId,
      reason: payload.reason,
    };
  }

  return {
    ...commonFields,
    affectedEmail: payload.affectedEmail,
    orderId: payload.orderId,
    isbn: payload.isbn,
    reason: payload.reason,
  };
}

async function findDuplicateTicket(clientId: string, externalId: string) {
  const safeCustomFields = sql`CASE WHEN JSON_VALID(${ticketsTable.customFields}) THEN ${ticketsTable.customFields} ELSE NULL END`;

  const duplicateTickets = await db
    .select({
      id: ticketsTable.id,
      ticketNumber: ticketsTable.ticketNumber,
    })
    .from(ticketsTable)
    .where(
      and(
        sql`JSON_UNQUOTE(JSON_EXTRACT(${safeCustomFields}, '$.source')) = 'external_integration'`,
        sql`JSON_UNQUOTE(JSON_EXTRACT(${safeCustomFields}, '$.externalIntegration.clientId')) = ${clientId}`,
        sql`JSON_UNQUOTE(JSON_EXTRACT(${safeCustomFields}, '$.externalIntegration.externalId')) = ${externalId}`,
      ),
    )
    .limit(1);

  return duplicateTickets[0] ?? null;
}

async function resolveCreatedById(reporterEmail: string, clientConfig: ExternalClientConfig) {
  const normalizedEmail = reporterEmail.toLowerCase();
  const matchingUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail))
    .limit(1);

  if (matchingUsers[0]?.id) {
    return matchingUsers[0].id;
  }

  if (clientConfig.fallbackUserId) {
    return clientConfig.fallbackUserId;
  }

  const fallbackUserEmail = clientConfig.fallbackUserEmail;
  if (fallbackUserEmail) {
    const fallbackUsers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, fallbackUserEmail))
      .limit(1);

    if (fallbackUsers[0]?.id) {
      return fallbackUsers[0].id;
    }
  }

  const technicalUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.active, true),
        or(eq(usersTable.role, "tecnico"), eq(usersTable.role, "superadmin")),
      ),
    )
    .limit(1);

  return technicalUsers[0]?.id ?? null;
}

async function isValidApiKey(requestApiKey: string | undefined, clientConfig: ExternalClientConfig) {
  if (!requestApiKey?.trim()) {
    return false;
  }

  if (clientConfig.apiKeyHash) {
    return verifyPassword(requestApiKey.trim(), clientConfig.apiKeyHash);
  }

  if (!clientConfig.apiKey) {
    return false;
  }

  return safeCompare(requestApiKey.trim(), clientConfig.apiKey);
}

const externalIntegrationRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: getExternalRateLimitMaxPerMinute(),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator(req) {
    return `${req.ip}:${req.header("x-client-id")?.trim() || "unknown"}`;
  },
  handler(req, res) {
    logger.warn({
      action: "external_integration_rate_limited",
      clientId: req.header("x-client-id")?.trim() || null,
      ip: req.ip,
    }, "External integration rate limit exceeded");
    void writeExternalApiLog({
      clientId: req.header("x-client-id")?.trim() || null,
      requestPath: req.originalUrl,
      eventType: "rate_limited",
      statusCode: 429,
      success: false,
      sourceIp: req.ip,
    });
    res.status(429).json({
      ok: false,
      error: "TooManyRequests",
      message: "Demasiadas solicitudes. Intentalo de nuevo mas tarde.",
    });
  },
});

router.post("/external", externalIntegrationRateLimit, async (req, res) => {
  const clientId = getExternalClientId(req.header("x-client-id") ?? undefined);
  const requestApiKey = req.header("x-api-key") ?? undefined;

  try {
    const configuredClients = getConfiguredExternalClients();
    if (configuredClients.length === 0) {
      logger.error({
        action: "external_integration_configuration_error",
        clientId,
        ip: req.ip,
      }, "External integration is not configured");
      await writeExternalApiLog({
        clientId,
        requestPath: req.originalUrl,
        eventType: "configuration_error",
        statusCode: 503,
        success: false,
        sourceIp: req.ip,
      });
      res.status(503).json({
        ok: false,
        error: "ConfigurationError",
        message: "Servicio temporalmente no disponible.",
      });
      return;
    }

    const clientConfig = await resolveExternalClient(clientId);
    if (!clientConfig || !(await isValidApiKey(requestApiKey, clientConfig))) {
      logger.warn({
        action: "external_integration_auth_failed",
        clientId,
        ip: req.ip,
      }, "External integration authentication failed");
      await writeExternalApiLog({
        clientId,
        requestPath: req.originalUrl,
        eventType: "auth_failed",
        statusCode: 401,
        success: false,
        sourceIp: req.ip,
      });
      res.status(401).json({
        ok: false,
        error: "Unauthorized",
        message: "No autorizado.",
      });
      return;
    }

    const parsedPayload = externalPayloadSchema.safeParse(req.body);
    if (!parsedPayload.success) {
      logger.warn({
        action: "external_integration_validation_failed",
        clientId: clientConfig.clientId,
        ip: req.ip,
      }, "External integration payload validation failed");
      await writeExternalApiLog({
        clientId: clientConfig.clientId,
        requestPath: req.originalUrl,
        eventType: "validation_failed",
        statusCode: 400,
        success: false,
        sourceIp: req.ip,
        requestSummary: {
          keys: Object.keys((req.body as Record<string, unknown>) ?? {}),
        },
        errorMessage: "Payload no valido.",
      });
      res.status(400).json({
        ok: false,
        error: "ValidationError",
        message: "Payload no valido.",
        details: parsedPayload.error.flatten(),
      });
      return;
    }

    const tenantId = clientConfig.tenantId;
    const schoolId = clientConfig.schoolId;

    const targetValidation = await validateConfiguredTargets(tenantId, schoolId);
    if (!targetValidation.ok) {
      logger.error({
        action: "external_integration_configuration_error",
        clientId: clientConfig.clientId,
        ip: req.ip,
      }, targetValidation.message);
      await writeExternalApiLog({
        clientId: clientConfig.clientId,
        requestPath: req.originalUrl,
        eventType: "configuration_error",
        statusCode: 503,
        success: false,
        sourceIp: req.ip,
        errorMessage: targetValidation.message,
      });
      res.status(503).json({
        ok: false,
        error: "ConfigurationError",
        message: "Servicio temporalmente no disponible.",
      });
      return;
    }

    const duplicateTicket = await findDuplicateTicket(clientConfig.clientId, parsedPayload.data.externalId);
    if (duplicateTicket) {
      logger.info({
        action: "external_integration_duplicate",
        clientId: clientConfig.clientId,
        externalId: parsedPayload.data.externalId,
        ticketId: duplicateTicket.id,
        ip: req.ip,
      }, "External integration duplicate request");
      await writeExternalApiLog({
        clientId: clientConfig.clientId,
        requestPath: req.originalUrl,
        eventType: "duplicate",
        statusCode: 200,
        success: true,
        sourceIp: req.ip,
        externalId: parsedPayload.data.externalId,
        requestSummary: {
          type: parsedPayload.data.type,
          orderId: parsedPayload.data.orderId,
        },
        responseSummary: {
          duplicate: true,
          ticketId: duplicateTicket.id,
          ticketNumber: duplicateTicket.ticketNumber,
        },
        createdTicketId: duplicateTicket.id,
      });
      res.status(200).json({
        ok: true,
        ticketId: duplicateTicket.id,
        ticketNumber: duplicateTicket.ticketNumber,
        duplicate: true,
      });
      return;
    }

    const createdById = await resolveCreatedById(parsedPayload.data.reporterEmail, clientConfig);
    if (!createdById) {
      logger.error({
        action: "external_integration_configuration_error",
        clientId: clientConfig.clientId,
        ip: req.ip,
      }, "No se pudo resolver un usuario creador para la integracion externa.");
      await writeExternalApiLog({
        clientId: clientConfig.clientId,
        requestPath: req.originalUrl,
        eventType: "configuration_error",
        statusCode: 503,
        success: false,
        sourceIp: req.ip,
        externalId: parsedPayload.data.externalId,
        errorMessage: "No se pudo resolver un usuario creador.",
      });
      res.status(503).json({
        ok: false,
        error: "ConfigurationError",
        message: "Servicio temporalmente no disponible.",
      });
      return;
    }

    const ticketNumber = generateTicketNumber();
    const customFields = buildCustomFields(parsedPayload.data, clientConfig.clientId);

    await db.insert(ticketsTable).values({
      ticketNumber,
      title: parsedPayload.data.title,
      description: parsedPayload.data.description,
      status: "nuevo",
      priority: "media",
      category: buildTicketCategory(parsedPayload.data.type),
      tenantId,
      schoolId,
      createdById,
      customFields: stringifyDbJson(customFields),
    } as any);

    const createdTickets = await db
      .select({
        id: ticketsTable.id,
        ticketNumber: ticketsTable.ticketNumber,
      })
      .from(ticketsTable)
      .where(eq(ticketsTable.ticketNumber, ticketNumber))
      .limit(1);

    const createdTicket = createdTickets[0];
    if (!createdTicket) {
      logger.error({
        action: "external_integration_create_failed",
        clientId: clientConfig.clientId,
        externalId: parsedPayload.data.externalId,
        ip: req.ip,
      }, "External integration ticket could not be reloaded after insert");
      await writeExternalApiLog({
        clientId: clientConfig.clientId,
        requestPath: req.originalUrl,
        eventType: "create_failed",
        statusCode: 500,
        success: false,
        sourceIp: req.ip,
        externalId: parsedPayload.data.externalId,
        requestSummary: {
          type: parsedPayload.data.type,
          orderId: parsedPayload.data.orderId,
        },
      });
      res.status(500).json({
        ok: false,
        error: "InternalServerError",
        message: "No se pudo procesar la solicitud.",
      });
      return;
    }

    await createAuditLog({
      action: "external_integration_create",
      entityType: "ticket",
      entityId: createdTicket.id,
      userId: createdById,
      tenantId,
      newValues: {
        clientId: clientConfig.clientId,
        externalId: parsedPayload.data.externalId,
        type: parsedPayload.data.type,
        reporterEmail: parsedPayload.data.reporterEmail,
        orderId: parsedPayload.data.orderId,
      },
    });

    logger.info({
      action: "external_integration_created",
      clientId: clientConfig.clientId,
      externalId: parsedPayload.data.externalId,
      ticketId: createdTicket.id,
      ticketNumber: createdTicket.ticketNumber,
      ip: req.ip,
    }, "External integration ticket created");

    await writeExternalApiLog({
      clientId: clientConfig.clientId,
      requestPath: req.originalUrl,
      eventType: "created",
      statusCode: 201,
      success: true,
      sourceIp: req.ip,
      externalId: parsedPayload.data.externalId,
      requestSummary: {
        type: parsedPayload.data.type,
        orderId: parsedPayload.data.orderId,
      },
      responseSummary: {
        duplicate: false,
        ticketId: createdTicket.id,
        ticketNumber: createdTicket.ticketNumber,
      },
      createdTicketId: createdTicket.id,
    });

    res.status(201).json({
      ok: true,
      ticketId: createdTicket.id,
      ticketNumber: createdTicket.ticketNumber,
      duplicate: false,
    });
  } catch (error) {
    logger.error({
      action: "external_integration_internal_error",
      clientId,
      ip: req.ip,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    }, "External integration request failed");
    await writeExternalApiLog({
      clientId,
      requestPath: req.originalUrl,
      eventType: "internal_error",
      statusCode: 500,
      success: false,
      sourceIp: req.ip,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    res.status(500).json({
      ok: false,
      error: "InternalServerError",
      message: "No se pudo procesar la solicitud.",
    });
  }
});

router.get("/clients", requireAuth, requireRole("superadmin", "tecnico"), async (_req, res) => {
  try {
    const schoolRows = await db
      .select({
        schoolId: schoolsTable.id,
        schoolName: schoolsTable.name,
        tenantId: schoolsTable.tenantId,
        tenantName: tenantsTable.name,
        active: schoolsTable.active,
        externalApiEnabled: schoolsTable.externalApiEnabled,
        externalApiClientId: schoolsTable.externalApiClientId,
        externalApiKeyCreatedAt: schoolsTable.externalApiKeyCreatedAt,
        apiKeyLastFour: externalApiClientsTable.apiKeyLastFour,
      })
      .from(schoolsTable)
      .innerJoin(tenantsTable, eq(schoolsTable.tenantId, tenantsTable.id))
      .leftJoin(externalApiClientsTable, eq(externalApiClientsTable.schoolId, schoolsTable.id))
      .where(sql`${schoolsTable.externalApiClientId} IS NOT NULL`)
      .orderBy(asc(tenantsTable.name), asc(schoolsTable.name));

    const clientIds = schoolRows
      .map((row) => row.externalApiClientId)
      .filter((value): value is string => Boolean(value));

    const logSummary = clientIds.length === 0
      ? []
      : await db
          .select({
            clientId: externalApiLogsTable.clientId,
            lastCallAt: sql<Date | null>`MAX(${externalApiLogsTable.createdAt})`,
            totalCalls: count(),
            createdTickets: sql<number>`SUM(CASE WHEN ${externalApiLogsTable.createdTicketId} IS NOT NULL THEN 1 ELSE 0 END)`,
          })
          .from(externalApiLogsTable)
          .where(inArray(externalApiLogsTable.clientId, clientIds))
          .groupBy(externalApiLogsTable.clientId);

    const summaryByClientId = new Map(logSummary.map((row) => [row.clientId, row]));

    res.json({
      data: schoolRows.map((row) => {
        const summary = row.externalApiClientId ? summaryByClientId.get(row.externalApiClientId) : null;
        return {
          schoolId: row.schoolId,
          schoolName: row.schoolName,
          tenantId: row.tenantId,
          tenantName: row.tenantName,
          active: row.active && row.externalApiEnabled,
          clientId: row.externalApiClientId,
          createdAt: row.externalApiKeyCreatedAt,
          lastCallAt: summary?.lastCallAt ?? null,
          totalCalls: Number(summary?.totalCalls ?? 0),
          createdTickets: Number(summary?.createdTickets ?? 0),
          apiKeyLastFour: row.apiKeyLastFour ?? null,
        };
      }),
    });
  } catch (error) {
    res.status(500).json({
      error: "InternalServerError",
      message: "No se pudieron cargar las integraciones externas.",
    });
  }
});

router.get("/logs", requireAuth, requireRole("superadmin", "tecnico"), async (req, res) => {
  try {
    const clientId = getExternalClientId((req.query["clientId"] as string | undefined) ?? undefined);
    const conditions = [];
    if (clientId) conditions.push(eq(externalApiLogsTable.clientId, clientId));

    const logs = await db
      .select({
        id: externalApiLogsTable.id,
        clientId: externalApiLogsTable.clientId,
        externalId: externalApiLogsTable.externalId,
        eventType: externalApiLogsTable.eventType,
        statusCode: externalApiLogsTable.statusCode,
        success: externalApiLogsTable.success,
        requestSummary: externalApiLogsTable.requestSummary,
        responseSummary: externalApiLogsTable.responseSummary,
        errorMessage: externalApiLogsTable.errorMessage,
        sourceIp: externalApiLogsTable.sourceIp,
        createdTicketId: externalApiLogsTable.createdTicketId,
        createdAt: externalApiLogsTable.createdAt,
      })
      .from(externalApiLogsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(externalApiLogsTable.createdAt))
      .limit(300);

    res.json({ data: logs });
  } catch (_error) {
    res.status(500).json({ error: "InternalServerError", message: "No se pudieron cargar los logs de integracion." });
  }
});

router.get("/logs/export", requireAuth, requireRole("superadmin", "tecnico"), async (req, res) => {
  try {
    const clientId = getExternalClientId((req.query["clientId"] as string | undefined) ?? undefined);
    const conditions = [];
    if (clientId) conditions.push(eq(externalApiLogsTable.clientId, clientId));

    const logs = await db
      .select({
        clientId: externalApiLogsTable.clientId,
        externalId: externalApiLogsTable.externalId,
        eventType: externalApiLogsTable.eventType,
        statusCode: externalApiLogsTable.statusCode,
        success: externalApiLogsTable.success,
        errorMessage: externalApiLogsTable.errorMessage,
        sourceIp: externalApiLogsTable.sourceIp,
        createdTicketId: externalApiLogsTable.createdTicketId,
        createdAt: externalApiLogsTable.createdAt,
      })
      .from(externalApiLogsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(externalApiLogsTable.createdAt))
      .limit(1000);

    const rows = [
      "client_id,external_id,event_type,status_code,success,error_message,source_ip,created_ticket_id,created_at",
      ...logs.map((log) =>
        [
          log.clientId,
          log.externalId ?? "",
          log.eventType,
          String(log.statusCode),
          String(log.success),
          (log.errorMessage ?? "").replace(/,/g, " "),
          log.sourceIp ?? "",
          log.createdTicketId ?? "",
          log.createdAt?.toISOString?.() ?? "",
        ].join(","),
      ),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"external-api-logs.csv\"");
    res.send(rows);
  } catch (_error) {
    res.status(500).json({ error: "InternalServerError", message: "No se pudo exportar el registro de llamadas." });
  }
});

router.get("/documentation", requireAuth, requireRole("superadmin", "tecnico"), async (_req, res) => {
  res.json({
    endpoint: "/api/integrations/external",
    method: "POST",
    authHeaders: ["x-client-id", "x-api-key"],
    supportedTypes: externalIntegrationTypeEnum,
    notes: [
      "La API key solo se entrega en el momento de creacion o regeneracion.",
      "Las llamadas duplicadas se controlan por clientId + externalId.",
      "Para videoconferencia se recomienda usar meeting_url externo seguro hasta disponer de integracion Graph/Teams.",
    ],
  });
});

router.patch("/clients/:schoolId/status", requireAuth, requireRole("superadmin", "tecnico"), async (req, res) => {
  const schoolId = Number(req.params["schoolId"]);
  if (!Number.isInteger(schoolId) || schoolId <= 0) {
    res.status(400).json({ error: "ValidationError", message: "Cliente no valido." });
    return;
  }

  const parsed = supportClientStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: "Estado no valido." });
    return;
  }

  try {
    const authUser = (req as any).user;
    const rows = await db
      .select({
        id: schoolsTable.id,
        tenantId: schoolsTable.tenantId,
        slug: schoolsTable.slug,
        externalApiEnabled: schoolsTable.externalApiEnabled,
        externalApiClientId: schoolsTable.externalApiClientId,
        externalApiKeyHash: schoolsTable.externalApiKeyHash,
      })
      .from(schoolsTable)
      .where(eq(schoolsTable.id, schoolId))
      .limit(1);
    const school = rows[0];
    if (!school) {
      res.status(404).json({ error: "NotFound", message: "Cliente no encontrado." });
      return;
    }

    if (!parsed.data.active) {
      await db
        .update(schoolsTable)
        .set({
          externalApiEnabled: false,
          updatedAt: new Date(),
        })
        .where(eq(schoolsTable.id, schoolId));
      await db
        .update(externalApiClientsTable)
        .set({ active: false, updatedByUserId: authUser.userId, updatedAt: new Date() } as any)
        .where(eq(externalApiClientsTable.schoolId, schoolId));

      await createAuditLog({
        action: "deactivate_external_api_key",
        entityType: "school",
        entityId: schoolId,
        userId: authUser.userId,
        tenantId: school.tenantId,
      });

      res.json({ message: "Integracion externa desactivada." });
      return;
    }

    let apiKey: string | null = null;
    let clientId = school.externalApiClientId;
    if (!school.externalApiKeyHash || !clientId) {
      const tenantRows = await db
        .select({ slug: tenantsTable.slug })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, school.tenantId))
        .limit(1);
      const tenant = tenantRows[0];
      if (!tenant) {
        res.status(400).json({ error: "ValidationError", message: "El tenant del cliente no es valido." });
        return;
      }

      clientId = clientId || buildSchoolExternalClientId(tenant.slug, school.slug);
      apiKey = generateExternalApiKey();

      await db
        .update(schoolsTable)
        .set({
          externalApiEnabled: true,
          externalApiClientId: clientId,
          externalApiKeyHash: await hashPassword(apiKey),
          externalApiKeyCreatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schoolsTable.id, schoolId));

      const clientRows = await db
        .select({ id: externalApiClientsTable.id })
        .from(externalApiClientsTable)
        .where(eq(externalApiClientsTable.schoolId, schoolId))
        .limit(1);
      if (clientRows[0]?.id) {
        await db
          .update(externalApiClientsTable)
          .set({
            tenantId: school.tenantId,
            schoolId,
            name: school.slug,
            clientId,
            apiKeyHash: await hashPassword(apiKey),
            apiKeyLastFour: apiKey.slice(-4),
            active: true,
            updatedByUserId: authUser.userId,
            lastRotatedByUserId: authUser.userId,
            lastRotatedAt: new Date(),
            updatedAt: new Date(),
          } as any)
          .where(eq(externalApiClientsTable.id, clientRows[0].id));
      } else {
        await db.insert(externalApiClientsTable).values({
          tenantId: school.tenantId,
          schoolId,
          name: school.slug,
          clientId,
          apiKeyHash: await hashPassword(apiKey),
          apiKeyLastFour: apiKey.slice(-4),
          active: true,
          createdByUserId: authUser.userId,
          updatedByUserId: authUser.userId,
          lastRotatedByUserId: authUser.userId,
          lastRotatedAt: new Date(),
        } as any);
      }
    } else {
      await db
        .update(schoolsTable)
        .set({
          externalApiEnabled: true,
          updatedAt: new Date(),
        })
        .where(eq(schoolsTable.id, schoolId));
      await db
        .update(externalApiClientsTable)
        .set({ active: true, updatedByUserId: authUser.userId, updatedAt: new Date() } as any)
        .where(eq(externalApiClientsTable.schoolId, schoolId));
    }

    await createAuditLog({
      action: "activate_external_api_key",
      entityType: "school",
      entityId: schoolId,
      userId: authUser.userId,
      tenantId: school.tenantId,
      newValues: { clientId },
    });

    res.json({
      message: "Integracion externa activada.",
      provisioning: apiKey ? { clientId, apiKey } : null,
    });
  } catch (_error) {
    res.status(500).json({ error: "InternalServerError", message: "No se pudo actualizar la integracion externa." });
  }
});

export default router;
