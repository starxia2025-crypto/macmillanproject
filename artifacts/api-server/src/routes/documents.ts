import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { documentsTable, tenantsTable, usersTable } from "@workspace/db/schema";
import { eq, ilike, and, count, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";

const router = Router();

const documentTypes = ["manual", "tutorial", "video", "faq", "link", "other"] as const;

const createDocumentSchema = z.object({
  title: z.string().min(2),
  description: z.string().nullable().optional(),
  type: z.enum(documentTypes),
  category: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  tenantId: z.number(),
  tags: z.array(z.string()).default([]),
  visibleToRoles: z.array(z.string()).default(["usuario_cliente", "visor_cliente", "tecnico", "admin_cliente", "superadmin"]),
  published: z.boolean().default(false),
});

const updateDocumentSchema = z.object({
  title: z.string().min(2).optional(),
  description: z.string().nullable().optional(),
  type: z.enum(documentTypes).optional(),
  category: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  visibleToRoles: z.array(z.string()).optional(),
  published: z.boolean().optional(),
});

router.get("/", requireAuth, async (req, res) => {
  const authUser = (req as any).user;
  const page = Math.max(1, Number(req.query["page"]) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query["limit"]) || 20));
  const offset = (page - 1) * limit;
  const search = req.query["search"] as string | undefined;
  const category = req.query["category"] as string | undefined;
  const type = req.query["type"] as string | undefined;
  let tenantId = req.query["tenantId"] ? Number(req.query["tenantId"]) : undefined;

  // Tenant isolation
  if (authUser.role !== "superadmin" && authUser.role !== "tecnico") {
    tenantId = authUser.tenantId ?? undefined;
  }

  const conditions = [];
  if (tenantId) conditions.push(eq(documentsTable.tenantId, tenantId));
  if (search) conditions.push(ilike(documentsTable.title, `%${search}%`));
  if (category) conditions.push(eq(documentsTable.category, category));
  if (type) conditions.push(eq(documentsTable.type, type));

  // Non-admin only see published documents
  if (!["superadmin", "admin_cliente"].includes(authUser.role)) {
    conditions.push(eq(documentsTable.published, true));
  }

  // Role visibility filter
  if (authUser.role !== "superadmin") {
    conditions.push(sql`${documentsTable.visibleToRoles} @> ARRAY[${authUser.role}]::text[]`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [docs, totalResult] = await Promise.all([
    db
      .select({
        id: documentsTable.id,
        title: documentsTable.title,
        description: documentsTable.description,
        type: documentsTable.type,
        category: documentsTable.category,
        url: documentsTable.url,
        content: documentsTable.content,
        tenantId: documentsTable.tenantId,
        tenantName: tenantsTable.name,
        tags: documentsTable.tags,
        visibleToRoles: documentsTable.visibleToRoles,
        published: documentsTable.published,
        createdById: documentsTable.createdById,
        createdByName: usersTable.name,
        createdAt: documentsTable.createdAt,
        updatedAt: documentsTable.updatedAt,
      })
      .from(documentsTable)
      .leftJoin(tenantsTable, eq(documentsTable.tenantId, tenantsTable.id))
      .leftJoin(usersTable, eq(documentsTable.createdById, usersTable.id))
      .where(where)
      .limit(limit)
      .offset(offset)
      .orderBy(documentsTable.createdAt),
    db.select({ count: count() }).from(documentsTable).where(where),
  ]);

  const total = Number(totalResult[0]?.count ?? 0);
  res.json({ data: docs, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.post("/", requireAuth, requireRole("superadmin", "admin_cliente", "tecnico"), async (req, res) => {
  const authUser = (req as any).user;
  const parsed = createDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: parsed.error.message });
    return;
  }

  if (authUser.role === "admin_cliente" && parsed.data.tenantId !== authUser.tenantId) {
    res.status(403).json({ error: "Forbidden", message: "Cannot create document for another tenant" });
    return;
  }

  const doc = await db.insert(documentsTable).values({
    ...parsed.data,
    createdById: authUser.userId,
  }).returning();

  await createAuditLog({
    action: "create",
    entityType: "document",
    entityId: doc[0]!.id,
    userId: authUser.userId,
    tenantId: parsed.data.tenantId,
    newValues: { title: parsed.data.title, type: parsed.data.type },
  });

  const tenant = await db.select({ name: tenantsTable.name }).from(tenantsTable).where(eq(tenantsTable.id, parsed.data.tenantId)).limit(1);
  const creator = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, authUser.userId)).limit(1);

  res.status(201).json({
    ...doc[0],
    tenantName: tenant[0]?.name ?? "",
    createdByName: creator[0]?.name ?? "",
  });
});

