import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { auditLogsTable, commentsTable, schoolsTable, tenantsTable, ticketsTable, usersTable } from "@workspace/db/schema";
import { eq, and, count, desc, gte, lte, sql, or } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import { parseDbJson, stringifyDbJson } from "../lib/db-json.js";
import { containsInsensitive } from "../lib/db-search.js";
import { findMochilasStudentByEmail, findMochilasStudentByOrderId } from "../lib/mochilas.js";
import { sendTicketResolvedEmail } from "../lib/ticket-resolution-email-graph.js";

const router = Router();

const ticketStatuses = ["nuevo", "pendiente", "en_revision", "en_proceso", "esperando_cliente", "resuelto", "cerrado"] as const;
const ticketPriorities = ["baja", "media", "alta", "urgente"] as const;

const createTicketSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(10),
  priority: z.enum(ticketPriorities).default("media"),
  category: z.string().nullable().optional(),
  tenantId: z.number(),
  schoolId: z.number().nullable().optional(),
  customFields: z.record(z.unknown()).nullable().optional(),
});

const updateTicketSchema = z.object({
  title: z.string().min(3).optional(),
  description: z.string().optional(),
  priority: z.enum(ticketPriorities).optional(),
  category: z.string().nullable().optional(),
  schoolId: z.number().nullable().optional(),
  customFields: z.record(z.unknown()).nullable().optional(),
});

const assignTicketSchema = z.object({
  userId: z.number().nullable(),
});

const changeStatusSchema = z.object({
  status: z.enum(ticketStatuses),
  comment: z.string().nullable().optional(),
});

const mochilaStudentLookupSchema = z.object({
  email: z.string().email(),
  tenantId: z.coerce.number().optional(),
});

const mochilaOrderLookupSchema = z.object({
  orderId: z.string().trim().min(1),
  tenantId: z.coerce.number().optional(),
});

const bulkImportRowSchema = z.object({
  red_educativa: z.string().trim().optional().default(""),
  colegio: z.string().trim().min(1),
  email_informador: z.string().trim().email(),
  tipo_sujeto: z.enum(["alumno", "docente", "sobre_mi_cuenta"]),
  email_afectado: z.string().trim().min(1),
  prioridad: z.enum(ticketPriorities),
  estado: z.enum(ticketStatuses),
  tipo_consulta: z.string().trim().min(1),
  descripcion: z.string().trim().min(3),
  pedido: z.string().trim().optional().default(""),
  matricula: z.string().trim().optional().default(""),
  etapa: z.string().trim().optional().default(""),
  curso: z.string().trim().optional().default(""),
  asignatura: z.string().trim().optional().default(""),
  observaciones: z.string().trim().optional().default(""),
});

const bulkImportPayloadSchema = z.object({
  rows: z.array(bulkImportRowSchema).min(1),
});

function normalizeSchoolName(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeImportLookupValue(value: string | null | undefined) {
  return normalizeSchoolName(value);
}

function fixMojibake(value: string) {
  let next = value;

  if (/[ÃÂâ]/.test(next)) {
    try {
      next = Buffer.from(next, "latin1").toString("utf8");
    } catch {
      next = value;
    }
  }

  return next;
}

function cleanImportedText(value: string | null | undefined) {
  const normalized = fixMojibake((value ?? "").trim());

  const replacements: Array<[RegExp, string]> = [
    [/activaci\?n/gi, "activación"],
    [/informaci\?n/gi, "información"],
    [/resoluci\?n/gi, "resolución"],
    [/educaci\?n/gi, "educación"],
    [/aplicaci\?n/gi, "aplicación"],
    [/descripci\?n/gi, "descripción"],
    [/asignaci\?n/gi, "asignación"],
    [/gesti\?n/gi, "gestión"],
    [/sesi\?n/gi, "sesión"],
    [/versi\?n/gi, "versión"],
    [/revisi\?n/gi, "revisión"],
    [/categori\?a/gi, "categoría"],
    [/matr[i?]cula/gi, "matrícula"],
    [/contrase\?a/gi, "contraseña"],
    [/espa\?ol/gi, "español"],
    [/atenci\?n/gi, "atención"],
    [/soluci\?n/gi, "solución"],
    [/manana/gi, "mañana"],
    [/Ã¡/g, "á"],
    [/Ã©/g, "é"],
    [/Ã­/g, "í"],
    [/Ã³/g, "ó"],
    [/Ãº/g, "ú"],
    [/Ã±/g, "ñ"],
    [/Âº/g, "º"],
    [/Â·/g, "·"],
  ];

  return replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), normalized);
}

function buildImportedTicketTitle(row: z.infer<typeof bulkImportRowSchema>) {
  const school = cleanImportedText(row.colegio);
  const inquiry = cleanImportedText(row.tipo_consulta);
  return `${school} - ${inquiry}`;
}

async function resolveImportReporterId(email: string, fallbackUserId: number) {
  const users = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  return users[0]?.id ?? fallbackUserId;
}

