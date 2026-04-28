import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { schoolsTable, tenantsTable, ticketsTable, usersTable } from "@workspace/db/schema";
import { eq, count, and, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import { hashPassword } from "../lib/auth.js";
import { parseDbJson, stringifyDbJson } from "../lib/db-json.js";
import { containsInsensitive } from "../lib/db-search.js";

const router = Router();

const quickLinkSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  icon: z.string().min(1),
});

const schoolInputSchema = z.object({
  id: z.number().optional(),
  name: z.string().min(2),
  code: z.string().nullable().optional(),
  isHeadquarters: z.boolean().optional(),
  active: z.boolean().optional(),
  externalApiEnabled: z.boolean().optional(),
});

const regenerateSchoolExternalApiSchema = z.object({
  fallbackUserId: z.number().int().positive().nullable().optional(),
});

type ExternalApiProvisioning = {
  schoolId: number;
  schoolName: string;
  clientId: string;
  apiKey: string;
  tenantId: number;
  schoolIdTarget: number;
  examplePayload: Record<string, unknown>;
};

const createTenantSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  contactEmail: z.string().email().nullable().optional(),
  primaryColor: z.string().nullable().optional(),
  sidebarBackgroundColor: z.string().nullable().optional(),
  sidebarTextColor: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
  hasMochilasAccess: z.boolean().optional(),
  hasOrderLookup: z.boolean().optional(),
  hasReturnsAccess: z.boolean().optional(),
  quickLinks: z.array(quickLinkSchema).optional(),
  schools: z.array(schoolInputSchema).optional(),
});

const updateTenantSchema = z.object({
  name: z.string().min(2).optional(),
  contactEmail: z.string().email().nullable().optional(),
  active: z.boolean().optional(),
  primaryColor: z.string().nullable().optional(),
  sidebarBackgroundColor: z.string().nullable().optional(),
  sidebarTextColor: z.string().nullable().optional(),
  hasMochilasAccess: z.boolean().optional(),
  hasOrderLookup: z.boolean().optional(),
  hasReturnsAccess: z.boolean().optional(),
  quickLinks: z.array(quickLinkSchema).optional(),
  logoUrl: z.string().nullable().optional(),
  schools: z.array(schoolInputSchema).optional(),
});

function parseQuickLinks(value: unknown) {
  return parseDbJson<Array<{ label: string; url: string; icon: string }>>(value, []);
}

function slugifySchoolName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || `school-${Date.now()}`;
}

function buildSchoolExternalClientId(tenantSlug: string, schoolSlug: string) {
  return `${tenantSlug}-${schoolSlug}-${crypto.randomBytes(4).toString("hex")}`.slice(0, 160);
}

function generateExternalApiKey() {
  return crypto.randomBytes(32).toString("hex");
}

function buildExternalIntegrationExample(clientId: string) {
  return {
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      "x-api-key": "<SECRET>",
    },
    body: {
      externalId: "ext-001",
      type: "email_change",
      reporterEmail: "origen@cliente.com",
      affectedEmail: "usuario@dominio.com",
      newEmail: "usuario.nuevo@dominio.com",
      orderId: "PED-001",
      title: "Cambio de correo",
      description: "Solicitud recibida desde sistema externo para cambiar correo.",
      reason: "Cuenta duplicada",
    },
  };
}

async function getTenantSchools(tenantId: number) {
  const schools = await db
    .select({
      id: schoolsTable.id,
      tenantId: schoolsTable.tenantId,
      parentSchoolId: schoolsTable.parentSchoolId,
      name: schoolsTable.name,
      slug: schoolsTable.slug,
      code: schoolsTable.code,
      isHeadquarters: schoolsTable.isHeadquarters,
      externalApiEnabled: schoolsTable.externalApiEnabled,
      externalApiClientId: schoolsTable.externalApiClientId,
      externalApiKeyConfigured: sql<boolean>`${schoolsTable.externalApiKeyHash} IS NOT NULL`,
      externalApiKeyCreatedAt: schoolsTable.externalApiKeyCreatedAt,
      active: schoolsTable.active,
      createdAt: schoolsTable.createdAt,
      updatedAt: schoolsTable.updatedAt,
    })
    .from(schoolsTable)
    .where(eq(schoolsTable.tenantId, tenantId))
    .orderBy(schoolsTable.name);

  return schools;
}

