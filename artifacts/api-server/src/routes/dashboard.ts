import { Router } from "express";
import { db } from "@workspace/db";
import { ticketsTable, usersTable, tenantsTable, auditLogsTable, schoolsTable } from "@workspace/db/schema";
import { eq, count, sql, and, gte, lte, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";
import { parseDbJson } from "../lib/db-json.js";

const router = Router();

function jsonString(path: string) {
  return sql<string>`NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(${ticketsTable.customFields}, ${path})), ''), 'null')`;
}

function parseDashboardFilters(req: any) {
  const tenantId = req.query["tenantId"] ? Number(req.query["tenantId"]) : undefined;
  const schoolId = req.query["schoolId"] ? Number(req.query["schoolId"]) : undefined;
  const dateFrom = req.query["dateFrom"] as string | undefined;
  const dateTo = req.query["dateTo"] as string | undefined;

  return { tenantId, schoolId, dateFrom, dateTo };
}

function buildTicketConditions(
  filters: { tenantId?: number; schoolId?: number; dateFrom?: string; dateTo?: string },
  authUser: any,
) {
  const conditions: any[] = [];

  if (authUser.role !== "superadmin" && authUser.role !== "tecnico") {
    if (authUser.scopeType === "school" && authUser.schoolId) {
      conditions.push(eq(ticketsTable.schoolId, authUser.schoolId));
    } else if (authUser.tenantId) {
      conditions.push(eq(ticketsTable.tenantId, authUser.tenantId));
      if (filters.schoolId) conditions.push(eq(ticketsTable.schoolId, filters.schoolId));
    }
  } else {
    if (filters.tenantId) conditions.push(eq(ticketsTable.tenantId, filters.tenantId));
    if (filters.schoolId) conditions.push(eq(ticketsTable.schoolId, filters.schoolId));
  }

  if (filters.dateFrom) {
    conditions.push(gte(ticketsTable.createdAt, new Date(filters.dateFrom)));
  }

  if (filters.dateTo) {
    const end = new Date(filters.dateTo);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(ticketsTable.createdAt, end));
  }

  return conditions;
}

function buildSchoolLabelExpression() {
  const mochilaType = sql<string>`LOWER(COALESCE(${jsonString("$.mochilaLookup.records[0].type")}, ''))`;
  const mochilaSchoolName = jsonString("$.mochilaLookup.records[0].schoolName");
  const importedSchool = jsonString("$.importedSchool");
  const school = jsonString("$.school");

  return sql<string>`
    COALESCE(
      CASE
        WHEN ${mochilaType} IN ('mochila', 'mochila_blink')
        THEN ${mochilaSchoolName}
        ELSE NULL
      END,
      ${importedSchool},
      ${school},
      ${schoolsTable.name},
      ${tenantsTable.name},
      'Sin colegio'
    )
  `;
}

router.get("/stats", requireAuth, requireRole("superadmin", "admin_cliente", "manager", "tecnico", "visor_cliente"), async (req, res) => {
  const authUser = (req as any).user;
  const filters = parseDashboardFilters(req);
  const conditions = buildTicketConditions(filters, authUser);
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const schoolLabel = buildSchoolLabelExpression();

  const [
    totalResult,
    newResult,
    openResult,
    resolvedResult,
    closedResult,
    pendingResult,
    urgentResult,
    resolvedWithTimeResult,
    schoolsResult,
    usersResult,
    techResult,
  ] = await Promise.all([
    db.select({ count: count() }).from(ticketsTable).where(where),
    db.select({ count: count() }).from(ticketsTable).where(and(where, eq(ticketsTable.status, "nuevo"))),
    db.select({ count: count() }).from(ticketsTable).where(and(where, sql`${ticketsTable.status} NOT IN ('resuelto', 'cerrado')`)),
    db.select({ count: count() }).from(ticketsTable).where(and(where, eq(ticketsTable.status, "resuelto"))),
    db.select({ count: count() }).from(ticketsTable).where(and(where, eq(ticketsTable.status, "cerrado"))),
    db.select({ count: count() }).from(ticketsTable).where(and(where, eq(ticketsTable.status, "pendiente"))),
    db.select({ count: count() }).from(ticketsTable).where(and(where, eq(ticketsTable.priority, "urgente"))),
    db
      .select({ avgHours: sql<number>`AVG(TIMESTAMPDIFF(SECOND, ${ticketsTable.createdAt}, ${ticketsTable.resolvedAt}) / 3600.0)` })
      .from(ticketsTable)
      .where(and(where, sql`${ticketsTable.resolvedAt} IS NOT NULL`)),
    db
      .select({ schoolName: schoolLabel })
      .from(ticketsTable)
      .leftJoin(schoolsTable, eq(ticketsTable.schoolId, schoolsTable.id))
      .leftJoin(tenantsTable, eq(ticketsTable.tenantId, tenantsTable.id))
      .where(where)
      .groupBy(schoolLabel),
    db.select({ count: count() }).from(usersTable),
    db.select({ count: count() }).from(usersTable).where(eq(usersTable.role, "tecnico")),
  ]);

  res.json({
    totalTickets: Number(totalResult[0]?.count ?? 0),
    newTickets: Number(newResult[0]?.count ?? 0),
    openTickets: Number(openResult[0]?.count ?? 0),
    resolvedTickets: Number(resolvedResult[0]?.count ?? 0),
    closedTickets: Number(closedResult[0]?.count ?? 0),
    pendingTickets: Number(pendingResult[0]?.count ?? 0),
    urgentTickets: Number(urgentResult[0]?.count ?? 0),
    avgResolutionHours: resolvedWithTimeResult[0]?.avgHours ?? null,
    totalSchools: schoolsResult.length,
    totalUsers: Number(usersResult[0]?.count ?? 0),
    totalTechnicians: Number(techResult[0]?.count ?? 0),
  });
});