async function resolveImportTenantAndSchool(
  rowSchool: string,
  rowTenantName: string | null | undefined,
  authUser: any,
): Promise<{ tenantId: number; schoolId: number | null; schoolLabel: string }> {
  const normalizedRowSchool = normalizeImportLookupValue(rowSchool);
  const normalizedTenantName = normalizeImportLookupValue(rowTenantName);

  if (!normalizedRowSchool) {
    throw new Error("La columna colegio es obligatoria en cada fila.");
  }

  if (authUser.role !== "superadmin" && authUser.role !== "tecnico") {
    if (!authUser.tenantId) {
      throw new Error("No se pudo determinar la red educativa del usuario que importa.");
    }

    const schools = await db
      .select({
        id: schoolsTable.id,
        name: schoolsTable.name,
        active: schoolsTable.active,
      })
      .from(schoolsTable)
      .where(eq(schoolsTable.tenantId, authUser.tenantId));

    const matchedSchool = schools.find((school) => normalizeImportLookupValue(school.name) === normalizedRowSchool);
    return {
      tenantId: authUser.tenantId,
      schoolId: matchedSchool?.id ?? null,
      schoolLabel: cleanImportedText(matchedSchool?.name ?? rowSchool),
    };
  }

  if (normalizedTenantName) {
    const directTenants = await db
      .select({ id: tenantsTable.id, name: tenantsTable.name })
      .from(tenantsTable);
    const matchedTenant = directTenants.find((tenant) => normalizeImportLookupValue(tenant.name) === normalizedTenantName);
    if (!matchedTenant) {
      throw new Error(`No se pudo relacionar la red educativa "${rowTenantName}" con el sistema.`);
    }

    const schools = await db
      .select({
        id: schoolsTable.id,
        name: schoolsTable.name,
        tenantId: schoolsTable.tenantId,
        active: schoolsTable.active,
      })
      .from(schoolsTable)
      .where(eq(schoolsTable.tenantId, matchedTenant.id));
    const matchedSchool = schools.find((school) => normalizeImportLookupValue(school.name) === normalizedRowSchool);

    return {
      tenantId: matchedTenant.id,
      schoolId: matchedSchool?.id ?? null,
      schoolLabel: cleanImportedText(rowSchool),
    };
  }

  const tenants = await db
    .select({ id: tenantsTable.id, name: tenantsTable.name })
    .from(tenantsTable);
  const directTenant = tenants.find((tenant) => normalizeImportLookupValue(tenant.name) === normalizedRowSchool);
  if (directTenant) {
    return { tenantId: directTenant.id, schoolId: null, schoolLabel: directTenant.name };
  }

  const schools = await db
    .select({
      id: schoolsTable.id,
      name: schoolsTable.name,
      tenantId: schoolsTable.tenantId,
      active: schoolsTable.active,
    })
    .from(schoolsTable);
  const matchedSchool = schools.find((school) => normalizeImportLookupValue(school.name) === normalizedRowSchool);
  if (matchedSchool) {
    return { tenantId: matchedSchool.tenantId, schoolId: matchedSchool.id, schoolLabel: matchedSchool.name };
  }

  throw new Error(`No se pudo relacionar el colegio o red educativa "${rowSchool}" con el sistema.`);
}

function doesMochilaSchoolBelongToTenant(mochilaSchoolName: string | null | undefined, tenantSchoolNames: string[]) {
  const normalizedMochila = normalizeSchoolName(mochilaSchoolName);
  if (!normalizedMochila) return false;

  return tenantSchoolNames.some((schoolName) => {
    const normalizedTenantSchool = normalizeSchoolName(schoolName);
    return (
      normalizedTenantSchool === normalizedMochila ||
      normalizedTenantSchool.includes(normalizedMochila) ||
      normalizedMochila.includes(normalizedTenantSchool)
    );
  });
}

function collectSchoolNamesFromCustomFields(customFields: Record<string, unknown> | null | undefined) {
  const candidates: string[] = [];

  if (typeof customFields?.["school"] === "string") {
    candidates.push(customFields["school"]);
  }

  const mochilaLookup = customFields?.["mochilaLookup"];
  if (mochilaLookup && typeof mochilaLookup === "object") {
    const lookup = mochilaLookup as Record<string, unknown>;
    if (Array.isArray(lookup["schools"])) {
      candidates.push(...lookup["schools"].filter((school): school is string => typeof school === "string"));
    }

    if (Array.isArray(lookup["records"])) {
      for (const record of lookup["records"]) {
        if (record && typeof record === "object") {
          const schoolName = (record as Record<string, unknown>)["schoolName"];
          if (typeof schoolName === "string") candidates.push(schoolName);
        }
      }
    }
  }

  return [...new Set(candidates.map((school) => school.trim()).filter(Boolean))];
}

async function resolveTicketSchoolFromCustomFields(tenantId: number, customFields: Record<string, unknown> | null | undefined) {
  const requestedSchoolNames = collectSchoolNamesFromCustomFields(customFields);
  if (!requestedSchoolNames.length) return null;

  const tenantSchools = await db
    .select({ id: schoolsTable.id, name: schoolsTable.name })
    .from(schoolsTable)
    .where(and(eq(schoolsTable.tenantId, tenantId), eq(schoolsTable.active, true)));

  for (const requestedSchoolName of requestedSchoolNames) {
    const normalizedRequested = normalizeSchoolName(requestedSchoolName);
    const matchedSchool = tenantSchools.find((school) => {
      const normalizedSchool = normalizeSchoolName(school.name);
      return (
        normalizedSchool === normalizedRequested ||
        (normalizedSchool.length > 4 && normalizedRequested.includes(normalizedSchool)) ||
        (normalizedRequested.length > 4 && normalizedSchool.includes(normalizedRequested))
      );
    });

    if (matchedSchool) return matchedSchool.id;
  }

  return null;
}

async function filterMochilasResultByTenantSchools(
  tenantId: number,
  mochilaResult: Awaited<ReturnType<typeof findMochilasStudentByEmail>>
) {
  if (!mochilaResult) return null;

  const tenantSchools = await db
    .select({ name: schoolsTable.name })
    .from(schoolsTable)
    .where(and(eq(schoolsTable.tenantId, tenantId), eq(schoolsTable.active, true)));

  const tenantSchoolNames = tenantSchools.map((school) => school.name);
  if (!tenantSchoolNames.length) {
    return null;
  }

  const allowedRecords = mochilaResult.records.filter((record) =>
    doesMochilaSchoolBelongToTenant(record.schoolName, tenantSchoolNames)
  );

  if (!allowedRecords.length) {
    return null;
  }

  return {
    ...mochilaResult,
    schools: [...new Set(allowedRecords.map((record) => record.schoolName).filter(Boolean) as string[])],
    records: allowedRecords,
  };
}