async function syncTenantSchools(
  tenant: { id: number; slug: string },
  schools: Array<z.infer<typeof schoolInputSchema>>,
) {
  const existingSchools = await db
    .select({
      id: schoolsTable.id,
      tenantId: schoolsTable.tenantId,
      name: schoolsTable.name,
      slug: schoolsTable.slug,
      active: schoolsTable.active,
      externalApiEnabled: schoolsTable.externalApiEnabled,
      externalApiClientId: schoolsTable.externalApiClientId,
      externalApiKeyHash: schoolsTable.externalApiKeyHash,
      externalApiKeyCreatedAt: schoolsTable.externalApiKeyCreatedAt,
    })
    .from(schoolsTable)
    .where(eq(schoolsTable.tenantId, tenant.id));
  const existingById = new Map(existingSchools.map((school) => [school.id, school]));
  const incomingIds = new Set<number>();
  const provisioning: ExternalApiProvisioning[] = [];

  for (const school of schools) {
    const nextSchoolSlug = slugifySchoolName(school.name);
    const externalApiEnabled = school.externalApiEnabled ?? false;

    if (school.id && existingById.has(school.id)) {
      incomingIds.add(school.id);
      const existingSchool = existingById.get(school.id)!;
      const shouldGenerateApiKey = externalApiEnabled && (!existingSchool.externalApiEnabled || !existingSchool.externalApiKeyHash);
      const nextApiKey = shouldGenerateApiKey ? generateExternalApiKey() : null;
      const nextClientId = externalApiEnabled
        ? existingSchool.externalApiClientId || buildSchoolExternalClientId(tenant.slug, nextSchoolSlug)
        : null;

      await db
        .update(schoolsTable)
        .set({
          name: school.name.trim(),
          slug: nextSchoolSlug,
          code: school.code?.trim() || null,
          isHeadquarters: school.isHeadquarters ?? false,
          externalApiEnabled,
          externalApiClientId: externalApiEnabled ? nextClientId : null,
          externalApiKeyHash: externalApiEnabled
            ? nextApiKey
              ? await hashPassword(nextApiKey)
              : existingSchool.externalApiKeyHash ?? null
            : null,
          externalApiKeyCreatedAt: externalApiEnabled
            ? nextApiKey
              ? new Date()
              : existingSchool.externalApiKeyCreatedAt ?? null
            : null,
          active: school.active ?? true,
          updatedAt: new Date(),
        })
        .where(eq(schoolsTable.id, school.id));

      if (shouldGenerateApiKey && nextApiKey) {
        provisioning.push({
          schoolId: school.id,
          schoolName: school.name.trim(),
          clientId: nextClientId,
          apiKey: nextApiKey,
          tenantId: tenant.id,
          schoolIdTarget: school.id,
          examplePayload: buildExternalIntegrationExample(nextClientId),
        });
      }
      continue;
    }

    const nextApiKey = externalApiEnabled ? generateExternalApiKey() : null;
    const nextClientId = externalApiEnabled ? buildSchoolExternalClientId(tenant.slug, nextSchoolSlug) : null;
    await db.insert(schoolsTable).values({
      tenantId: tenant.id,
      parentSchoolId: null,
      name: school.name.trim(),
      slug: nextSchoolSlug,
      code: school.code?.trim() || null,
      isHeadquarters: school.isHeadquarters ?? false,
      externalApiEnabled,
      externalApiClientId: nextClientId,
      externalApiKeyHash: nextApiKey ? await hashPassword(nextApiKey) : null,
      externalApiKeyCreatedAt: nextApiKey ? new Date() : null,
      active: school.active ?? true,
    });

    const insertedSchoolRows = await db
      .select({ id: schoolsTable.id })
      .from(schoolsTable)
      .where(and(eq(schoolsTable.tenantId, tenant.id), eq(schoolsTable.slug, nextSchoolSlug)))
      .orderBy(sql`${schoolsTable.id} DESC`)
      .limit(1);

    const insertedId = Number(insertedSchoolRows[0]?.id ?? 0);
    if (externalApiEnabled && nextApiKey && insertedId > 0) {
      provisioning.push({
        schoolId: insertedId,
        schoolName: school.name.trim(),
        clientId: nextClientId,
        apiKey: nextApiKey,
        tenantId: tenant.id,
        schoolIdTarget: insertedId,
        examplePayload: buildExternalIntegrationExample(nextClientId),
      });
    }
  }

  for (const existingSchool of existingSchools) {
    if (!incomingIds.has(existingSchool.id) && schools.some((school) => school.id === existingSchool.id) === false) {
      await db
        .update(schoolsTable)
        .set({
          active: false,
          externalApiEnabled: false,
          externalApiClientId: null,
          externalApiKeyHash: null,
          externalApiKeyCreatedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schoolsTable.id, existingSchool.id));
    }
  }

  return provisioning;
}

