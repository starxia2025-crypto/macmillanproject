import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { ticketsTable, usersTable, tenantsTable, commentsTable, auditLogsTable } from "@workspace/db/schema";
import { eq, ilike, and, count, desc, gte, lte, sql, or } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";

const router = Router();

const ticketStatuses = ["nuevo", "pendiente", "en_revision", "en_proceso", "esperando_cliente", "resuelto", "cerrado"] as const;
const ticketPriorities = ["baja", "media", "alta", "urgente"] as const;

const createTicketSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(10),
  priority: z.enum(ticketPriorities).default("media"),
  category: z.string().nullable().optional(),
  tenantId: z.number(),
  customFields: z.record(z.unknown()).nullable().optional(),
});

const updateTicketSchema = z.object({
  title: z.string().min(3).optional(),
  description: z.string().optional(),
  priority: z.enum(ticketPriorities).optional(),
  category: z.string().nullable().optional(),
  customFields: z.record(z.unknown()).nullable().optional(),
});

const assignTicketSchema = z.object({
  userId: z.number().nullable(),
});

const changeStatusSchema = z.object({
  status: z.enum(ticketStatuses),
  comment: z.string().nullable().optional(),
});

function generateTicketNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `TKT-${timestamp}-${random}`;
}

function buildTicketConditions(query: Record<string, any>, authUser: any) {
  const conditions: any[] = [];

  // Tenant isolation
  if (authUser.role === "usuario_cliente" || authUser.role === "visor_cliente" || authUser.role === "admin_cliente") {
    if (authUser.tenantId) {
      conditions.push(eq(ticketsTable.tenantId, authUser.tenantId));
    }
    // usuario_cliente only sees their own tickets
    if (authUser.role === "usuario_cliente") {
      conditions.push(eq(ticketsTable.createdById, authUser.userId));
    }
  } else if (query["tenantId"]) {
    conditions.push(eq(ticketsTable.tenantId, Number(query["tenantId"])));
  }

  if (query["status"]) conditions.push(eq(ticketsTable.status, query["status"]));
  if (query["priority"]) conditions.push(eq(ticketsTable.priority, query["priority"]));
  if (query["assignedToId"]) conditions.push(eq(ticketsTable.assignedToId, Number(query["assignedToId"])));
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
        ilike(ticketsTable.title, `%${query["search"]}%`),
        ilike(ticketsTable.ticketNumber, `%${query["search"]}%`)
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
    db
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
      .leftJoin(usersTable, eq(ticketsTable.createdById, usersTable.id))
      .where(where)
      .limit(limit)
      .offset(offset)
      .orderBy(desc(ticketsTable.createdAt)),
    db.select({ count: count() }).from(ticketsTable).where(where),
  ]);

  // Get comment counts and assignee names
  const ticketsWithExtra = await Promise.all(
    tickets.map(async (t) => {
      const [commentCount, assignee] = await Promise.all([
        db.select({ count: count() }).from(commentsTable).where(eq(commentsTable.ticketId, t.id)),
        t.assignedToId
          ? db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, t.assignedToId)).limit(1)
          : Promise.resolve([]),
      ]);
      return {
        ...t,
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

  // Ensure tenant isolation
  if (authUser.role === "usuario_cliente" || authUser.role === "visor_cliente" || authUser.role === "admin_cliente") {
    if (parsed.data.tenantId !== authUser.tenantId) {
      res.status(403).json({ error: "Forbidden", message: "Cannot create ticket for another tenant" });
      return;
    }
  }

  const ticket = await db.insert(ticketsTable).values({
    ticketNumber: generateTicketNumber(),
    title: parsed.data.title,
    description: parsed.data.description,
    priority: parsed.data.priority,
    category: parsed.data.category ?? null,
    tenantId: parsed.data.tenantId,
    createdById: authUser.userId,
    customFields: parsed.data.customFields ?? null,
  }).returning();

  const tenant = await db.select({ name: tenantsTable.name }).from(tenantsTable).where(eq(tenantsTable.id, parsed.data.tenantId)).limit(1);
  const creator = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, authUser.userId)).limit(1);

  await createAuditLog({
    action: "create",
    entityType: "ticket",
    entityId: ticket[0]!.id,
    userId: authUser.userId,
    tenantId: parsed.data.tenantId,
    newValues: { title: parsed.data.title, priority: parsed.data.priority },
  });

  res.status(201).json({
    ...ticket[0],
    tenantName: tenant[0]?.name ?? "",
    createdByName: creator[0]?.name ?? "",
    assignedToName: null,
    commentCount: 0,
  });
});