router.get("/tickets-by-status", requireAuth, requireRole("superadmin", "admin_cliente", "manager", "tecnico", "visor_cliente"), async (req, res) => {
  const authUser = (req as any).user;
  const filters = parseDashboardFilters(req);
  const conditions = buildTicketConditions(filters, authUser);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db.select({ status: ticketsTable.status, count: count() }).from(ticketsTable).where(where).groupBy(ticketsTable.status);

  const statusLabels: Record<string, string> = {
    nuevo: "Nuevo",
    pendiente: "Pendiente",
    en_revision: "En Revision",
    en_proceso: "En Proceso",
    esperando_cliente: "Esperando Cliente",
    resuelto: "Resuelto",
    cerrado: "Cerrado",
  };

  res.json(result.map((r) => ({ status: r.status, count: Number(r.count), label: statusLabels[r.status] ?? r.status })));
});

router.get("/tickets-by-priority", requireAuth, requireRole("superadmin", "admin_cliente", "manager", "tecnico", "visor_cliente"), async (req, res) => {
  const authUser = (req as any).user;
  const filters = parseDashboardFilters(req);
  const conditions = buildTicketConditions(filters, authUser);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db.select({ priority: ticketsTable.priority, count: count() }).from(ticketsTable).where(where).groupBy(ticketsTable.priority);

  const priorityLabels: Record<string, string> = {
    baja: "Baja",
    media: "Media",
    alta: "Alta",
    urgente: "Urgente",
  };

  res.json(result.map((r) => ({ priority: r.priority, count: Number(r.count), label: priorityLabels[r.priority] ?? r.priority })));
});

router.get("/tickets-over-time", requireAuth, requireRole("superadmin", "admin_cliente", "manager", "tecnico", "visor_cliente"), async (req, res) => {
  const authUser = (req as any).user;
  const filters = parseDashboardFilters(req);
  const period = (req.query["period"] as string) || "month";
  const conditions = buildTicketConditions(filters, authUser);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const bucket = period === "day"
    ? sql<string>`DATE_FORMAT(${ticketsTable.createdAt}, '%Y-%m-%d')`
    : period === "week"
      ? sql<string>`DATE_FORMAT(${ticketsTable.createdAt}, '%x-W%v')`
      : sql<string>`DATE_FORMAT(${ticketsTable.createdAt}, '%Y-%m')`;

  const resolvedBucket = period === "day"
    ? sql<string>`DATE_FORMAT(${ticketsTable.resolvedAt}, '%Y-%m-%d')`
    : period === "week"
      ? sql<string>`DATE_FORMAT(${ticketsTable.resolvedAt}, '%x-W%v')`
      : sql<string>`DATE_FORMAT(${ticketsTable.resolvedAt}, '%Y-%m')`;

  const created = await db
    .select({ date: bucket, count: count() })
    .from(ticketsTable)
    .where(where)
    .groupBy(bucket)
    .orderBy(bucket);

  const resolved = await db
    .select({ date: resolvedBucket, count: count() })
    .from(ticketsTable)
    .where(and(where, sql`${ticketsTable.resolvedAt} IS NOT NULL`))
    .groupBy(resolvedBucket)
    .orderBy(resolvedBucket);

  const resolvedMap = new Map(resolved.map((r) => [String(r.date), Number(r.count)]));

  res.json(created.map((c) => ({ date: String(c.date), created: Number(c.count), resolved: resolvedMap.get(String(c.date)) ?? 0 })));
});