function isDuplicateEntryError(error: any) {
  const driverNumber = error?.errno ?? error?.code ?? error?.cause?.errno;
  return error?.code === "ER_DUP_ENTRY" || driverNumber === 1062 || driverNumber === "1062";
}

router.get("/", requireAuth, requireRole("superadmin", "tecnico", "manager"), async (req, res) => {
  const page = Math.max(1, Number(req.query["page"]) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query["limit"]) || 20));
  const search = req.query["search"] as string | undefined;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (search) {
    conditions.push(containsInsensitive(tenantsTable.name, search));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [tenants, totalResult] = await Promise.all([
    (
      offset > 0
        ? db.select().from(tenantsTable).where(whereClause).orderBy(tenantsTable.createdAt).limit(limit).offset(offset)
        : db.select().from(tenantsTable).where(whereClause).orderBy(tenantsTable.createdAt).limit(limit)
    ),
    db.select({ count: count() }).from(tenantsTable).where(whereClause),
  ]);

  const total = Number(totalResult[0]?.count ?? 0);

  const tenantsWithStats = await Promise.all(
    tenants.map(async (tenant) => {
      const [userCount, ticketCount, openTicketCount, schools] = await Promise.all([
        db.select({ count: count() }).from(usersTable).where(eq(usersTable.tenantId, tenant.id)),
        db.select({ count: count() }).from(ticketsTable).where(eq(ticketsTable.tenantId, tenant.id)),
        db.select({ count: count() }).from(ticketsTable).where(
          and(eq(ticketsTable.tenantId, tenant.id), sql`${ticketsTable.status} NOT IN ('resuelto', 'cerrado')`)
        ),
        getTenantSchools(tenant.id),
      ]);

      return {
        ...tenant,
        quickLinks: parseQuickLinks(tenant.quickLinks),
        schools,
        totalUsers: Number(userCount[0]?.count ?? 0),
        totalTickets: Number(ticketCount[0]?.count ?? 0),
        openTickets: Number(openTicketCount[0]?.count ?? 0),
      };
    })
  );

  res.json({ data: tenantsWithStats, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.post("/", requireAuth, requireRole("superadmin", "tecnico", "manager"), async (req, res) => {
  const parsed = createTenantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: parsed.error.message });
    return;
  }

  const authUser = (req as any).user;
  try {
    const insertValues: Record<string, unknown> = {
      name: parsed.data.name,
      slug: parsed.data.slug,
    };

    if (parsed.data.contactEmail !== undefined) insertValues["contactEmail"] = parsed.data.contactEmail ?? null;
    if (parsed.data.primaryColor !== undefined) insertValues["primaryColor"] = parsed.data.primaryColor ?? null;
    if (parsed.data.sidebarBackgroundColor !== undefined) insertValues["sidebarBackgroundColor"] = parsed.data.sidebarBackgroundColor ?? null;
    if (parsed.data.sidebarTextColor !== undefined) insertValues["sidebarTextColor"] = parsed.data.sidebarTextColor ?? null;
    if (parsed.data.logoUrl !== undefined) insertValues["logoUrl"] = parsed.data.logoUrl ?? null;
    if (parsed.data.hasMochilasAccess !== undefined) insertValues["hasMochilasAccess"] = parsed.data.hasMochilasAccess;
    if (parsed.data.hasOrderLookup !== undefined) insertValues["hasOrderLookup"] = parsed.data.hasOrderLookup;
    if (parsed.data.hasReturnsAccess !== undefined) insertValues["hasReturnsAccess"] = parsed.data.hasReturnsAccess;
    if (parsed.data.quickLinks !== undefined) insertValues["quickLinks"] = stringifyDbJson(parsed.data.quickLinks);

    await db.insert(tenantsTable).values(insertValues as any);

    const tenant = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, parsed.data.slug))
      .limit(1);

    const createdTenant = tenant[0];
    if (!createdTenant) {
      throw new Error("Tenant insert succeeded but could not be reloaded.");
    }

    const externalApiProvisioning =
      parsed.data.schools?.length
        ? await syncTenantSchools({ id: createdTenant.id, slug: createdTenant.slug }, parsed.data.schools)
        : [];

    const schools = await getTenantSchools(createdTenant.id);

    await createAuditLog({
      action: "create",
      entityType: "tenant",
      entityId: createdTenant.id,
      userId: authUser.userId,
      newValues: { ...parsed.data, schools: schools.map((school) => ({ id: school.id, name: school.name })) },
    });

    res.status(201).json({
      ...createdTenant,
      quickLinks: parseQuickLinks(createdTenant.quickLinks),
      schools,
      externalApiProvisioning,
      totalUsers: 0,
      totalTickets: 0,
      openTickets: 0,
    });
  } catch (error: any) {
    if (isDuplicateEntryError(error)) {
      res.status(409).json({ error: "Conflict", message: "Ya existe un colegio con ese identificador." });
      return;
    }

    console.error("Create tenant failed", error);
    res.status(500).json({ error: "InternalServerError", message: "No se pudo crear el colegio." });
  }
});