function filterMochilasResultByAllowedTypes(
  mochilaResult: Awaited<ReturnType<typeof findMochilasStudentByEmail>>,
  allowedTypes: string[]
) {
  if (!mochilaResult) return null;

  const normalizedAllowedTypes = allowedTypes.map((type) => type.toLowerCase());
  const allowedRecords = mochilaResult.records.filter((record) =>
    normalizedAllowedTypes.includes((record.type ?? "").trim().toLowerCase())
  );

  if (!allowedRecords.length) {
    return null;
  }

  return {
    ...mochilaResult,
    schools: [...new Set(allowedRecords.map((record) => record.schoolName).filter(Boolean) as string[])],
    records: allowedRecords,
  };
}

function generateTicketNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `TKT-${timestamp}-${random}`;
}

function parseCustomFields(value: unknown) {
  return parseDbJson<Record<string, unknown> | null>(value, null);
}

function normalizeTicket<T extends { customFields?: unknown }>(ticket: T) {
  return {
    ...ticket,
    customFields: parseCustomFields(ticket.customFields),
  };
}

function getTicketVisibilityConditions(authUser: any) {
  const conditions: any[] = [];

  if (authUser.scopeType === "school" && authUser.schoolId) {
    conditions.push(eq(ticketsTable.schoolId, authUser.schoolId));
  } else if (authUser.scopeType === "tenant" && authUser.tenantId) {
    conditions.push(eq(ticketsTable.tenantId, authUser.tenantId));
  } else if (authUser.role !== "superadmin" && authUser.role !== "tecnico" && authUser.tenantId) {
    conditions.push(eq(ticketsTable.tenantId, authUser.tenantId));
  }

  return conditions;
}

function canUserAccessTicket(ticket: { tenantId: number; schoolId?: number | null; customFields?: unknown }, authUser: any) {
  const customFields = parseCustomFields((ticket as any).customFields);
  const isImportedBulkTicket = Boolean(customFields?.importedFromBulk);
  if (authUser.role === "superadmin" || authUser.role === "tecnico") {
    return true;
  }

  if (authUser.scopeType === "school") {
    if (["visor_cliente", "admin_cliente", "manager"].includes(authUser.role)) {
      return !!authUser.tenantId && ticket.tenantId === authUser.tenantId;
    }

    if (isImportedBulkTicket && !!authUser.tenantId && ticket.tenantId === authUser.tenantId) {
      return true;
    }

    if (authUser.schoolId && ticket.schoolId === authUser.schoolId) {
      return true;
    }

    // Si el usuario tiene alcance de colegio pero no tiene schoolId
    // (caso de historicos/importaciones antiguas), hacemos fallback a
    // la red educativa completa, igual que ya hace el listado.
    if (!authUser.schoolId) {
      return !!authUser.tenantId && ticket.tenantId === authUser.tenantId;
    }

    // Permite abrir historicos importados a nivel de red educativa
    // cuando el usuario pertenece a esa misma red pero el ticket no
    // quedo asociado a un colegio concreto.
    return !ticket.schoolId && !!authUser.tenantId && ticket.tenantId === authUser.tenantId;
  }

  if (authUser.scopeType === "tenant") {
    return !!authUser.tenantId && ticket.tenantId === authUser.tenantId;
  }
  return !!authUser.tenantId && ticket.tenantId === authUser.tenantId;
}

function canManageTicket(ticket: { createdById: number; tenantId: number; schoolId?: number | null }, authUser: any) {
  if (["superadmin", "tecnico", "admin_cliente"].includes(authUser.role)) {
    return canUserAccessTicket(ticket, authUser);
  }

  return authUser.userId === ticket.createdById && canUserAccessTicket(ticket, authUser);
}

function buildTicketConditions(query: Record<string, any>, authUser: any) {
  const conditions: any[] = [];

  conditions.push(...getTicketVisibilityConditions(authUser));

  if ((authUser.role === "superadmin" || authUser.role === "tecnico") && query["tenantId"]) {
    conditions.push(eq(ticketsTable.tenantId, Number(query["tenantId"])));
  }

  if (query["schoolId"]) {
    conditions.push(eq(ticketsTable.schoolId, Number(query["schoolId"])));
  }

  if (query["status"]) conditions.push(eq(ticketsTable.status, query["status"]));
  if (query["priority"]) conditions.push(eq(ticketsTable.priority, query["priority"]));
  if (query["assignedToId"]) conditions.push(eq(ticketsTable.assignedToId, Number(query["assignedToId"])));
  if (query["createdById"]) conditions.push(eq(ticketsTable.createdById, Number(query["createdById"])));
  if (query["category"]) conditions.push(eq(ticketsTable.category, query["category"]));
  if (query["dateFrom"]) conditions.push(gte(ticketsTable.createdAt, new Date(query["dateFrom"])));
  if (query["dateTo"]) {
    const end = new Date(query["dateTo"]);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(ticketsTable.createdAt, end));
  }
  if (query["search"]) {
    conditions.push(
      or(
        containsInsensitive(ticketsTable.title, query["search"]),
        containsInsensitive(ticketsTable.ticketNumber, query["search"])
      )
    );
  }

  return conditions;
}

