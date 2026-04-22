import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { schoolsTable, tenantsTable, usersTable } from "@workspace/db/schema";
import { eq, and, count } from "drizzle-orm";
import { requireAuth, requireRole, hashPassword } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import { containsInsensitive } from "../lib/db-search.js";

const router = Router();

const userRoles = ["superadmin", "admin_cliente", "manager", "tecnico", "usuario_cliente", "visor_cliente"] as const;
const userScopeTypes = ["global", "tenant", "school"] as const;

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  role: z.enum(userRoles),
  tenantId: z.number().nullable().optional(),
  schoolId: z.number().nullable().optional(),
  scopeType: z.enum(userScopeTypes).optional(),
  password: z.string().min(12),
});

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.enum(userRoles).optional(),
  active: z.boolean().optional(),
  tenantId: z.number().nullable().optional(),
  schoolId: z.number().nullable().optional(),
  scopeType: z.enum(userScopeTypes).optional(),
});

function isDuplicateEntryError(error: any) {
  const driverNumber = error?.errno ?? error?.code ?? error?.cause?.errno;
  return error?.code === "ER_DUP_ENTRY" || driverNumber === 1062 || driverNumber === "1062";
}

function getDefaultScopeTypeForRole(role: (typeof userRoles)[number]) {
  switch (role) {
    case "superadmin":
    case "tecnico":
      return "global" as const;
    case "admin_cliente":
    case "visor_cliente":
      return "tenant" as const;
    case "manager":
    case "usuario_cliente":
    default:
      return "school" as const;
  }
}

async function getSchoolById(schoolId: number) {
  const schools = await db
    .select({
      id: schoolsTable.id,
      tenantId: schoolsTable.tenantId,
      name: schoolsTable.name,
      active: schoolsTable.active,
    })
    .from(schoolsTable)
    .where(eq(schoolsTable.id, schoolId))
    .limit(1);

  return schools[0] ?? null;
}