router.get("/:tenantId", requireAuth, requireRole("superadmin", "tecnico", "admin_cliente", "manager", "usuario_cliente", "visor_cliente"), async (req, res) => {
  const tenantId = Number(req.params["tenantId"]);
  const authUser = (req as any).user;

  if (["admin_cliente", "manager", "usuario_cliente", "visor_cliente"].includes(authUser.role) && authUser.tenantId !== tenantId) {
    res.status(403).json({ error: "Forbidden", message: "Access denied" });
    return;
  }

  const tenants = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  const tenant = tenants[0];
  if (!tenant) {
    res.status(404).json({ error: "NotFound", message: "Tenant not found" });
    return;
  }

  const [userCount, ticketCount, openTicketCount, schools] = await Promise.all([
    db.select({ count: count() }).from(usersTable).where(eq(usersTable.tenantId, tenant.id)),
    db.select({ count: count() }).from(ticketsTable).where(eq(ticketsTable.tenantId, tenant.id)),
    db.select({ count: count() }).from(ticketsTable).where(
      and(eq(ticketsTable.tenantId, tenant.id), sql`${ticketsTable.status} NOT IN ('resuelto', 'cerrado')`)
    ),
    getTenantSchools(tenant.id),
  ]);

  res.json({
    ...tenant,
    quickLinks: parseQuickLinks(tenant.quickLinks),
    schools,
    totalUsers: Number(userCount[0]?.count ?? 0),
    totalTickets: Number(ticketCount[0]?.count ?? 0),
    openTickets: Number(openTicketCount[0]?.count ?? 0),
  });
});

