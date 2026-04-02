import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { usersTable, tenantsTable } from "@workspace/db/schema";
import { eq, ilike, and, count } from "drizzle-orm";
import { requireAuth, requireRole, hashPassword } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";

const router = Router();

const userRoles = ["superadmin", "admin_cliente", "manager", "tecnico", "usuario_cliente", "visor_cliente"] as const;

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  role: z.enum(userRoles),
  tenantId: z.number().nullable().optional(),
  password: z.string().min(8),
});

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.enum(userRoles).optional(),
  active: z.boolean().optional(),
  tenantId: z.number().nullable().optional(),
});

router.get("/", requireAuth, async (req, res) => {
  const authUser = (req as any).user;
  const page = Math.max(1, Number(req.query["page"]) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query["limit"]) || 20));
  const search = req.query["search"] as string | undefined;
  const role = req.query["role"] as string | undefined;
  const active = req.query["active"] !== undefined ? req.query["active"] === "true" : undefined;
  let tenantId = req.query["tenantId"] ? Number(req.query["tenantId"]) : undefined;
  const offset = (page - 1) * limit;

  // Restrict to own tenant for non-superadmin
  if (authUser.role !== "superadmin" && authUser.role !== "tecnico") {
    tenantId = authUser.tenantId ?? undefined;
  }

  const conditions = [];
  if (search) conditions.push(ilike(usersTable.name, `%${search}%`));
  if (role) conditions.push(eq(usersTable.role, role));
  if (active !== undefined) conditions.push(eq(usersTable.active, active));
  if (tenantId) conditions.push(eq(usersTable.tenantId, tenantId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [users, totalResult] = await Promise.all([
    db.select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      role: usersTable.role,
      tenantId: usersTable.tenantId,
      active: usersTable.active,
      createdAt: usersTable.createdAt,
      lastLoginAt: usersTable.lastLoginAt,
      tenantName: tenantsTable.name,
    })
      .from(usersTable)
      .leftJoin(tenantsTable, eq(usersTable.tenantId, tenantsTable.id))
      .where(where)
      .limit(limit)
      .offset(offset)
      .orderBy(usersTable.createdAt),
    db.select({ count: count() }).from(usersTable).where(where),
  ]);

  const total = Number(totalResult[0]?.count ?? 0);
  res.json({ data: users, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.post("/", requireAuth, requireRole("superadmin", "admin_cliente", "tecnico", "visor_cliente"), async (req, res) => {
  const authUser = (req as any).user;
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: parsed.error.message });
    return;
  }

  // admin_cliente can only create users in their own tenant
  if (authUser.role === "admin_cliente" || authUser.role === "visor_cliente") {
    if (parsed.data.tenantId !== authUser.tenantId) {
      res.status(403).json({ error: "Forbidden", message: "Cannot create users in another tenant" });
      return;
    }
    if (!["manager", "usuario_cliente", "visor_cliente"].includes(parsed.data.role)) {
      res.status(403).json({ error: "Forbidden", message: "Cannot create this role" });
      return;
    }
  }

  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const user = await db.insert(usersTable).values({
      email: parsed.data.email.toLowerCase(),
      name: parsed.data.name,
      role: parsed.data.role,
      tenantId: parsed.data.tenantId ?? null,
      passwordHash,
    }).returning();

    await createAuditLog({
      action: "create",
      entityType: "user",
      entityId: user[0]!.id,
      userId: authUser.userId,
      tenantId: parsed.data.tenantId ?? null,
      newValues: { email: parsed.data.email, name: parsed.data.name, role: parsed.data.role },
    });

    const { passwordHash: _, ...safeUser } = user[0]!;
    res.status(201).json({ ...safeUser, tenantName: null });
  } catch (error: any) {
    if (error?.code === "23505") {
      res.status(409).json({ error: "Conflict", message: "Ya existe un usuario con ese correo." });
      return;
    }

    console.error("Create user failed", error);
    res.status(500).json({ error: "InternalServerError", message: "No se pudo crear el usuario." });
  }
});

router.get("/:userId", requireAuth, async (req, res) => {
  const userId = Number(req.params["userId"]);
  const authUser = (req as any).user;

  const users = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      role: usersTable.role,
      tenantId: usersTable.tenantId,
      active: usersTable.active,
      createdAt: usersTable.createdAt,
      lastLoginAt: usersTable.lastLoginAt,
      tenantName: tenantsTable.name,
    })
    .from(usersTable)
    .leftJoin(tenantsTable, eq(usersTable.tenantId, tenantsTable.id))
    .where(eq(usersTable.id, userId))
    .limit(1);

  const user = users[0];
  if (!user) {
    res.status(404).json({ error: "NotFound", message: "User not found" });
    return;
  }

  // Non-superadmin can only see users in their tenant
  if (authUser.role !== "superadmin" && authUser.role !== "tecnico") {
    if (user.tenantId !== authUser.tenantId) {
      res.status(403).json({ error: "Forbidden", message: "Access denied" });
      return;
    }
  }

  res.json(user);
});

router.patch("/:userId", requireAuth, requireRole("superadmin", "admin_cliente", "tecnico", "visor_cliente"), async (req, res) => {
  const userId = Number(req.params["userId"]);
  const authUser = (req as any).user;
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: parsed.error.message });
    return;
  }

  const users = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const user = users[0];
  if (!user) {
    res.status(404).json({ error: "NotFound", message: "User not found" });
    return;
  }

  if ((authUser.role === "admin_cliente" || authUser.role === "visor_cliente") && user.tenantId !== authUser.tenantId) {
    res.status(403).json({ error: "Forbidden", message: "Access denied" });
    return;
  }

  if (authUser.role === "admin_cliente" || authUser.role === "visor_cliente") {
    if (parsed.data.tenantId !== undefined && parsed.data.tenantId !== authUser.tenantId) {
      res.status(403).json({ error: "Forbidden", message: "Cannot move users to another tenant" });
      return;
    }

    if (parsed.data.role && !["manager", "usuario_cliente", "visor_cliente"].includes(parsed.data.role)) {
      res.status(403).json({ error: "Forbidden", message: "Cannot assign this role" });
      return;
    }
  }

  const updated = await db
    .update(usersTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(usersTable.id, userId))
    .returning();

  await createAuditLog({
    action: "update",
    entityType: "user",
    entityId: userId,
    userId: authUser.userId,
    tenantId: user.tenantId,
    oldValues: { name: user.name, role: user.role, active: user.active },
    newValues: parsed.data,
  });

  const { passwordHash, ...safeUser } = updated[0]!;
  const tenants = user.tenantId
    ? await db.select({ name: tenantsTable.name }).from(tenantsTable).where(eq(tenantsTable.id, user.tenantId)).limit(1)
    : [];

  res.json({ ...safeUser, tenantName: tenants[0]?.name ?? null });
});

export default router;
