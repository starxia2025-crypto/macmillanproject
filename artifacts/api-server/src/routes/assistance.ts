import { Router } from "express";
import { and, asc, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  assistanceRequestNotesTable,
  assistanceRequestsTable,
  schoolsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db/schema";
import { createAuditLog } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import { requireAuth, requireRole } from "../lib/auth.js";

const router = Router();

const clientCreatorRoles = ["admin_cliente", "manager", "usuario_cliente"] as const;
const supportRoles = ["superadmin", "tecnico"] as const;
const allAccessRoles = [...clientCreatorRoles, ...supportRoles, "visor_cliente"] as const;
const assistanceStatusEnum = ["pendiente", "aceptada", "programada", "en_curso", "completada", "cancelada", "rechazada"] as const;
const assistanceTypeEnum = ["telefonica", "presencial", "remoto", "videoconferencia"] as const;
const assistanceReasonEnum = ["incidencia", "consulta_general", "formacion_especifica", "ayuda_recursos_digitales", "otro"] as const;
const priorityEnum = ["baja", "media", "alta", "urgente"] as const;
const meetingProviderEnum = ["teams", "externo", "ninguno"] as const;

const createAssistanceRequestSchema = z.object({
  assistanceType: z.enum(assistanceTypeEnum),
  reason: z.enum(assistanceReasonEnum),
  schoolId: z.number().int().positive().nullable().optional(),
  requesterName: z.string().trim().min(2).max(255),
  requesterPhone: z.string().trim().min(6).max(60).nullable().optional(),
  requesterEmail: z.string().trim().email(),
  requestedAt: z.string().datetime().nullable().optional(),
  description: z.string().trim().min(10).max(5000),
  priority: z.enum(priorityEnum).optional(),
  productOrService: z.string().trim().max(255).nullable().optional(),
}).strict();

const updateAssistanceRequestSchema = z.object({
  status: z.enum(assistanceStatusEnum).optional(),
  assignedToId: z.number().int().positive().nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  scheduledEndAt: z.string().datetime().nullable().optional(),
  internalObservations: z.string().trim().max(5000).nullable().optional(),
  meetingProvider: z.enum(meetingProviderEnum).nullable().optional(),
  meetingUrl: z.union([z.string().trim().url(), z.literal(""), z.null()]).optional(),
  meetingId: z.string().trim().max(255).nullable().optional(),
  meetingNotes: z.string().trim().max(5000).nullable().optional(),
}).strict();

const addAssistanceNoteSchema = z.object({
  content: z.string().trim().min(2).max(5000),
}).strict();

const supportListQuerySchema = z.object({
  status: z.string().trim().optional(),
  assistanceType: z.string().trim().optional(),
  priority: z.string().trim().optional(),
  schoolId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
}).strict();

function generateAssistanceRequestNumber() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `AST-${timestamp}-${random}`;
}

function isSupportUser(user: any) {
  return supportRoles.includes(user.role);
}

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toNullableDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getSafeErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    logger.error({ err: error.message }, fallback);
  } else {
    logger.error({ err: error }, fallback);
  }
  return fallback;
}