router.patch("/:tenantId", requireAuth, requireRole("superadmin", "admin_cliente", "tecnico", "manager"), async (req, res) => {
  const tenantId = Number(req.params["tenantId"]);
  const authUser = (req as any).user;

  if (authUser.role === "admin_cliente" && authUser.tenantId !== tenantId) {
    res.status(403).json({ error: "Forbidden", message: "Access denied" });
    return;
  }

  const parsed = updateTenantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: parsed.error.message });
    return;
  }

  const tenants = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  const old = tenants[0];
  if (!old) {
    res.status(404).json({ error: "NotFound", message: "Tenant not found" });
    return;
  }

  const updateValues: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.quickLinks !== undefined) {
    updateValues["quickLinks"] = stringifyDbJson(parsed.data.quickLinks);
  }
  delete updateValues["schools"];

  await db
    .update(tenantsTable)
    .set(updateValues as any)
    .where(eq(tenantsTable.id, tenantId));

  const externalApiProvisioning = parsed.data.schools
    ? await syncTenantSchools({ id: tenantId, slug: old.slug }, parsed.data.schools)
    : [];

  const updated = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  const updatedTenant = updated[0];
  if (!updatedTenant) {
    res.status(404).json({ error: "NotFound", message: "Tenant not found after update" });
    return;
  }

  await createAuditLog({
    action: "update",
    entityType: "tenant",
    entityId: tenantId,
    userId: authUser.userId,
    tenantId,
    oldValues: old as any,
    newValues: parsed.data,
  });

  const [userCount, ticketCount, openTicketCount, schools] = await Promise.all([
    db.select({ count: count() }).from(usersTable).where(eq(usersTable.tenantId, tenantId)),
    db.select({ count: count() }).from(ticketsTable).where(eq(ticketsTable.tenantId, tenantId)),
    db.select({ count: count() }).from(ticketsTable).where(
      and(eq(ticketsTable.tenantId, tenantId), sql`${ticketsTable.status} NOT IN ('resuelto', 'cerrado')`)
    ),
    getTenantSchools(tenantId),
  ]);

  res.json({
    ...updatedTenant,
    quickLinks: parseQuickLinks(updatedTenant.quickLinks),
    schools,
    externalApiProvisioning,
    totalUsers: Number(userCount[0]?.count ?? 0),
    totalTickets: Number(ticketCount[0]?.count ?? 0),
    openTickets: Number(openTicketCount[0]?.count ?? 0),
  });
});

router.post("/:tenantId/schools/:schoolId/external-api/regenerate", requireAuth, requireRole("superadmin", "tecnico"), async (req, res) => {
  const tenantId = Number(req.params["tenantId"]);
  const schoolId = Number(req.params["schoolId"]);
  const authUser = (req as any).user;
  const parsed = regenerateSchoolExternalApiSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: parsed.error.message });
    return;
  }

  const tenantRows = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  const tenant = tenantRows[0];
  if (!tenant) {
    res.status(404).json({ error: "NotFound", message: "Tenant not found" });
    return;
  }

  const schoolRows = await db
    .select()
    .from(schoolsTable)
    .where(and(eq(schoolsTable.id, schoolId), eq(schoolsTable.tenantId, tenantId)))
    .limit(1);

  const school = schoolRows[0];
  if (!school) {
    res.status(404).json({ error: "NotFound", message: "School not found" });
    return;
  }

  const clientId = school.externalApiClientId || buildSchoolExternalClientId(tenant.slug, school.slug);
  const apiKey = generateExternalApiKey();

  await db
    .update(schoolsTable)
    .set({
      externalApiEnabled: true,
      externalApiClientId: clientId,
      externalApiKeyHash: await hashPassword(apiKey),
      externalApiKeyCreatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schoolsTable.id, schoolId));

  await createAuditLog({
    action: "regenerate_external_api_key",
    entityType: "school",
    entityId: schoolId,
    userId: authUser.userId,
    tenantId,
    newValues: {
      schoolName: school.name,
      clientId,
    },
  });

  res.json({
    schoolId,
    schoolName: school.name,
    clientId,
    apiKey,
    tenantId,
    examplePayload: buildExternalIntegrationExample(clientId),
  });
});

export default router;
