import { Router } from "express";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { z } from "zod";
import { db } from "@workspace/db";
import { documentsTable, tenantsTable, usersTable } from "@workspace/db/schema";
import { eq, and, count } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import { parseDbJson, stringifyDbJson } from "../lib/db-json.js";
import { containsInsensitive, jsonArrayContains } from "../lib/db-search.js";

const router = Router();
const storageRoot = path.resolve(process.env["DOCUMENTS_STORAGE_ROOT"] || "/app/storage");
const documentsStoragePath = path.join(storageRoot, "documents");

type UploadedFile = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  name: string;
  size: number;
  type: string;
};

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

function isUploadedFile(value: unknown): value is UploadedFile {
  return !!value && typeof value !== "string" && typeof (value as UploadedFile).arrayBuffer === "function" && typeof (value as UploadedFile).name === "string";
}

function parseRoles(value: unknown) {
  return parseDbJson<string[]>(value, []);
}

function parseTags(value: unknown) {
  return parseDbJson<string[]>(value, []);
}

function normalizeDocument(doc: any) {
  return {
    ...doc,
    tags: parseTags(doc.tags),
    visibleToRoles: parseRoles(doc.visibleToRoles),
  };
}

router.post("/upload", requireAuth, requireRole("superadmin", "admin_cliente", "tecnico", "manager", "visor_cliente"), async (req, res) => {
  const authUser = (req as any).user;

  try {
    const request = new Request("http://local/upload", {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: Readable.toWeb(req) as any,
      duplex: "half",
    });

    const formData = await request.formData();
    const file = formData.get("file");
    const rawTenantId = formData.get("tenantId");
    const tenantId = rawTenantId ? Number(rawTenantId) : authUser.tenantId;

    if (!isUploadedFile(file)) {
      res.status(400).json({ error: "ValidationError", message: "No se recibio ningun archivo." });
      return;
    }

    if (!tenantId || Number.isNaN(tenantId)) {
      res.status(400).json({ error: "ValidationError", message: "Falta el cliente de destino." });
      return;
    }

    if ((authUser.role === "admin_cliente" || authUser.role === "manager" || authUser.role === "visor_cliente") && tenantId !== authUser.tenantId) {
      res.status(403).json({ error: "Forbidden", message: "No puedes subir archivos para otro cliente." });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      res.status(413).json({ error: "PayloadTooLarge", message: "El archivo supera el limite de 10 MB." });
      return;
    }

    await mkdir(documentsStoragePath, { recursive: true });

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const finalName = `${Date.now()}-${safeName}`;
    const filePath = path.join(documentsStoragePath, finalName);
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    await writeFile(filePath, fileBuffer);

    const publicUrl = `${req.protocol}://${req.get("host")}/uploads/documents/${finalName}`;

    res.status(201).json({
      fileName: file.name,
      storedFileName: finalName,
      size: file.size,
      mimeType: file.type || "application/octet-stream",
      url: publicUrl,
      tenantId,
    });
  } catch (error) {
    console.error("Document upload failed", error);
    res.status(500).json({ error: "InternalServerError", message: "No se pudo subir el archivo." });
  }
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

  if (authUser.role !== "superadmin" && authUser.role !== "tecnico") {
    tenantId = authUser.tenantId ?? undefined;
  }

  const conditions = [];
  if (tenantId) conditions.push(eq(documentsTable.tenantId, tenantId));
  if (search) conditions.push(containsInsensitive(documentsTable.title, search));
  if (category) conditions.push(eq(documentsTable.category, category));
  if (type) conditions.push(eq(documentsTable.type, type));
  if (!["superadmin", "admin_cliente", "visor_cliente"].includes(authUser.role)) {
    conditions.push(eq(documentsTable.published, true));
  }
  if (authUser.role !== "superadmin") {
    conditions.push(jsonArrayContains(documentsTable.visibleToRoles, authUser.role));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [docs, totalResult] = await Promise.all([
    (
      offset > 0
        ? db
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
            .orderBy(documentsTable.createdAt)
            .limit(limit)
            .offset(offset)
        : db
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
            .orderBy(documentsTable.createdAt)
            .limit(limit)
    ),
    db.select({ count: count() }).from(documentsTable).where(where),
  ]);

  const total = Number(totalResult[0]?.count ?? 0);
  res.json({ data: docs.map(normalizeDocument), total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.post("/", requireAuth, requireRole("superadmin", "admin_cliente", "tecnico", "manager", "visor_cliente"), async (req, res) => {
  const authUser = (req as any).user;
  const parsed = createDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: parsed.error.message });
    return;
  }

  if ((authUser.role === "admin_cliente" || authUser.role === "manager" || authUser.role === "visor_cliente") && parsed.data.tenantId !== authUser.tenantId) {
    res.status(403).json({ error: "Forbidden", message: "Cannot create document for another tenant" });
    return;
  }

  try {
    const now = new Date();
    const insertValues: Record<string, unknown> = {
      title: parsed.data.title,
      type: parsed.data.type,
      tenantId: parsed.data.tenantId,
      createdById: authUser.userId,
      published: parsed.data.published,
      createdAt: now,
      updatedAt: now,
    };

    if (parsed.data.description !== undefined) insertValues["description"] = parsed.data.description;
    if (parsed.data.category !== undefined) insertValues["category"] = parsed.data.category;
    if (parsed.data.url !== undefined) insertValues["url"] = parsed.data.url;
    if (parsed.data.content !== undefined) insertValues["content"] = parsed.data.content;
    if (parsed.data.tags.length > 0) insertValues["tags"] = stringifyDbJson(parsed.data.tags);
    if (parsed.data.visibleToRoles.length > 0) insertValues["visibleToRoles"] = stringifyDbJson(parsed.data.visibleToRoles);

    await db.insert(documentsTable).values(insertValues as any);

    res.status(201).json({
      title: parsed.data.title,
      type: parsed.data.type,
      tenantId: parsed.data.tenantId,
      published: parsed.data.published,
    });
  } catch (error) {
    console.error("Create document failed", error);
    res.status(500).json({ error: "InternalServerError", message: "No se pudo publicar el contenido." });
  }
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

  res.json(normalizeDocument(doc));
});

router.patch("/:documentId", requireAuth, requireRole("superadmin", "admin_cliente", "tecnico", "manager", "visor_cliente"), async (req, res) => {
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

  if ((authUser.role === "admin_cliente" || authUser.role === "manager" || authUser.role === "visor_cliente") && doc.tenantId !== authUser.tenantId) {
    res.status(403).json({ error: "Forbidden", message: "Access denied" });
    return;
  }

  const updateValues: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.tags !== undefined) updateValues["tags"] = stringifyDbJson(parsed.data.tags);
  if (parsed.data.visibleToRoles !== undefined) updateValues["visibleToRoles"] = stringifyDbJson(parsed.data.visibleToRoles);

  await db
    .update(documentsTable)
    .set(updateValues as any)
    .where(eq(documentsTable.id, documentId));

  const updatedDocs = await db
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

  const updatedDoc = updatedDocs[0];
  if (!updatedDoc) {
    res.status(404).json({ error: "NotFound", message: "Document not found" });
    return;
  }

  res.json(normalizeDocument(updatedDoc));
});

router.delete("/:documentId", requireAuth, requireRole("superadmin", "admin_cliente", "tecnico", "manager", "visor_cliente"), async (req, res) => {
  const documentId = Number(req.params["documentId"]);
  const authUser = (req as any).user;

  const docs = await db.select().from(documentsTable).where(eq(documentsTable.id, documentId)).limit(1);
  const doc = docs[0];
  if (!doc) {
    res.status(404).json({ error: "NotFound", message: "Document not found" });
    return;
  }

  if ((authUser.role === "admin_cliente" || authUser.role === "manager" || authUser.role === "visor_cliente") && doc.tenantId !== authUser.tenantId) {
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