router.get("/:ticketId", requireAuth, async (req, res) => {
  const ticketId = Number(req.params["ticketId"]);
  const authUser = (req as any).user;

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
    .leftJoin(usersTable, eq(ticketsTable.createdById, usersTable.id))
    .where(eq(ticketsTable.id, ticketId))
    .limit(1);

  const ticket = tickets[0];
  if (!ticket) {
    res.status(404).json({ error: "NotFound", message: "Ticket not found" });
    return;
  }

  // Tenant isolation check
  if (authUser.role === "usuario_cliente") {
    if (ticket.tenantId !== authUser.tenantId) {
      res.status(403).json({ error: "Forbidden", message: "Access denied" });
      return;
    }
    if (authUser.role === "usuario_cliente" && ticket.createdById !== authUser.userId) {
      res.status(403).json({ error: "Forbidden", message: "Access denied" });
      return;
    }
  } else if (authUser.role === "admin_cliente" || authUser.role === "visor_cliente") {
    if (ticket.tenantId !== authUser.tenantId) {
      res.status(403).json({ error: "Forbidden", message: "Access denied" });
      return;
    }
  }

  const [comments, ticketAuditLogs, commentCount, assignee] = await Promise.all([
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
    ticket.assignedToId
      ? db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, ticket.assignedToId)).limit(1)
      : Promise.resolve([]),
  ]);

  // Filter internal comments for non-technicians
  const visibleComments = (authUser.role === "usuario_cliente")
    ? comments.filter((c) => !c.isInternal)
    : comments;

  res.json({
    ...ticket,
    assignedToName: (assignee as any)[0]?.name ?? null,
    commentCount: Number(commentCount[0]?.count ?? 0),
    comments: visibleComments,
    auditLogs: ticketAuditLogs,
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

  // Only creator, technicians, and admin can update
  if (authUser.role === "usuario_cliente" && ticket.createdById !== authUser.userId) {
    res.status(403).json({ error: "Forbidden", message: "Access denied" });
    return;
  }

  const updated = await db
    .update(ticketsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(ticketsTable.id, ticketId))
    .returning();

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
    db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, ticket.createdById)).limit(1),
    updated[0]!.assignedToId
      ? db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, updated[0]!.assignedToId!)).limit(1)
      : Promise.resolve([]),
    db.select({ count: count() }).from(commentsTable).where(eq(commentsTable.ticketId, ticketId)),
  ]);

  res.json({
    ...updated[0],
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

  const updated = await db
    .update(ticketsTable)
    .set({ assignedToId: parsed.data.userId, updatedAt: new Date() })
    .where(eq(ticketsTable.id, ticketId))
    .returning();

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
    ...updated[0],
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

  const updated = await db
    .update(ticketsTable)
    .set(updateData as any)
    .where(eq(ticketsTable.id, ticketId))
    .returning();

  // Add status change comment if provided
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
    db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, ticket.createdById)).limit(1),
    updated[0]!.assignedToId
      ? db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, updated[0]!.assignedToId!)).limit(1)
      : Promise.resolve([]),
    db.select({ count: count() }).from(commentsTable).where(eq(commentsTable.ticketId, ticketId)),
  ]);

  res.json({
    ...updated[0],
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

  const filtered = (authUser.role === "usuario_cliente")
    ? comments.filter((c) => !c.isInternal)
    : comments;

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
  if (!tickets[0]) {
    res.status(404).json({ error: "NotFound", message: "Ticket not found" });
    return;
  }

  // Only technicians can post internal comments
  const isInternal = parsed.data.isInternal && ["superadmin", "tecnico", "admin_cliente", "visor_cliente"].includes(authUser.role);

  const comment = await db.insert(commentsTable).values({
    ticketId,
    authorId: authUser.userId,
    content: parsed.data.content,
    isInternal,
  }).returning();

  await db.update(ticketsTable).set({ updatedAt: new Date() }).where(eq(ticketsTable.id, ticketId));

  const author = await db.select({ name: usersTable.name, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, authUser.userId)).limit(1);

  res.status(201).json({
    ...comment[0],
    authorName: author[0]?.name ?? "",
    authorRole: author[0]?.role ?? "",
  });
});

export default router;
