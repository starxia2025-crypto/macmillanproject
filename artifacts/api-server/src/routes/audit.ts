import { Router } from "express";
import { db } from "@workspace/db";
import { auditLogsTable, usersTable, tenantsTable } from "@workspace/db/schema";
import { eq, and, count, desc, gte, lte } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";
import { parseDbJson } from "../lib/db-json.js";

const router = Router();

router.get("/", requireAuth, requireRole("superadmin", "admin_cliente", "tecnico"), async (req, res) => {
  const authUser = (req as any).user;
  const page = Math.max(1, Number(req.query["page"]) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query["limit"]) || 20));
  const offset = (page - 1) * limit;

  const entityType = req.query["entityType"] as string | undefined;
  const entityId = req.query["entityId"] ? Number(req.query["entityId"]) : undefined;
  const userId = req.query["userId"] ? Number(req.query["userId"]) : undefined;
  const action = req.query["action"] as string | undefined;
  const dateFrom = req.query["dateFrom"] as string | undefined;
  const dateTo = req.query["dateTo"] as string | undefined;
  let tenantId = req.query["tenantId"] ? Number(req.query["tenantId"]) : undefined;

  // Restrict to own tenant for non-superadmin
  if (authUser.role !== "superadmin") {
    tenantId = authUser.tenantId ?? undefined;
  }

  const conditions: any[] = [];
  if (entityType) conditions.push(eq(auditLogsTable.entityType, entityType));
  if (entityId) conditions.push(eq(auditLogsTable.entityId, entityId));
  if (userId) conditions.push(eq(auditLogsTable.userId, userId));
  if (action) conditions.push(eq(auditLogsTable.action, action));
  if (tenantId) conditions.push(eq(auditLogsTable.tenantId, tenantId));
  if (dateFrom) conditions.push(gte(auditLogsTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(auditLogsTable.createdAt, end));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [logs, totalResult] = await Promise.all([
    (
      offset > 0
        ? db
            .select({
              id: auditLogsTable.id,
              action: auditLogsTable.action,
              entityType: auditLogsTable.entityType,
              entityId: auditLogsTable.entityId,
              userId: auditLogsTable.userId,
              userName: usersTable.name,
              tenantId: auditLogsTable.tenantId,
              oldValues: auditLogsTable.oldValues,
              newValues: auditLogsTable.newValues,
              createdAt: auditLogsTable.createdAt,
            })
            .from(auditLogsTable)
            .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
            .where(where)
            .orderBy(desc(auditLogsTable.createdAt))
            .limit(limit)
            .offset(offset)
        : db
            .select({
              id: auditLogsTable.id,
              action: auditLogsTable.action,
              entityType: auditLogsTable.entityType,
              entityId: auditLogsTable.entityId,
              userId: auditLogsTable.userId,
              userName: usersTable.name,
              tenantId: auditLogsTable.tenantId,
              oldValues: auditLogsTable.oldValues,
              newValues: auditLogsTable.newValues,
              createdAt: auditLogsTable.createdAt,
            })
            .from(auditLogsTable)
            .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
            .where(where)
            .orderBy(desc(auditLogsTable.createdAt))
            .limit(limit)
    ),
    db.select({ count: count() }).from(auditLogsTable).where(where),
  ]);

  const total = Number(totalResult[0]?.count ?? 0);
  res.json({
    data: logs.map((log) => ({
      ...log,
      oldValues: parseDbJson<Record<string, unknown> | null>(log.oldValues, null),
      newValues: parseDbJson<Record<string, unknown> | null>(log.newValues, null),
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

export default router;