function escapeIcsText(value: string | null | undefined) {
  return (value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatIcsDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildIcsContent(request: {
  requestNumber: string;
  assistanceType: string;
  requesterName: string;
  requesterEmail: string;
  requesterPhone: string | null;
  schoolName: string | null;
  description: string;
  scheduledAt: Date | null;
  scheduledEndAt: Date | null;
  meetingUrl: string | null;
}) {
  const start = request.scheduledAt ?? new Date();
  const end = request.scheduledEndAt ?? new Date(start.getTime() + 60 * 60 * 1000);
  const title = `Asistencia ${request.assistanceType} - ${request.schoolName || request.requesterName}`;
  const description = [
    `Solicitud: ${request.requestNumber}`,
    `Solicitante: ${request.requesterName}`,
    `Email: ${request.requesterEmail}`,
    request.requesterPhone ? `Telefono: ${request.requesterPhone}` : null,
    request.schoolName ? `Colegio: ${request.schoolName}` : null,
    `Descripcion: ${request.description}`,
    request.meetingUrl ? `Videoconferencia: ${request.meetingUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Macmillan Bridge//Assistance//ES",
    "BEGIN:VEVENT",
    `UID:${request.requestNumber}@bridge.macmillan.es`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(start)}`,
    `DTEND:${formatIcsDate(end)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    request.meetingUrl ? `URL:${request.meetingUrl}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

async function getSchoolContext(schoolId: number | null | undefined) {
  if (!schoolId) return null;
  const rows = await db
    .select({
      id: schoolsTable.id,
      tenantId: schoolsTable.tenantId,
      name: schoolsTable.name,
      active: schoolsTable.active,
    })
    .from(schoolsTable)
    .where(eq(schoolsTable.id, schoolId))
    .limit(1);
  return rows[0] ?? null;
}

async function ensureAssistanceAccess(user: any, requestId: number) {
  const rows = await db
    .select({
      id: assistanceRequestsTable.id,
      tenantId: assistanceRequestsTable.tenantId,
      schoolId: assistanceRequestsTable.schoolId,
      requesterUserId: assistanceRequestsTable.requesterUserId,
    })
    .from(assistanceRequestsTable)
    .where(eq(assistanceRequestsTable.id, requestId))
    .limit(1);

  const request = rows[0];
  if (!request) return null;
  if (isSupportUser(user)) return request;
  if (user.role === "usuario_cliente") {
    return request.requesterUserId === user.userId ? request : null;
  }
  if (user.role === "admin_cliente" || user.role === "manager" || user.role === "visor_cliente") {
    return request.tenantId === user.tenantId ? request : null;
  }
  return null;
}

router.get("/meta", requireAuth, requireRole(...allAccessRoles), async (req, res) => {
  try {
    const user = (req as any).user;
    const schoolConditions = [];
    if (!isSupportUser(user) && user.tenantId) {
      schoolConditions.push(eq(schoolsTable.tenantId, user.tenantId));
    }
    if (!isSupportUser(user) && user.schoolId) {
      schoolConditions.push(eq(schoolsTable.id, user.schoolId));
    }

    const [schools, technicians] = await Promise.all([
      db
        .select({
          id: schoolsTable.id,
          tenantId: schoolsTable.tenantId,
          name: schoolsTable.name,
        })
        .from(schoolsTable)
        .where(schoolConditions.length > 0 ? and(...schoolConditions) : undefined)
        .orderBy(asc(schoolsTable.name)),
      db
        .select({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
        })
        .from(usersTable)
        .where(and(eq(usersTable.role, "tecnico"), eq(usersTable.active, true)))
        .orderBy(asc(usersTable.name)),
    ]);

    res.json({
      schools,
      technicians,
      assistanceTypes: assistanceTypeEnum,
      reasons: assistanceReasonEnum,
      statuses: assistanceStatusEnum,
      priorities: priorityEnum,
    });
  } catch (error) {
    res.status(500).json({ error: "InternalServerError", message: getSafeErrorMessage(error, "No se pudo cargar la configuracion de asistencias.") });
  }
});

router.post("/requests", requireAuth, requireRole(...clientCreatorRoles, ...supportRoles), async (req, res) => {
  const parsed = createAssistanceRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: "Datos de solicitud no validos." });
    return;
  }

  try {
    const user = (req as any).user;
    const schoolId = parsed.data.schoolId ?? user.schoolId ?? null;
    const school = await getSchoolContext(schoolId);

    if (schoolId && !school) {
      res.status(400).json({ error: "ValidationError", message: "El colegio seleccionado no existe." });
      return;
    }

    const tenantId = school?.tenantId ?? user.tenantId ?? null;
    if (!tenantId) {
      res.status(400).json({ error: "ValidationError", message: "No se pudo determinar el cliente o centro asociado." });
      return;
    }

    if (!isSupportUser(user) && user.tenantId && tenantId !== user.tenantId) {
      res.status(403).json({ error: "Forbidden", message: "No puedes crear solicitudes fuera de tu cliente." });
      return;
    }

    const requestedAt = toNullableDate(parsed.data.requestedAt ?? null);
    const requestNumber = generateAssistanceRequestNumber();

    await db.insert(assistanceRequestsTable).values({
      requestNumber,
      tenantId,
      schoolId,
      requesterUserId: user.userId ?? null,
      requesterName: parsed.data.requesterName,
      requesterPhone: normalizeNullableText(parsed.data.requesterPhone),
      requesterEmail: parsed.data.requesterEmail.toLowerCase(),
      assistanceType: parsed.data.assistanceType,
      reason: parsed.data.reason,
      status: "pendiente",
      priority: parsed.data.priority ?? "media",
      productOrService: normalizeNullableText(parsed.data.productOrService),
      requestedAt,
      description: parsed.data.description,
      meetingProvider: parsed.data.assistanceType === "videoconferencia" ? "teams" : "ninguno",
    } as any);

    const inserted = await db
      .select({ id: assistanceRequestsTable.id })
      .from(assistanceRequestsTable)
      .where(eq(assistanceRequestsTable.requestNumber, requestNumber))
      .limit(1);

    const requestId = inserted[0]?.id;
    if (!requestId) {
      res.status(500).json({ error: "InternalServerError", message: "No se pudo crear la solicitud." });
      return;
    }

    await createAuditLog({
      action: "create_assistance_request",
      entityType: "assistance_request",
      entityId: requestId,
      userId: user.userId,
      tenantId,
      newValues: {
        requestNumber,
        assistanceType: parsed.data.assistanceType,
        reason: parsed.data.reason,
        schoolId,
      },
    });

    res.status(201).json({
      id: requestId,
      requestNumber,
      status: "pendiente",
      message: "Solicitud registrada correctamente.",
    });
  } catch (error) {
    res.status(500).json({ error: "InternalServerError", message: getSafeErrorMessage(error, "No se pudo registrar la solicitud de asistencia.") });
  }
});

router.get("/requests/mine", requireAuth, requireRole(...allAccessRoles), async (req, res) => {
  try {
    const user = (req as any).user;
    const conditions = [];

    if (isSupportUser(user)) {
      if (user.tenantId) conditions.push(eq(assistanceRequestsTable.tenantId, user.tenantId));
    } else if (user.role === "usuario_cliente") {
      conditions.push(eq(assistanceRequestsTable.requesterUserId, user.userId));
    } else if (user.tenantId) {
      conditions.push(eq(assistanceRequestsTable.tenantId, user.tenantId));
    }

    const rows = await db
      .select({
        id: assistanceRequestsTable.id,
        requestNumber: assistanceRequestsTable.requestNumber,
        status: assistanceRequestsTable.status,
        assistanceType: assistanceRequestsTable.assistanceType,
        reason: assistanceRequestsTable.reason,
        requesterName: assistanceRequestsTable.requesterName,
        requesterEmail: assistanceRequestsTable.requesterEmail,
        requestedAt: assistanceRequestsTable.requestedAt,
        scheduledAt: assistanceRequestsTable.scheduledAt,
        priority: assistanceRequestsTable.priority,
        productOrService: assistanceRequestsTable.productOrService,
        description: assistanceRequestsTable.description,
        schoolName: schoolsTable.name,
        technicianName: usersTable.name,
        createdAt: assistanceRequestsTable.createdAt,
        updatedAt: assistanceRequestsTable.updatedAt,
      })
      .from(assistanceRequestsTable)
      .leftJoin(schoolsTable, eq(assistanceRequestsTable.schoolId, schoolsTable.id))
      .leftJoin(usersTable, eq(assistanceRequestsTable.assignedToId, usersTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(assistanceRequestsTable.createdAt));

    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: "InternalServerError", message: getSafeErrorMessage(error, "No se pudieron cargar las solicitudes de asistencia.") });
  }
});

