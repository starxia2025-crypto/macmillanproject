import { Router } from "express";
import { db } from "@workspace/db";
import { ticketsTable, usersTable, tenantsTable, auditLogsTable } from "@workspace/db/schema";
import { eq, count, sql, and, gte, lte, desc, ne } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

function buildTenantCondition(tenantId: number | null | undefined, authUser: any) {
  if (authUser.role !== "superadmin" && authUser.role !== "tecnico") {
    return authUser.tenantId ? eq(ticketsTable.tenantId, authUser.tenantId) : undefined;
  }
  if (tenantId) return eq(ticketsTable.tenantId, tenantId);
  return undefined;
}

router.get("/stats", requireAuth, async (req, res) => {
  const authUser = (req as any).user;
  const tenantId = req.query["tenantId"] ? Number(req.query["tenantId"]) : undefined;
  const dateFrom = req.query["dateFrom"] as string | undefined;
  const dateTo = req.query["dateTo"] as string | undefined;

  const conditions: any[] = [];
  const tc = buildTenantCondition(tenantId, authUser);
  if (tc) conditions.push(tc);
  if (dateFrom) conditions.push(gte(ticketsTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(ticketsTable.createdAt, end));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [
    totalResult,
    newResult,
    openResult,
    resolvedResult,
    closedResult,
    pendingResult,
    urgentResult,
    resolvedWithTimeResult,
    tenantsResult,
    usersResult,
    techResult,
  ] = await Promise.all([
    db.select({ count: count() }).from(ticketsTable).where(where),
    db.select({ count: count() }).from(ticketsTable).where(and(where, eq(ticketsTable.status, "nuevo"))),
    db.select({ count: count() }).from(ticketsTable).where(
      and(where, sql`${ticketsTable.status} NOT IN ('resuelto', 'cerrado')`)
    ),
    db.select({ count: count() }).from(ticketsTable).where(and(where, eq(ticketsTable.status, "resuelto"))),
    db.select({ count: count() }).from(ticketsTable).where(and(where, eq(ticketsTable.status, "cerrado"))),
    db.select({ count: count() }).from(ticketsTable).where(and(where, eq(ticketsTable.status, "pendiente"))),
    db.select({ count: count() }).from(ticketsTable).where(and(where, eq(ticketsTable.priority, "urgente"))),
    db
      .select({ avgMs: sql<number>`AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600)` })
      .from(ticketsTable)
      .where(and(where, sql`${ticketsTable.resolvedAt} IS NOT NULL`)),
    db.select({ count: count() }).from(tenantsTable),
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
    avgResolutionHours: resolvedWithTimeResult[0]?.avgMs ?? null,
    totalTenants: Number(tenantsResult[0]?.count ?? 0),
    totalUsers: Number(usersResult[0]?.count ?? 0),
    totalTechnicians: Number(techResult[0]?.count ?? 0),
  });
});

router.get("/tickets-by-status", requireAuth, async (req, res) => {
  const authUser = (req as any).user;
  const tenantId = req.query["tenantId"] ? Number(req.query["tenantId"]) : undefined;

  const tc = buildTenantCondition(tenantId, authUser);
  const conditions = tc ? [tc] : [];
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db
    .select({ status: ticketsTable.status, count: count() })
    .from(ticketsTable)
    .where(where)
    .groupBy(ticketsTable.status);

  const statusLabels: Record<string, string> = {
    nuevo: "Nuevo",
    pendiente: "Pendiente",
    en_revision: "En Revisión",
    en_proceso: "En Proceso",
    esperando_cliente: "Esperando Cliente",
    resuelto: "Resuelto",
    cerrado: "Cerrado",
  };

  res.json(result.map((r) => ({
    status: r.status,
    count: Number(r.count),
    label: statusLabels[r.status] ?? r.status,
  })));
});

router.get("/tickets-by-priority", requireAuth, async (req, res) => {
  const authUser = (req as any).user;
  const tenantId = req.query["tenantId"] ? Number(req.query["tenantId"]) : undefined;

  const tc = buildTenantCondition(tenantId, authUser);
  const conditions = tc ? [tc] : [];
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db
    .select({ priority: ticketsTable.priority, count: count() })
    .from(ticketsTable)
    .where(where)
    .groupBy(ticketsTable.priority);

  const priorityLabels: Record<string, string> = {
    baja: "Baja",
    media: "Media",
    alta: "Alta",
    urgente: "Urgente",
  };

  res.json(result.map((r) => ({
    priority: r.priority,
    count: Number(r.count),
    label: priorityLabels[r.priority] ?? r.priority,
  })));
});

router.get("/tickets-over-time", requireAuth, async (req, res) => {
  const authUser = (req as any).user;
  const tenantId = req.query["tenantId"] ? Number(req.query["tenantId"]) : undefined;
  const period = (req.query["period"] as string) || "month";
  const dateFrom = req.query["dateFrom"] as string | undefined;
  const dateTo = req.query["dateTo"] as string | undefined;

  const tc = buildTenantCondition(tenantId, authUser);
  const conditions: any[] = tc ? [tc] : [];
  if (dateFrom) conditions.push(gte(ticketsTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(ticketsTable.createdAt, end));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const truncFormat = period === "day" ? "day" : period === "week" ? "week" : "month";

  const created = await db
    .select({
      date: sql<string>`DATE_TRUNC('${sql.raw(truncFormat)}', created_at)::date`,
      count: count(),
    })
    .from(ticketsTable)
    .where(where)
    .groupBy(sql`DATE_TRUNC('${sql.raw(truncFormat)}', created_at)`)
    .orderBy(sql`DATE_TRUNC('${sql.raw(truncFormat)}', created_at)`);

  const resolved = await db
    .select({
      date: sql<string>`DATE_TRUNC('${sql.raw(truncFormat)}', resolved_at)::date`,
      count: count(),
    })
    .from(ticketsTable)
    .where(and(where, sql`resolved_at IS NOT NULL`))
    .groupBy(sql`DATE_TRUNC('${sql.raw(truncFormat)}', resolved_at)`)
    .orderBy(sql`DATE_TRUNC('${sql.raw(truncFormat)}', resolved_at)`);

  const resolvedMap = new Map(resolved.map((r) => [String(r.date), Number(r.count)]));

  res.json(
    created.map((c) => ({
      date: String(c.date),
      created: Number(c.count),
      resolved: resolvedMap.get(String(c.date)) ?? 0,
    }))
  );
});

router.get("/tickets-by-technician", requireAuth, async (req, res) => {
  const authUser = (req as any).user;
  const tenantId = req.query["tenantId"] ? Number(req.query["tenantId"]) : undefined;

  const tc = buildTenantCondition(tenantId, authUser);
  const conditions: any[] = tc ? [tc] : [];
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

  res.json(result.map((r) => ({
    userId: r.userId ?? 0,
    userName: r.userName ?? "Sin asignar",
    count: Number(r.count),
    resolved: Number(r.resolved),
  })));
});

router.get("/recent-activity", requireAuth, async (req, res) => {
  const authUser = (req as any).user;
  const tenantId = req.query["tenantId"] ? Number(req.query["tenantId"]) : undefined;
  const limit = Math.min(50, Math.max(1, Number(req.query["limit"]) || 10));

  const conditions: any[] = [];
  if (authUser.role !== "superadmin" && authUser.role !== "tecnico") {
    if (authUser.tenantId) conditions.push(eq(auditLogsTable.tenantId, authUser.tenantId));
  } else if (tenantId) {
    conditions.push(eq(auditLogsTable.tenantId, tenantId));
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

  res.json(
    logs.map((l) => ({
      id: l.id,
      action: l.action,
      entityType: l.entityType,
      entityId: l.entityId,
      entityTitle: (l.newValues as any)?.title ?? null,
      userId: l.userId,
      userName: l.userName ?? "Unknown",
      tenantName: l.tenantName ?? null,
      createdAt: l.createdAt,
    }))
  );
});

router.get("/top-categories", requireAuth, async (req, res) => {
  const authUser = (req as any).user;
  const tenantId = req.query["tenantId"] ? Number(req.query["tenantId"]) : undefined;
  const limit = Math.min(20, Math.max(1, Number(req.query["limit"]) || 5));

  const tc = buildTenantCondition(tenantId, authUser);
  const conditions: any[] = tc ? [tc] : [];
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

export default router;