router.get("/tickets-by-technician", requireAuth, requireRole("superadmin", "admin_cliente", "manager", "tecnico", "visor_cliente"), async (req, res) => {
  const authUser = (req as any).user;
  const filters = parseDashboardFilters(req);
  const conditions = buildTicketConditions(filters, authUser);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db
    .select({
      userId: ticketsTable.assignedToId,
      userName: usersTable.name,
      count: count(),
      resolved: sql<number>`COUNT(CASE WHEN ${ticketsTable.status} = 'resuelto' THEN 1 END)`,
    })
    .from(ticketsTable)
    .leftJoin(usersTable, eq(ticketsTable.assignedToId, usersTable.id))
    .where(and(where, sql`${ticketsTable.assignedToId} IS NOT NULL`))
    .groupBy(ticketsTable.assignedToId, usersTable.name)
    .orderBy(desc(count()));

  res.json(result.map((r) => ({ userId: r.userId ?? 0, userName: r.userName ?? "Sin asignar", count: Number(r.count), resolved: Number(r.resolved) })));
});

router.get("/recent-activity", requireAuth, requireRole("superadmin", "admin_cliente", "manager", "tecnico", "visor_cliente"), async (req, res) => {
  const authUser = (req as any).user;
  const filters = parseDashboardFilters(req);
  const limit = Math.min(50, Math.max(1, Number(req.query["limit"]) || 10));

  const conditions: any[] = [];
  if (authUser.role !== "superadmin" && authUser.role !== "tecnico") {
    if (authUser.tenantId) conditions.push(eq(auditLogsTable.tenantId, authUser.tenantId));
  } else if (filters.tenantId) {
    conditions.push(eq(auditLogsTable.tenantId, filters.tenantId));
  }
  if (filters.dateFrom) {
    conditions.push(gte(auditLogsTable.createdAt, new Date(filters.dateFrom)));
  }
  if (filters.dateTo) {
    const end = new Date(filters.dateTo);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(auditLogsTable.createdAt, end));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const logs = await db
    .select({
      id: auditLogsTable.id,
      action: auditLogsTable.action,
      entityType: auditLogsTable.entityType,
      entityId: auditLogsTable.entityId,
      userId: auditLogsTable.userId,
      userName: usersTable.name,
      tenantName: tenantsTable.name,
      createdAt: auditLogsTable.createdAt,
      newValues: auditLogsTable.newValues,
    })
    .from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
    .leftJoin(tenantsTable, eq(auditLogsTable.tenantId, tenantsTable.id))
    .where(where)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(limit);

  res.json(logs.map((l) => {
    const values = parseDbJson<Record<string, unknown> | null>(l.newValues, null);
    return {
      id: l.id,
      action: l.action,
      entityType: l.entityType,
      entityId: l.entityId,
      entityTitle: values && typeof values === "object" ? (values as any).title ?? null : null,
      userId: l.userId,
      userName: l.userName ?? "Unknown",
      tenantName: l.tenantName ?? null,
      createdAt: l.createdAt,
    };
  }));
});

router.get("/top-categories", requireAuth, requireRole("superadmin", "admin_cliente", "manager", "tecnico", "visor_cliente"), async (req, res) => {
  const authUser = (req as any).user;
  const filters = parseDashboardFilters(req);
  const limit = Math.min(20, Math.max(1, Number(req.query["limit"]) || 5));

  const conditions = buildTicketConditions(filters, authUser);
  conditions.push(sql`${ticketsTable.category} IS NOT NULL`);
  const where = and(...conditions);

  const result = await db
    .select({ category: ticketsTable.category, count: count() })
    .from(ticketsTable)
    .where(where)
    .groupBy(ticketsTable.category)
    .orderBy(desc(count()))
    .limit(limit);

  res.json(result.map((r) => ({ category: r.category ?? "", count: Number(r.count) })));
});

router.get("/tickets-by-school", requireAuth, requireRole("superadmin", "admin_cliente", "manager", "tecnico", "visor_cliente"), async (req, res) => {
  const authUser = (req as any).user;
  const filters = parseDashboardFilters(req);

  const conditions = buildTicketConditions(filters, authUser);
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const schoolLabel = buildSchoolLabelExpression();
  const query = db
    .select({
      schoolName: schoolLabel,
      count: count(),
    })
    .from(ticketsTable)
    .leftJoin(schoolsTable, eq(ticketsTable.schoolId, schoolsTable.id))
    .leftJoin(tenantsTable, eq(ticketsTable.tenantId, tenantsTable.id));

  const result = where
    ? await query.where(where).groupBy(schoolLabel).orderBy(desc(count())).limit(10)
    : await query.groupBy(schoolLabel).orderBy(desc(count())).limit(10);

  res.json(result.map((item) => ({ schoolName: item.schoolName, count: Number(item.count) })));
});