router.get("/", requireAuth, async (req, res) => {
  const authUser = (req as any).user;
  const page = Math.max(1, Number(req.query["page"]) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query["limit"]) || 20));
  const offset = (page - 1) * limit;

  const conditions = buildTicketConditions(req.query as any, authUser);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [tickets, totalResult] = await Promise.all([
    (
      offset > 0
        ? db
            .select({
              id: ticketsTable.id,
              ticketNumber: ticketsTable.ticketNumber,
              title: ticketsTable.title,
              description: ticketsTable.description,
              status: ticketsTable.status,
              priority: ticketsTable.priority,
              category: ticketsTable.category,
              tenantId: ticketsTable.tenantId,
              tenantName: tenantsTable.name,
              schoolId: ticketsTable.schoolId,
              schoolName: schoolsTable.name,
              createdById: ticketsTable.createdById,
              createdByName: usersTable.name,
              assignedToId: ticketsTable.assignedToId,
              customFields: ticketsTable.customFields,
              createdAt: ticketsTable.createdAt,
              updatedAt: ticketsTable.updatedAt,
              resolvedAt: ticketsTable.resolvedAt,
            })
            .from(ticketsTable)
            .leftJoin(tenantsTable, eq(ticketsTable.tenantId, tenantsTable.id))
            .leftJoin(schoolsTable, eq(ticketsTable.schoolId, schoolsTable.id))
            .leftJoin(usersTable, eq(ticketsTable.createdById, usersTable.id))
            .where(where)
            .orderBy(desc(ticketsTable.createdAt))
            .limit(limit)
            .offset(offset)
        : db
            .select({
              id: ticketsTable.id,
              ticketNumber: ticketsTable.ticketNumber,
              title: ticketsTable.title,
              description: ticketsTable.description,
              status: ticketsTable.status,
              priority: ticketsTable.priority,
              category: ticketsTable.category,
              tenantId: ticketsTable.tenantId,
              tenantName: tenantsTable.name,
              schoolId: ticketsTable.schoolId,
              schoolName: schoolsTable.name,
              createdById: ticketsTable.createdById,
              createdByName: usersTable.name,
              assignedToId: ticketsTable.assignedToId,
              customFields: ticketsTable.customFields,
              createdAt: ticketsTable.createdAt,
              updatedAt: ticketsTable.updatedAt,
              resolvedAt: ticketsTable.resolvedAt,
            })
            .from(ticketsTable)
            .leftJoin(tenantsTable, eq(ticketsTable.tenantId, tenantsTable.id))
            .leftJoin(schoolsTable, eq(ticketsTable.schoolId, schoolsTable.id))
            .leftJoin(usersTable, eq(ticketsTable.createdById, usersTable.id))
            .where(where)
            .orderBy(desc(ticketsTable.createdAt))
            .limit(limit)
    ),
    db.select({ count: count() }).from(ticketsTable).where(where),
  ]);

  const ticketsWithExtra = await Promise.all(
    tickets.map(async (t) => {
      const [commentCount, assignee] = await Promise.all([
        db.select({ count: count() }).from(commentsTable).where(eq(commentsTable.ticketId, t.id)),
        t.assignedToId
          ? db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, t.assignedToId)).limit(1)
          : Promise.resolve([]),
      ]);
      return {
        ...normalizeTicket(t),
        assignedToName: (assignee as any)[0]?.name ?? null,
        commentCount: Number(commentCount[0]?.count ?? 0),
      };
    })
  );

  const total = Number(totalResult[0]?.count ?? 0);
  res.json({ data: ticketsWithExtra, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.post("/", requireAuth, async (req, res) => {
  const authUser = (req as any).user;
  const parsed = createTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: parsed.error.message });
    return;
  }

  const resolvedTenantId =
    authUser.scopeType === "tenant" || authUser.scopeType === "school"
      ? authUser.tenantId
      : parsed.data.tenantId;

  let resolvedSchoolId =
    authUser.scopeType === "school"
      ? authUser.schoolId
      : (parsed.data.schoolId ?? null);

  if (!resolvedTenantId) {
    res.status(400).json({ error: "ValidationError", message: "Selecciona la red educativa del ticket." });
    return;
  }

  if (!resolvedSchoolId) {
    resolvedSchoolId = await resolveTicketSchoolFromCustomFields(resolvedTenantId, parsed.data.customFields ?? null);
  }

  const hasMochilasSchoolLabel =
    ["seguimiento_acceso_mochilas", "modificar_correo", "consulta_educativa"].includes(parsed.data.category ?? "") &&
    collectSchoolNamesFromCustomFields(parsed.data.customFields ?? null).length > 0;

  if (!resolvedSchoolId && !hasMochilasSchoolLabel) {
    res.status(400).json({ error: "ValidationError", message: "Selecciona el colegio al que pertenece el ticket." });
    return;
  }

  if (resolvedSchoolId) {
    const schools = await db
      .select({
        id: schoolsTable.id,
        tenantId: schoolsTable.tenantId,
        name: schoolsTable.name,
        active: schoolsTable.active,
      })
      .from(schoolsTable)
      .where(eq(schoolsTable.id, resolvedSchoolId))
      .limit(1);

    const school = schools[0];
    if (!school || !school.active || school.tenantId !== resolvedTenantId) {
      res.status(400).json({ error: "ValidationError", message: "El colegio seleccionado no es valido para esta red educativa." });
      return;
    }
  }

  if ((authUser.scopeType === "tenant" || authUser.scopeType === "school") && resolvedTenantId !== authUser.tenantId) {
    res.status(403).json({ error: "Forbidden", message: "Cannot create ticket for another tenant" });
    return;
  }

  const ticketNumber = generateTicketNumber();

  await db.insert(ticketsTable).values({
    ticketNumber,
    title: parsed.data.title,
    description: parsed.data.description,
    priority: parsed.data.priority,
    category: parsed.data.category ?? null,
    tenantId: resolvedTenantId,
    schoolId: resolvedSchoolId,
    createdById: authUser.userId,
    customFields: stringifyDbJson(parsed.data.customFields ?? null),
  } as any);

  const tickets = await db
    .select({
      id: ticketsTable.id,
      ticketNumber: ticketsTable.ticketNumber,
      title: ticketsTable.title,
      description: ticketsTable.description,
      status: ticketsTable.status,
      priority: ticketsTable.priority,
      category: ticketsTable.category,
      tenantId: ticketsTable.tenantId,
      tenantName: tenantsTable.name,
      schoolId: ticketsTable.schoolId,
      schoolName: schoolsTable.name,
      createdById: ticketsTable.createdById,
      createdByName: usersTable.name,
      assignedToId: ticketsTable.assignedToId,
      customFields: ticketsTable.customFields,
      createdAt: ticketsTable.createdAt,
      updatedAt: ticketsTable.updatedAt,
      resolvedAt: ticketsTable.resolvedAt,
    })
    .from(ticketsTable)
    .leftJoin(tenantsTable, eq(ticketsTable.tenantId, tenantsTable.id))
    .leftJoin(schoolsTable, eq(ticketsTable.schoolId, schoolsTable.id))
    .leftJoin(usersTable, eq(ticketsTable.createdById, usersTable.id))
    .where(eq(ticketsTable.ticketNumber, ticketNumber))
    .limit(1);

  const ticket = tickets[0];
  if (!ticket) {
    throw new Error("Ticket insert succeeded but could not be reloaded.");
  }

  await createAuditLog({
    action: "create",
    entityType: "ticket",
    entityId: ticket.id,
    userId: authUser.userId,
    tenantId: resolvedTenantId,
    newValues: { title: parsed.data.title, priority: parsed.data.priority, schoolId: resolvedSchoolId },
  });

  res.status(201).json({
    ...normalizeTicket(ticket),
    assignedToName: null,
    commentCount: 0,
  });
});