async function resolveUserScopeInput(input: {
  role: (typeof userRoles)[number];
  tenantId?: number | null;
  schoolId?: number | null;
  scopeType?: (typeof userScopeTypes)[number];
}) {
  const scopeType = input.scopeType ?? getDefaultScopeTypeForRole(input.role);
  let tenantId = input.tenantId ?? null;
  let schoolId = input.schoolId ?? null;

  if (scopeType === "global") {
    return { scopeType, tenantId: null, schoolId: null, schoolName: null };
  }

  if (scopeType === "school") {
    if (!schoolId) {
      throw new Error("Selecciona el colegio del usuario.");
    }

    const school = await getSchoolById(schoolId);
    if (!school || !school.active) {
      throw new Error("El colegio seleccionado no esta disponible.");
    }

    tenantId = school.tenantId;
    return { scopeType, tenantId, schoolId: school.id, schoolName: school.name };
  }

  if (!tenantId) {
    throw new Error("Selecciona la red educativa del usuario.");
  }

  return { scopeType, tenantId, schoolId: null, schoolName: null };
}

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
  if (search) conditions.push(containsInsensitive(usersTable.name, search));
  if (role) conditions.push(eq(usersTable.role, role));
  if (active !== undefined) conditions.push(eq(usersTable.active, active));
  if (tenantId) conditions.push(eq(usersTable.tenantId, tenantId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [users, totalResult] = await Promise.all([
    (
      offset > 0
        ? db.select({
            id: usersTable.id,
            email: usersTable.email,
            name: usersTable.name,
            role: usersTable.role,
            tenantId: usersTable.tenantId,
            schoolId: usersTable.schoolId,
            scopeType: usersTable.scopeType,
            active: usersTable.active,
            createdAt: usersTable.createdAt,
            lastLoginAt: usersTable.lastLoginAt,
            tenantName: tenantsTable.name,
            schoolName: schoolsTable.name,
          })
            .from(usersTable)
            .leftJoin(tenantsTable, eq(usersTable.tenantId, tenantsTable.id))
            .leftJoin(schoolsTable, eq(usersTable.schoolId, schoolsTable.id))
            .where(where)
            .orderBy(usersTable.createdAt)
            .limit(limit)
            .offset(offset)
        : db.select({
            id: usersTable.id,
            email: usersTable.email,
            name: usersTable.name,
            role: usersTable.role,
            tenantId: usersTable.tenantId,
            schoolId: usersTable.schoolId,
            scopeType: usersTable.scopeType,
            active: usersTable.active,
            createdAt: usersTable.createdAt,
            lastLoginAt: usersTable.lastLoginAt,
            tenantName: tenantsTable.name,
            schoolName: schoolsTable.name,
          })
            .from(usersTable)
            .leftJoin(tenantsTable, eq(usersTable.tenantId, tenantsTable.id))
            .leftJoin(schoolsTable, eq(usersTable.schoolId, schoolsTable.id))
            .where(where)
            .orderBy(usersTable.createdAt)
            .limit(limit)
    ),
    db.select({ count: count() }).from(usersTable).where(where),
  ]);

  const total = Number(totalResult[0]?.count ?? 0);
  res.json({ data: users, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.post("/", requireAuth, requireRole("superadmin", "tecnico"), async (req, res) => {
  const authUser = (req as any).user;
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: parsed.error.message });
    return;
  }

  try {
    const requestedScope = await resolveUserScopeInput({
      role: parsed.data.role,
      tenantId: parsed.data.tenantId,
      schoolId: parsed.data.schoolId,
      scopeType: parsed.data.scopeType,
    });

    if (authUser.role === "admin_cliente") {
      if (requestedScope.scopeType === "global" || requestedScope.tenantId !== authUser.tenantId) {
        res.status(403).json({ error: "Forbidden", message: "Cannot create users outside your educational network" });
        return;
      }

      if (!["manager", "usuario_cliente", "visor_cliente"].includes(parsed.data.role)) {
        res.status(403).json({ error: "Forbidden", message: "Cannot create this role" });
        return;
      }
    }

    const passwordHash = await hashPassword(parsed.data.password);
    await db.insert(usersTable).values({
      email: parsed.data.email.toLowerCase(),
      name: parsed.data.name,
      role: parsed.data.role,
      tenantId: requestedScope.tenantId,
      schoolId: requestedScope.schoolId,
      scopeType: requestedScope.scopeType,
      passwordHash,
      mustChangePassword: true,
    });

    const createdUsers = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        tenantId: usersTable.tenantId,
        schoolId: usersTable.schoolId,
        scopeType: usersTable.scopeType,
        active: usersTable.active,
        createdAt: usersTable.createdAt,
        lastLoginAt: usersTable.lastLoginAt,
        tenantName: tenantsTable.name,
        schoolName: schoolsTable.name,
      })
      .from(usersTable)
      .leftJoin(tenantsTable, eq(usersTable.tenantId, tenantsTable.id))
      .leftJoin(schoolsTable, eq(usersTable.schoolId, schoolsTable.id))
      .where(eq(usersTable.email, parsed.data.email.toLowerCase()))
      .limit(1);

    const createdUser = createdUsers[0];
    if (!createdUser) {
      throw new Error("User insert succeeded but could not be reloaded.");
    }

    await createAuditLog({
      action: "create",
      entityType: "user",
      entityId: createdUser.id,
      userId: authUser.userId,
      tenantId: requestedScope.tenantId,
      newValues: {
        email: parsed.data.email,
        name: parsed.data.name,
        role: parsed.data.role,
        scopeType: requestedScope.scopeType,
        schoolId: requestedScope.schoolId,
      },
    });

    res.status(201).json(createdUser);
  } catch (error: any) {
    if (error instanceof Error && (error.message.includes("Selecciona el colegio") || error.message.includes("Selecciona la red educativa") || error.message.includes("no esta disponible"))) {
      res.status(400).json({ error: "ValidationError", message: error.message });
      return;
    }

    if (isDuplicateEntryError(error)) {
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
      schoolId: usersTable.schoolId,
      scopeType: usersTable.scopeType,
      active: usersTable.active,
      createdAt: usersTable.createdAt,
      lastLoginAt: usersTable.lastLoginAt,
      tenantName: tenantsTable.name,
      schoolName: schoolsTable.name,
    })
    .from(usersTable)
    .leftJoin(tenantsTable, eq(usersTable.tenantId, tenantsTable.id))
    .leftJoin(schoolsTable, eq(usersTable.schoolId, schoolsTable.id))
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

router.patch("/:userId", requireAuth, requireRole("superadmin", "admin_cliente", "tecnico"), async (req, res) => {
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

  if (authUser.role === "admin_cliente" && user.tenantId !== authUser.tenantId) {
    res.status(403).json({ error: "Forbidden", message: "Access denied" });
    return;
  }

  try {
    const nextRole = (parsed.data.role ?? user.role) as (typeof userRoles)[number];
    const resolvedScope = await resolveUserScopeInput({
      role: nextRole,
      tenantId: parsed.data.tenantId ?? user.tenantId,
      schoolId: parsed.data.schoolId ?? user.schoolId,
      scopeType: (parsed.data.scopeType ?? user.scopeType) as (typeof userScopeTypes)[number] | undefined,
    });

    if (authUser.role === "admin_cliente") {
      if (resolvedScope.scopeType === "global" || resolvedScope.tenantId !== authUser.tenantId) {
        res.status(403).json({ error: "Forbidden", message: "Cannot move users outside your educational network" });
        return;
      }

      if (parsed.data.role && !["manager", "usuario_cliente", "visor_cliente"].includes(parsed.data.role)) {
        res.status(403).json({ error: "Forbidden", message: "Cannot assign this role" });
        return;
      }
    }

    await db
      .update(usersTable)
      .set({
        ...parsed.data,
        role: nextRole,
        tenantId: resolvedScope.tenantId,
        schoolId: resolvedScope.schoolId,
        scopeType: resolvedScope.scopeType,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, userId));

    const updatedUsers = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        tenantId: usersTable.tenantId,
        schoolId: usersTable.schoolId,
        scopeType: usersTable.scopeType,
        active: usersTable.active,
        createdAt: usersTable.createdAt,
        lastLoginAt: usersTable.lastLoginAt,
        tenantName: tenantsTable.name,
        schoolName: schoolsTable.name,
      })
      .from(usersTable)
      .leftJoin(tenantsTable, eq(usersTable.tenantId, tenantsTable.id))
      .leftJoin(schoolsTable, eq(usersTable.schoolId, schoolsTable.id))
      .where(eq(usersTable.id, userId))
      .limit(1);

    const updatedUser = updatedUsers[0];
    if (!updatedUser) {
      res.status(404).json({ error: "NotFound", message: "User not found after update" });
      return;
    }

    await createAuditLog({
      action: "update",
      entityType: "user",
      entityId: userId,
      userId: authUser.userId,
      tenantId: resolvedScope.tenantId,
      oldValues: { name: user.name, role: user.role, active: user.active, scopeType: user.scopeType, schoolId: user.schoolId },
      newValues: { ...parsed.data, role: nextRole, scopeType: resolvedScope.scopeType, schoolId: resolvedScope.schoolId },
    });

    res.json(updatedUser);
  } catch (error) {
    if (error instanceof Error && (error.message.includes("Selecciona el colegio") || error.message.includes("Selecciona la red educativa") || error.message.includes("no esta disponible"))) {
      res.status(400).json({ error: "ValidationError", message: error.message });
      return;
    }

    throw error;
  }
});

export default router;