router.get("/requests/support", requireAuth, requireRole(...supportRoles), async (req, res) => {
  const parsed = supportListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: "Filtros de asistencia no validos." });
    return;
  }

  try {
    const filters = parsed.data;
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 50, 100);
    const offset = (page - 1) * limit;
    const conditions = [];

    if (filters.status && (assistanceStatusEnum as readonly string[]).includes(filters.status)) {
      conditions.push(eq(assistanceRequestsTable.status, filters.status));
    }
    if (filters.assistanceType && (assistanceTypeEnum as readonly string[]).includes(filters.assistanceType)) {
      conditions.push(eq(assistanceRequestsTable.assistanceType, filters.assistanceType));
    }
    if (filters.priority && (priorityEnum as readonly string[]).includes(filters.priority)) {
      conditions.push(eq(assistanceRequestsTable.priority, filters.priority));
    }
    if (filters.schoolId) {
      conditions.push(eq(assistanceRequestsTable.schoolId, filters.schoolId));
    }
    const dateFrom = toNullableDate(filters.dateFrom);
    const dateTo = toNullableDate(filters.dateTo);
    if (dateFrom) conditions.push(gte(assistanceRequestsTable.createdAt, dateFrom));
    if (dateTo) conditions.push(lte(assistanceRequestsTable.createdAt, dateTo));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRows] = await Promise.all([
      db
        .select({
          id: assistanceRequestsTable.id,
          requestNumber: assistanceRequestsTable.requestNumber,
          status: assistanceRequestsTable.status,
          assistanceType: assistanceRequestsTable.assistanceType,
          reason: assistanceRequestsTable.reason,
          requesterName: assistanceRequestsTable.requesterName,
          requesterEmail: assistanceRequestsTable.requesterEmail,
          requesterPhone: assistanceRequestsTable.requesterPhone,
          requestedAt: assistanceRequestsTable.requestedAt,
          scheduledAt: assistanceRequestsTable.scheduledAt,
          priority: assistanceRequestsTable.priority,
          productOrService: assistanceRequestsTable.productOrService,
          description: assistanceRequestsTable.description,
          internalObservations: assistanceRequestsTable.internalObservations,
          meetingProvider: assistanceRequestsTable.meetingProvider,
          meetingUrl: assistanceRequestsTable.meetingUrl,
          meetingId: assistanceRequestsTable.meetingId,
          meetingNotes: assistanceRequestsTable.meetingNotes,
          schoolName: schoolsTable.name,
          tenantName: tenantsTable.name,
          technicianName: usersTable.name,
          assignedToId: assistanceRequestsTable.assignedToId,
          createdAt: assistanceRequestsTable.createdAt,
          updatedAt: assistanceRequestsTable.updatedAt,
        })
        .from(assistanceRequestsTable)
        .leftJoin(schoolsTable, eq(assistanceRequestsTable.schoolId, schoolsTable.id))
        .leftJoin(tenantsTable, eq(assistanceRequestsTable.tenantId, tenantsTable.id))
        .leftJoin(usersTable, eq(assistanceRequestsTable.assignedToId, usersTable.id))
        .where(whereClause)
        .orderBy(
          sql`CASE
            WHEN ${assistanceRequestsTable.scheduledAt} IS NULL THEN 1
            ELSE 0
          END`,
          asc(assistanceRequestsTable.scheduledAt),
          desc(assistanceRequestsTable.createdAt),
        )
        .limit(limit)
        .offset(offset),
      db.select({ count: count() }).from(assistanceRequestsTable).where(whereClause),
    ]);

    res.json({
      data: rows,
      total: Number(totalRows[0]?.count ?? 0),
      page,
      limit,
      totalPages: Math.ceil(Number(totalRows[0]?.count ?? 0) / limit),
    });
  } catch (error) {
    res.status(500).json({ error: "InternalServerError", message: getSafeErrorMessage(error, "No se pudo cargar la bandeja de asistencias.") });
  }
});