router.get("/mochilas/student", requireAuth, async (req, res) => {
  const authUser = (req as any).user;
  const parsed = mochilaStudentLookupSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: "Indica un correo de alumno valido." });
    return;
  }

  const tenantId =
    authUser.scopeType === "global"
      ? parsed.data.tenantId
      : authUser.tenantId;

  if (!tenantId) {
    res.status(400).json({ error: "ValidationError", message: "Selecciona primero la red educativa." });
    return;
  }

  const tenants = await db
    .select({
      id: tenantsTable.id,
      name: tenantsTable.name,
      hasMochilasAccess: tenantsTable.hasMochilasAccess,
      hasOrderLookup: tenantsTable.hasOrderLookup,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  const tenant = tenants[0];
  if (!tenant) {
    res.status(404).json({ error: "NotFound", message: "No se encontro la red educativa seleccionada." });
    return;
  }

  if (!tenant.hasMochilasAccess) {
    res.status(400).json({ error: "MochilasDisabled", message: "Mochilas no esta activado para este colegio o red educativa." });
    return;
  }

  try {
    const student = await findMochilasStudentByEmail(parsed.data.email);
    if (!student) {
      res.status(404).json({ error: "NotFound", message: "No se encontro ningun alumno con ese correo en Mochilas." });
      return;
    }

    const typedStudent = tenant.hasOrderLookup
      ? filterMochilasResultByAllowedTypes(student, ["mochila", "mochila_blink"])
      : student;

    if (!typedStudent) {
      res.status(404).json({
        error: "NotFound",
        message: "No se encontro ningun alumno con ese correo en Mochilas.",
      });
      return;
    }

    const canSearchAcrossNetworks = ["visor_cliente", "tecnico", "superadmin"].includes(authUser.role);
    const filteredStudent = canSearchAcrossNetworks
      ? typedStudent
      : typedStudent;
    if (!filteredStudent) {
      res.status(404).json({
        error: "OutsideTenant",
        message: `El alumno no pertenece a ningun centro de la red educativa "${tenant.name}".`,
      });
      return;
    }

    res.json(filteredStudent);
  } catch (error) {
    console.error("Mochilas lookup failed", error);
    res.status(500).json({ error: "InternalServerError", message: "No se pudo consultar la informacion de Mochilas." });
  }
});

router.get("/mochilas/order", requireAuth, async (req, res) => {
  const authUser = (req as any).user;
  const parsed = mochilaOrderLookupSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: "Indica un pedido valido." });
    return;
  }

  const tenantId =
    authUser.scopeType === "global"
      ? parsed.data.tenantId
      : authUser.tenantId;

  if (!tenantId) {
    res.status(400).json({ error: "ValidationError", message: "Selecciona primero la red educativa." });
    return;
  }

  const tenants = await db
    .select({
      id: tenantsTable.id,
      name: tenantsTable.name,
      hasOrderLookup: tenantsTable.hasOrderLookup,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  const tenant = tenants[0];
  if (!tenant) {
    res.status(404).json({ error: "NotFound", message: "No se encontro la red educativa seleccionada." });
    return;
  }

  if (!tenant.hasOrderLookup) {
    res.status(400).json({ error: "OrderLookupDisabled", message: "La busqueda por pedido no esta activada para este colegio o red educativa." });
    return;
  }

  try {
    const student = await findMochilasStudentByOrderId(parsed.data.orderId);
    if (!student) {
      res.status(404).json({ error: "NotFound", message: "Pedido no encontrado. No es mochila, o no ha sido procesado aun." });
      return;
    }

    const typedStudent = filterMochilasResultByAllowedTypes(student, ["mochila", "mochila_blink"]);
    if (!typedStudent) {
      res.status(404).json({ error: "NotFound", message: "Pedido no encontrado. No es mochila, o no ha sido procesado aun." });
      return;
    }

    res.json(typedStudent);
  } catch (error) {
    console.error("Mochilas order lookup failed", error);
    res.status(500).json({ error: "InternalServerError", message: "No se pudo consultar la informacion del pedido en Mochilas." });
  }
});