router.get("/tickets-by-inquiry-type", requireAuth, requireRole("superadmin", "admin_cliente", "manager", "tecnico", "visor_cliente"), async (req, res) => {
  const authUser = (req as any).user;
  const filters = parseDashboardFilters(req);

  const conditions = buildTicketConditions(filters, authUser);
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const inquiryType = sql<string>`COALESCE(${jsonString("$.inquiryType")}, NULLIF(${ticketsTable.category}, ''), 'Sin tipo')`;
  const query = db
    .select({
      inquiryType,
      count: count(),
    })
    .from(ticketsTable);

  const result = where
    ? await query.where(where).groupBy(inquiryType).orderBy(desc(count())).limit(8)
    : await query.groupBy(inquiryType).orderBy(desc(count())).limit(8);

  res.json(result.map((item) => ({ inquiryType: item.inquiryType, count: Number(item.count) })));
});

router.get("/tickets-by-stage", requireAuth, requireRole("superadmin", "admin_cliente", "manager", "tecnico", "visor_cliente"), async (req, res) => {
  const authUser = (req as any).user;
  const filters = parseDashboardFilters(req);

  const conditions = buildTicketConditions(filters, authUser);
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const stage = sql<string>`COALESCE(${jsonString("$.stage")}, 'Sin etapa')`;
  const query = db
    .select({
      stage,
      count: count(),
    })
    .from(ticketsTable);

  const result = where
    ? await query.where(where).groupBy(stage).orderBy(desc(count())).limit(8)
    : await query.groupBy(stage).orderBy(desc(count())).limit(8);

  res.json(result.map((item) => ({ stage: item.stage, count: Number(item.count) })));
});

router.get("/tickets-by-school-and-reporter", requireAuth, requireRole("superadmin", "admin_cliente", "manager", "tecnico", "visor_cliente"), async (req, res) => {
  const authUser = (req as any).user;
  const filters = parseDashboardFilters(req);

  const conditions = buildTicketConditions(filters, authUser);
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const schoolName = buildSchoolLabelExpression();
  const reporterName = sql<string>`COALESCE(${jsonString("$.createdByName")}, ${jsonString("$.reporterEmail")}, ${usersTable.name}, 'Sin informador')`;
  const label = sql<string>`CONCAT(${schoolName}, ' - ', ${reporterName})`;
  const query = db
    .select({
      schoolName,
      reporterName,
      label,
      count: count(),
    })
    .from(ticketsTable)
    .leftJoin(schoolsTable, eq(ticketsTable.schoolId, schoolsTable.id))
    .leftJoin(tenantsTable, eq(ticketsTable.tenantId, tenantsTable.id))
    .leftJoin(usersTable, eq(ticketsTable.createdById, usersTable.id));

  const result = where
    ? await query.where(where).groupBy(schoolName, reporterName, label).orderBy(desc(count())).limit(10)
    : await query.groupBy(schoolName, reporterName, label).orderBy(desc(count())).limit(10);

  res.json(result.map((item) => ({
    schoolName: item.schoolName,
    reporterName: item.reporterName,
    label: item.label,
    count: Number(item.count),
  })));
});

router.get("/resolution-by-school", requireAuth, requireRole("superadmin", "admin_cliente", "manager", "tecnico", "visor_cliente"), async (req, res) => {
  const authUser = (req as any).user;
  const filters = parseDashboardFilters(req);

  const conditions = buildTicketConditions(filters, authUser);
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const schoolName = buildSchoolLabelExpression();
  const resolvedCondition = sql`${ticketsTable.resolvedAt} IS NOT NULL`;
  const query = db
    .select({
      schoolName,
      avgHours: sql<number>`AVG(TIMESTAMPDIFF(SECOND, ${ticketsTable.createdAt}, ${ticketsTable.resolvedAt}) / 3600.0)`,
      count: count(),
    })
    .from(ticketsTable)
    .leftJoin(schoolsTable, eq(ticketsTable.schoolId, schoolsTable.id))
    .leftJoin(tenantsTable, eq(ticketsTable.tenantId, tenantsTable.id));

  const result = where
    ? await query.where(and(where, resolvedCondition)).groupBy(schoolName).orderBy(desc(count())).limit(8)
    : await query.where(resolvedCondition).groupBy(schoolName).orderBy(desc(count())).limit(8);

  res.json(result.map((item) => ({
    schoolName: item.schoolName,
    avgHours: item.avgHours ? Number(item.avgHours) : 0,
    count: Number(item.count),
  })));
});

export default router;