router.get("/requests/:id", requireAuth, requireRole(...allAccessRoles), async (req, res) => {
  const requestId = Number(req.params["id"]);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    res.status(400).json({ error: "ValidationError", message: "Solicitud no valida." });
    return;
  }

  try {
    const user = (req as any).user;
    const access = await ensureAssistanceAccess(user, requestId);
    if (!access) {
      res.status(404).json({ error: "NotFound", message: "Solicitud no encontrada." });
      return;
    }

    const [requestRows, notes] = await Promise.all([
      db
        .select({
          id: assistanceRequestsTable.id,
          requestNumber: assistanceRequestsTable.requestNumber,
          status: assistanceRequestsTable.status,
          assistanceType: assistanceRequestsTable.assistanceType,
          reason: assistanceRequestsTable.reason,
          requesterName: assistanceRequestsTable.requesterName,
          requesterEmail: assistanceRequestsTable.requesterEmail,
          requesterPhone: assistanceRequestsTable.requesterPhone,
          requestedAt: assistanceRequestsTable.requestedAt,
          scheduledAt: assistanceRequestsTable.scheduledAt,
          scheduledEndAt: assistanceRequestsTable.scheduledEndAt,
          priority: assistanceRequestsTable.priority,
          productOrService: assistanceRequestsTable.productOrService,
          description: assistanceRequestsTable.description,
          internalObservations: assistanceRequestsTable.internalObservations,
          meetingProvider: assistanceRequestsTable.meetingProvider,
          meetingUrl: assistanceRequestsTable.meetingUrl,
          meetingId: assistanceRequestsTable.meetingId,
          meetingNotes: assistanceRequestsTable.meetingNotes,
          schoolName: schoolsTable.name,
          tenantName: tenantsTable.name,
          technicianName: usersTable.name,
          assignedToId: assistanceRequestsTable.assignedToId,
          createdAt: assistanceRequestsTable.createdAt,
          updatedAt: assistanceRequestsTable.updatedAt,
        })
        .from(assistanceRequestsTable)
        .leftJoin(schoolsTable, eq(assistanceRequestsTable.schoolId, schoolsTable.id))
        .leftJoin(tenantsTable, eq(assistanceRequestsTable.tenantId, tenantsTable.id))
        .leftJoin(usersTable, eq(assistanceRequestsTable.assignedToId, usersTable.id))
        .where(eq(assistanceRequestsTable.id, requestId))
        .limit(1),
      db
        .select({
          id: assistanceRequestNotesTable.id,
          noteType: assistanceRequestNotesTable.noteType,
          content: assistanceRequestNotesTable.content,
          createdAt: assistanceRequestNotesTable.createdAt,
          authorName: usersTable.name,
        })
        .from(assistanceRequestNotesTable)
        .innerJoin(usersTable, eq(assistanceRequestNotesTable.authorUserId, usersTable.id))
        .where(eq(assistanceRequestNotesTable.assistanceRequestId, requestId))
        .orderBy(desc(assistanceRequestNotesTable.createdAt)),
    ]);

    res.json({
      ...requestRows[0],
      notes: isSupportUser(user) ? notes : [],
    });
  } catch (error) {
    res.status(500).json({ error: "InternalServerError", message: getSafeErrorMessage(error, "No se pudo cargar el detalle de la asistencia.") });
  }
});