router.post("/import", requireAuth, requireRole("superadmin", "admin_cliente", "manager", "tecnico", "visor_cliente"), async (req, res) => {
  const authUser = (req as any).user;
  const parsed = bulkImportPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: "Revisa el formato del Excel antes de importarlo." });
    return;
  }

  const warnings: string[] = [];
  let createdCount = 0;

  for (let index = 0; index < parsed.data.rows.length; index += 1) {
    const row = parsed.data.rows[index]!;

    try {
      const resolvedScope = await resolveImportTenantAndSchool(row.colegio, row.red_educativa, authUser);
      const createdById = await resolveImportReporterId(row.email_informador, authUser.userId);
      const ticketNumber = generateTicketNumber();
      const now = new Date();
      const isResolved = row.estado === "resuelto" || row.estado === "cerrado";
      const customFields = {
        importedFromBulk: true,
        importedTenantName: cleanImportedText(row.red_educativa) || null,
        importedSchool: cleanImportedText(row.colegio),
        studentEmail: cleanImportedText(row.email_afectado),
        subjectType: row.tipo_sujeto,
        inquiryType: cleanImportedText(row.tipo_consulta),
        orderId: cleanImportedText(row.pedido) || null,
        studentEnrollment: cleanImportedText(row.matricula) || null,
        stage: cleanImportedText(row.etapa) || null,
        course: cleanImportedText(row.curso) || null,
        subject: cleanImportedText(row.asignatura) || null,
        observations: cleanImportedText(row.observaciones) || null,
        importReporterEmail: row.email_informador,
      };

      await db.insert(ticketsTable).values({
        ticketNumber,
        title: buildImportedTicketTitle(row),
        description: cleanImportedText(row.descripcion),
        status: row.estado,
        priority: row.prioridad,
        category: cleanImportedText(row.tipo_consulta),
        tenantId: resolvedScope.tenantId,
        schoolId: resolvedScope.schoolId,
        createdById,
        customFields: stringifyDbJson(customFields),
        resolvedAt: isResolved ? now : null,
      } as any);

      const createdTickets = await db
        .select({ id: ticketsTable.id })
        .from(ticketsTable)
        .where(eq(ticketsTable.ticketNumber, ticketNumber))
        .limit(1);

      const createdTicket = createdTickets[0];
      if (createdTicket) {
        await createAuditLog({
          action: "bulk_import",
          entityType: "ticket",
          entityId: createdTicket.id,
          userId: authUser.userId,
          tenantId: resolvedScope.tenantId,
          newValues: {
            importedBy: authUser.userId,
            reporterEmail: row.email_informador,
            status: row.estado,
            tenant: cleanImportedText(row.red_educativa) || null,
            school: resolvedScope.schoolLabel,
          },
        });
      }

      if (createdById === authUser.userId && row.email_informador.toLowerCase() !== (authUser.email ?? "").toLowerCase()) {
        warnings.push(`Fila ${index + 2}: no exist?a el usuario ${row.email_informador} y se us? la cuenta actual como creadora.`);
      }

      createdCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo importar esta fila.";
      res.status(400).json({
        error: "ImportError",
        message: `La fila ${index + 2} no se pudo importar: ${message}`,
        createdCount,
        warnings,
      });
      return;
    }
  }

  res.status(201).json({
    createdCount,
    warnings,
  });
});

router.get("/:ticketId", requireAuth, async (req, res) => {
  const ticketId = Number(req.params["ticketId"]);
  const authUser = (req as any).user;

  const baseTickets = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1);
  const baseTicket = baseTickets[0];
  if (!baseTicket) {
    res.status(404).json({ error: "NotFound", message: "No se encontro la consulta solicitada." });
    return;
  }

  if (!canUserAccessTicket(baseTicket, authUser)) {
    res.status(403).json({ error: "Forbidden", message: "No tienes permisos para realizar esta accion." });
    return;
  }

  let tenant: Array<{ name: string }> = [];
  let school: Array<{ name: string }> = [];
  let creator: Array<{ name: string }> = [];
  let assignee: Array<{ name: string }> = [];
  let comments: any[] = [];
  let ticketAuditLogs: any[] = [];
  let commentCount: Array<{ count: number | string | bigint }> = [{ count: 0 }];

  try {
    [tenant, school, creator, assignee, comments, ticketAuditLogs, commentCount] = await Promise.all([
      db.select({ name: tenantsTable.name }).from(tenantsTable).where(eq(tenantsTable.id, baseTicket.tenantId)).limit(1),
      baseTicket.schoolId
        ? db.select({ name: schoolsTable.name }).from(schoolsTable).where(eq(schoolsTable.id, baseTicket.schoolId)).limit(1)
        : Promise.resolve([]),
      db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, baseTicket.createdById)).limit(1),
      baseTicket.assignedToId
        ? db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, baseTicket.assignedToId)).limit(1)
        : Promise.resolve([]),
      db
        .select({
          id: commentsTable.id,
          ticketId: commentsTable.ticketId,
          authorId: commentsTable.authorId,
          authorName: usersTable.name,
          authorRole: usersTable.role,
          content: commentsTable.content,
          isInternal: commentsTable.isInternal,
          createdAt: commentsTable.createdAt,
        })
        .from(commentsTable)
        .leftJoin(usersTable, eq(commentsTable.authorId, usersTable.id))
        .where(eq(commentsTable.ticketId, ticketId))
        .orderBy(commentsTable.createdAt),
      db
        .select()
        .from(auditLogsTable)
        .where(and(eq(auditLogsTable.entityType, "ticket"), eq(auditLogsTable.entityId, ticketId)))
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(20),
      db.select({ count: count() }).from(commentsTable).where(eq(commentsTable.ticketId, ticketId)),
    ]);
  } catch (error) {
    console.error("Ticket detail secondary load failed", error);
  }

  const visibleComments = authUser.scopeType === "school" || authUser.role === "usuario_cliente"
    ? comments.filter((c) => !c.isInternal)
    : comments;

  res.json({
    ...normalizeTicket(baseTicket),
    tenantName: tenant[0]?.name ?? "",
    schoolName: school[0]?.name ?? null,
    createdByName: creator[0]?.name ?? "",
    assignedToName: (assignee as any)[0]?.name ?? null,
    commentCount: Number(commentCount[0]?.count ?? 0),
    comments: visibleComments,
    auditLogs: ticketAuditLogs.map((log) => ({
      ...log,
      oldValues: parseDbJson<Record<string, unknown> | null>(log.oldValues, null),
      newValues: parseDbJson<Record<string, unknown> | null>(log.newValues, null),
    })),
  });
});