router.get("/:documentId", requireAuth, async (req, res) => {
  const documentId = Number(req.params["documentId"]);
  const authUser = (req as any).user;

  const docs = await db
    .select({
      id: documentsTable.id,
      title: documentsTable.title,
      description: documentsTable.description,
      type: documentsTable.type,
      category: documentsTable.category,
      url: documentsTable.url,
      content: documentsTable.content,
      tenantId: documentsTable.tenantId,
      tenantName: tenantsTable.name,
      tags: documentsTable.tags,
      visibleToRoles: documentsTable.visibleToRoles,
      published: documentsTable.published,
      createdById: documentsTable.createdById,
      createdByName: usersTable.name,
      createdAt: documentsTable.createdAt,
      updatedAt: documentsTable.updatedAt,
    })
    .from(documentsTable)
    .leftJoin(tenantsTable, eq(documentsTable.tenantId, tenantsTable.id))
    .leftJoin(usersTable, eq(documentsTable.createdById, usersTable.id))
    .where(eq(documentsTable.id, documentId))
    .limit(1);

  const doc = docs[0];
  if (!doc) {
    res.status(404).json({ error: "NotFound", message: "Document not found" });
    return;
  }

  if (authUser.role !== "superadmin" && doc.tenantId !== authUser.tenantId) {
    res.status(403).json({ error: "Forbidden", message: "Access denied" });
    return;
  }

  res.json(doc);
});

router.patch("/:documentId", requireAuth, requireRole("superadmin", "admin_cliente", "tecnico"), async (req, res) => {
  const documentId = Number(req.params["documentId"]);
  const authUser = (req as any).user;
  const parsed = updateDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: parsed.error.message });
    return;
  }

  const docs = await db.select().from(documentsTable).where(eq(documentsTable.id, documentId)).limit(1);
  const doc = docs[0];
  if (!doc) {
    res.status(404).json({ error: "NotFound", message: "Document not found" });
    return;
  }

  if (authUser.role === "admin_cliente" && doc.tenantId !== authUser.tenantId) {
    res.status(403).json({ error: "Forbidden", message: "Access denied" });
    return;
  }

  const updated = await db
    .update(documentsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(documentsTable.id, documentId))
    .returning();

  const tenant = await db.select({ name: tenantsTable.name }).from(tenantsTable).where(eq(tenantsTable.id, doc.tenantId)).limit(1);
  const creator = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, doc.createdById)).limit(1);

  res.json({
    ...updated[0],
    tenantName: tenant[0]?.name ?? "",
    createdByName: creator[0]?.name ?? "",
  });
});

router.delete("/:documentId", requireAuth, requireRole("superadmin", "admin_cliente"), async (req, res) => {
  const documentId = Number(req.params["documentId"]);
  const authUser = (req as any).user;

  const docs = await db.select().from(documentsTable).where(eq(documentsTable.id, documentId)).limit(1);
  const doc = docs[0];
  if (!doc) {
    res.status(404).json({ error: "NotFound", message: "Document not found" });
    return;
  }

  if (authUser.role === "admin_cliente" && doc.tenantId !== authUser.tenantId) {
    res.status(403).json({ error: "Forbidden", message: "Access denied" });
    return;
  }

  await db.delete(documentsTable).where(eq(documentsTable.id, documentId));

  await createAuditLog({
    action: "delete",
    entityType: "document",
    entityId: documentId,
    userId: authUser.userId,
    tenantId: doc.tenantId,
    oldValues: { title: doc.title },
  });

  res.json({ message: "Document deleted" });
});

export default router;