router.patch("/requests/:id", requireAuth, requireRole(...supportRoles), async (req, res) => {
  const requestId = Number(req.params["id"]);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    res.status(400).json({ error: "ValidationError", message: "Solicitud no valida." });
    return;
  }

  const parsed = updateAssistanceRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: "Datos de actualizacion no validos." });
    return;
  }

  try {
    const user = (req as any).user;
    const rows = await db.select().from(assistanceRequestsTable).where(eq(assistanceRequestsTable.id, requestId)).limit(1);
    const current = rows[0];
    if (!current) {
      res.status(404).json({ error: "NotFound", message: "Solicitud no encontrada." });
      return;
    }

    if (parsed.data.assignedToId) {
      const technicians = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.id, parsed.data.assignedToId), eq(usersTable.role, "tecnico"), eq(usersTable.active, true)))
        .limit(1);
      if (!technicians[0]) {
        res.status(400).json({ error: "ValidationError", message: "El tecnico seleccionado no es valido." });
        return;
      }
    }

    const updateValues: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (parsed.data.status !== undefined) updateValues["status"] = parsed.data.status;
    if (parsed.data.assignedToId !== undefined) updateValues["assignedToId"] = parsed.data.assignedToId;
    if (parsed.data.scheduledAt !== undefined) updateValues["scheduledAt"] = toNullableDate(parsed.data.scheduledAt ?? null);
    if (parsed.data.scheduledEndAt !== undefined) updateValues["scheduledEndAt"] = toNullableDate(parsed.data.scheduledEndAt ?? null);
    if (parsed.data.internalObservations !== undefined) updateValues["internalObservations"] = normalizeNullableText(parsed.data.internalObservations);
    if (parsed.data.meetingProvider !== undefined) updateValues["meetingProvider"] = parsed.data.meetingProvider;
    if (parsed.data.meetingUrl !== undefined) updateValues["meetingUrl"] = normalizeNullableText(parsed.data.meetingUrl ?? null);
    if (parsed.data.meetingId !== undefined) updateValues["meetingId"] = normalizeNullableText(parsed.data.meetingId);
    if (parsed.data.meetingNotes !== undefined) updateValues["meetingNotes"] = normalizeNullableText(parsed.data.meetingNotes);

    await db.update(assistanceRequestsTable).set(updateValues as any).where(eq(assistanceRequestsTable.id, requestId));

    await createAuditLog({
      action: "update_assistance_request",
      entityType: "assistance_request",
      entityId: requestId,
      userId: user.userId,
      tenantId: current.tenantId,
      oldValues: {
        status: current.status,
        assignedToId: current.assignedToId,
        scheduledAt: current.scheduledAt,
      },
      newValues: parsed.data,
    });

    res.json({ message: "Solicitud actualizada correctamente." });
  } catch (error) {
    res.status(500).json({ error: "InternalServerError", message: getSafeErrorMessage(error, "No se pudo actualizar la solicitud de asistencia.") });
  }
});