router.patch("/:ticketId", requireAuth, async (req, res) => {
  const ticketId = Number(req.params["ticketId"]);
  const authUser = (req as any).user;
  const parsed = updateTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: parsed.error.message });
    return;
  }

  const tickets = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1);
  const ticket = tickets[0];
  if (!ticket) {
    res.status(404).json({ error: "NotFound", message: "Ticket not found" });
    return;
  }

  if (!canUserAccessTicket(ticket, authUser)) {
    res.status(403).json({ error: "Forbidden", message: "Access denied" });
    return;
  }

  if (!canManageTicket(ticket, authUser) && authUser.role !== "visor_cliente") {
    res.status(403).json({ error: "Forbidden", message: "You cannot update this ticket" });
    return;
  }

  const updateValues: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.customFields !== undefined) updateValues["customFields"] = stringifyDbJson(parsed.data.customFields);
  if (parsed.data.schoolId !== undefined) updateValues["schoolId"] = parsed.data.schoolId;

  await db
    .update(ticketsTable)
    .set(updateValues as any)
    .where(eq(ticketsTable.id, ticketId));

  const updated = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1);

  await createAuditLog({
    action: "update",
    entityType: "ticket",
    entityId: ticketId,
    userId: authUser.userId,
    tenantId: ticket.tenantId,
    oldValues: { title: ticket.title, priority: ticket.priority },
    newValues: parsed.data,
  });

  const [tenant, creator, assignee, commentCount] = await Promise.all([
    db.select({ name: tenantsTable.name }).from(tenantsTable).where(eq(tenantsTable.id, ticket.tenantId)).limit(1),
    db.select({ name: usersTable.name, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, ticket.createdById)).limit(1),
    updated[0]!.assignedToId
      ? db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, updated[0]!.assignedToId!)).limit(1)
      : Promise.resolve([]),
    db.select({ count: count() }).from(commentsTable).where(eq(commentsTable.ticketId, ticketId)),
  ]);

  res.json({
    ...normalizeTicket(updated[0]),
    tenantName: tenant[0]?.name ?? "",
    createdByName: creator[0]?.name ?? "",
    assignedToName: (assignee as any)[0]?.name ?? null,
    commentCount: Number(commentCount[0]?.count ?? 0),
  });
});

router.post("/:ticketId/assign", requireAuth, requireRole("superadmin", "tecnico", "admin_cliente", "visor_cliente"), async (req, res) => {
  const ticketId = Number(req.params["ticketId"]);
  const authUser = (req as any).user;
  const parsed = assignTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: parsed.error.message });
    return;
  }

  const tickets = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1);
  const ticket = tickets[0];
  if (!ticket) {
    res.status(404).json({ error: "NotFound", message: "Ticket not found" });
    return;
  }

  if (!canUserAccessTicket(ticket, authUser)) {
    res.status(403).json({ error: "Forbidden", message: "Access denied" });
    return;
  }

  await db
    .update(ticketsTable)
    .set({ assignedToId: parsed.data.userId, updatedAt: new Date() })
    .where(eq(ticketsTable.id, ticketId));

  const updated = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1);

  await createAuditLog({
    action: "assign",
    entityType: "ticket",
    entityId: ticketId,
    userId: authUser.userId,
    tenantId: ticket.tenantId,
    oldValues: { assignedToId: ticket.assignedToId },
    newValues: { assignedToId: parsed.data.userId },
  });

  const [tenant, creator, assignee, commentCount] = await Promise.all([
    db.select({ name: tenantsTable.name }).from(tenantsTable).where(eq(tenantsTable.id, ticket.tenantId)).limit(1),
    db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, ticket.createdById)).limit(1),
    parsed.data.userId
      ? db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, parsed.data.userId)).limit(1)
      : Promise.resolve([]),
    db.select({ count: count() }).from(commentsTable).where(eq(commentsTable.ticketId, ticketId)),
  ]);

  res.json({
    ...normalizeTicket(updated[0]),
    tenantName: tenant[0]?.name ?? "",
    createdByName: creator[0]?.name ?? "",
    assignedToName: (assignee as any)[0]?.name ?? null,
    commentCount: Number(commentCount[0]?.count ?? 0),
  });
});

router.post("/:ticketId/status", requireAuth, async (req, res) => {
  const ticketId = Number(req.params["ticketId"]);
  const authUser = (req as any).user;
  const parsed = changeStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: parsed.error.message });
    return;
  }

  const tickets = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1);
  const ticket = tickets[0];
  if (!ticket) {
    res.status(404).json({ error: "NotFound", message: "Ticket not found" });
    return;
  }

  const updateData: Record<string, unknown> = {
    status: parsed.data.status,
    updatedAt: new Date(),
  };

  if (parsed.data.status === "resuelto" && !ticket.resolvedAt) {
    updateData["resolvedAt"] = new Date();
  }

  if (!canUserAccessTicket(ticket, authUser)) {
    res.status(403).json({ error: "Forbidden", message: "Access denied" });
    return;
  }

  await db
    .update(ticketsTable)
    .set(updateData as any)
    .where(eq(ticketsTable.id, ticketId));

  const updated = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1);

  if (parsed.data.comment) {
    await db.insert(commentsTable).values({
      ticketId,
      authorId: authUser.userId,
      content: parsed.data.comment,
      isInternal: false,
    });
  }

  await createAuditLog({
    action: "status_change",
    entityType: "ticket",
    entityId: ticketId,
    userId: authUser.userId,
    tenantId: ticket.tenantId,
    oldValues: { status: ticket.status },
    newValues: { status: parsed.data.status },
  });

  const [tenant, creator, assignee, commentCount] = await Promise.all([
    db.select({ name: tenantsTable.name }).from(tenantsTable).where(eq(tenantsTable.id, ticket.tenantId)).limit(1),
    db.select({ name: usersTable.name, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, ticket.createdById)).limit(1),
    updated[0]!.assignedToId
      ? db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, updated[0]!.assignedToId!)).limit(1)
      : Promise.resolve([]),
    db.select({ count: count() }).from(commentsTable).where(eq(commentsTable.ticketId, ticketId)),
  ]);

  if (ticket.status !== "resuelto" && parsed.data.status === "resuelto") {
    const recipient = process.env["TICKET_RESOLVED_NOTIFY_TO"] || "javier.alexander@macmillaneducation.com";
    sendTicketResolvedEmail({
      recipient,
      ticketNumber: updated[0]!.ticketNumber,
      title: updated[0]!.title,
      description: updated[0]!.description,
      status: updated[0]!.status,
      priority: updated[0]!.priority,
      creatorName: creator[0]?.name ?? null,
      creatorEmail: creator[0]?.email ?? null,
      schoolName: null,
      tenantName: tenant[0]?.name ?? null,
      resolvedByName: assignee[0]?.name ?? authUser.name ?? null,
      resolvedAt: (updateData["resolvedAt"] as Date | undefined) ?? new Date(),
    }).catch((error) => {
      console.error("Send ticket resolved email failed", error);
    });
  }

  res.json({
    ...normalizeTicket(updated[0]),
    tenantName: tenant[0]?.name ?? "",
    createdByName: creator[0]?.name ?? "",
    assignedToName: (assignee as any)[0]?.name ?? null,
    commentCount: Number(commentCount[0]?.count ?? 0),
  });
});

router.get("/:ticketId/comments", requireAuth, async (req, res) => {
  const ticketId = Number(req.params["ticketId"]);
  const authUser = (req as any).user;

  const tickets = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1);
  const ticket = tickets[0];
  if (!ticket) {
    res.status(404).json({ error: "NotFound", message: "Ticket not found" });
    return;
  }

  if (!canUserAccessTicket(ticket, authUser)) {
    res.status(403).json({ error: "Forbidden", message: "Access denied" });
    return;
  }

  const comments = await db
    .select({
      id: commentsTable.id,
      ticketId: commentsTable.ticketId,
      authorId: commentsTable.authorId,
      authorName: usersTable.name,
      authorRole: usersTable.role,
      content: commentsTable.content,
      isInternal: commentsTable.isInternal,
      createdAt: commentsTable.createdAt,
    })
    .from(commentsTable)
    .leftJoin(usersTable, eq(commentsTable.authorId, usersTable.id))
    .where(eq(commentsTable.ticketId, ticketId))
    .orderBy(commentsTable.createdAt);

  const filtered = authUser.scopeType === "school" || authUser.role === "usuario_cliente" ? comments.filter((c) => !c.isInternal) : comments;

  res.json(filtered);
});

router.post("/:ticketId/comments", requireAuth, async (req, res) => {
  const ticketId = Number(req.params["ticketId"]);
  const authUser = (req as any).user;

  const commentSchema = z.object({
    content: z.string().min(1),
    isInternal: z.boolean().default(false),
  });
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: parsed.error.message });
    return;
  }

  const tickets = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1);
  const ticket = tickets[0];
  if (!ticket) {
    res.status(404).json({ error: "NotFound", message: "Ticket not found" });
    return;
  }

  if (!canUserAccessTicket(ticket, authUser)) {
    res.status(403).json({ error: "Forbidden", message: "Access denied" });
    return;
  }

  const isInternal = parsed.data.isInternal && ["superadmin", "tecnico", "admin_cliente", "visor_cliente"].includes(authUser.role);

  await db.insert(commentsTable).values({
    ticketId,
    authorId: authUser.userId,
    content: parsed.data.content,
    isInternal,
  });

  const [comment, author] = await Promise.all([
    db.select().from(commentsTable).where(eq(commentsTable.ticketId, ticketId)).orderBy(desc(commentsTable.id)).limit(1),
    db.select({ name: usersTable.name, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, authUser.userId)).limit(1),
  ]);

  const updateValues: Record<string, unknown> = { updatedAt: new Date() };
  const createdComment = comment[0];
  if (createdComment && !isInternal && authUser.userId !== ticket.createdById) {
    updateValues["customFields"] = stringifyDbJson({
      ...(parseCustomFields(ticket.customFields) ?? {}),
      lastCreatorNotification: {
        type: "comment",
        commentId: createdComment.id,
        authorId: authUser.userId,
        authorName: author[0]?.name ?? "",
        createdAt: createdComment.createdAt,
      },
    });
  }

  await db.update(ticketsTable).set(updateValues as any).where(eq(ticketsTable.id, ticketId));

  res.status(201).json({
    ...createdComment,
    authorName: author[0]?.name ?? "",
    authorRole: author[0]?.role ?? "",
  });
});

export default router;