router.post("/requests/:id/notes", requireAuth, requireRole(...supportRoles), async (req, res) => {
  const requestId = Number(req.params["id"]);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    res.status(400).json({ error: "ValidationError", message: "Solicitud no valida." });
    return;
  }

  const parsed = addAssistanceNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: "La nota no es valida." });
    return;
  }

  try {
    const user = (req as any).user;
    const rows = await db.select().from(assistanceRequestsTable).where(eq(assistanceRequestsTable.id, requestId)).limit(1);
    const current = rows[0];
    if (!current) {
      res.status(404).json({ error: "NotFound", message: "Solicitud no encontrada." });
      return;
    }

    await db.insert(assistanceRequestNotesTable).values({
      assistanceRequestId: requestId,
      authorUserId: user.userId,
      noteType: "internal",
      content: parsed.data.content,
    } as any);

    await createAuditLog({
      action: "add_assistance_note",
      entityType: "assistance_request",
      entityId: requestId,
      userId: user.userId,
      tenantId: current.tenantId,
      newValues: { noteType: "internal" },
    });

    res.status(201).json({ message: "Observacion interna guardada." });
  } catch (error) {
    res.status(500).json({ error: "InternalServerError", message: getSafeErrorMessage(error, "No se pudo guardar la observacion interna.") });
  }
});

router.get("/requests/:id/ics", requireAuth, requireRole(...allAccessRoles), async (req, res) => {
  const requestId = Number(req.params["id"]);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    res.status(400).json({ error: "ValidationError", message: "Solicitud no valida." });
    return;
  }

  try {
    const user = (req as any).user;
    const access = await ensureAssistanceAccess(user, requestId);
    if (!access) {
      res.status(404).json({ error: "NotFound", message: "Solicitud no encontrada." });
      return;
    }

    const rows = await db
      .select({
        requestNumber: assistanceRequestsTable.requestNumber,
        assistanceType: assistanceRequestsTable.assistanceType,
        requesterName: assistanceRequestsTable.requesterName,
        requesterEmail: assistanceRequestsTable.requesterEmail,
        requesterPhone: assistanceRequestsTable.requesterPhone,
        schoolName: schoolsTable.name,
        description: assistanceRequestsTable.description,
        scheduledAt: assistanceRequestsTable.scheduledAt,
        scheduledEndAt: assistanceRequestsTable.scheduledEndAt,
        meetingUrl: assistanceRequestsTable.meetingUrl,
      })
      .from(assistanceRequestsTable)
      .leftJoin(schoolsTable, eq(assistanceRequestsTable.schoolId, schoolsTable.id))
      .where(eq(assistanceRequestsTable.id, requestId))
      .limit(1);

    const request = rows[0];
    if (!request) {
      res.status(404).json({ error: "NotFound", message: "Solicitud no encontrada." });
      return;
    }

    const content = buildIcsContent(request);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${request.requestNumber}.ics"`);
    res.send(content);
  } catch (error) {
    res.status(500).json({ error: "InternalServerError", message: getSafeErrorMessage(error, "No se pudo generar el recordatorio.") });
  }
});

export default router;
