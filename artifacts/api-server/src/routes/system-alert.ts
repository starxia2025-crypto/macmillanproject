import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { systemAlertsTable, usersTable } from "@workspace/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";

const router = Router();

const upsertSystemAlertSchema = z.object({
  title: z.string().trim().min(1),
  message: z.string().trim().min(1),
  active: z.boolean(),
  type: z.enum(["info", "warning", "urgent"]).optional(),
});

async function getLatestSystemAlert() {
  const alerts = await db
    .select({
      id: systemAlertsTable.id,
      title: systemAlertsTable.title,
      message: systemAlertsTable.message,
      type: systemAlertsTable.type,
      active: systemAlertsTable.active,
      createdById: systemAlertsTable.createdById,
      updatedById: systemAlertsTable.updatedById,
      createdAt: systemAlertsTable.createdAt,
      updatedAt: systemAlertsTable.updatedAt,
      updatedByName: usersTable.name,
    })
    .from(systemAlertsTable)
    .leftJoin(usersTable, eq(systemAlertsTable.updatedById, usersTable.id))
    .orderBy(desc(systemAlertsTable.updatedAt), desc(systemAlertsTable.id))
    .limit(1);

  return alerts[0] ?? null;
}

router.get("/", requireAuth, async (_req, res) => {
  const alert = await getLatestSystemAlert();
  res.json(alert);
});

router.get("/active", requireAuth, async (_req, res) => {
  const alert = await getLatestSystemAlert();
  res.json(alert?.active ? alert : null);
});

router.put("/", requireAuth, requireRole("superadmin", "tecnico"), async (req, res) => {
  const authUser = (req as any).user;
  const parsed = upsertSystemAlertSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: parsed.error.message });
    return;
  }

  const current = await getLatestSystemAlert();

  if (current) {
    await db
      .update(systemAlertsTable)
      .set({
        title: parsed.data.title,
        message: parsed.data.message,
        type: parsed.data.type ?? "warning",
        active: parsed.data.active,
        updatedById: authUser.userId,
        updatedAt: new Date(),
      })
      .where(eq(systemAlertsTable.id, current.id));

    await createAuditLog({
      action: "update",
      entityType: "system_alert",
      entityId: current.id,
      userId: authUser.userId,
      tenantId: authUser.tenantId ?? null,
      oldValues: {
        title: current.title,
        message: current.message,
        type: current.type,
        active: current.active,
      },
      newValues: parsed.data,
    });
  } else {
    await db.insert(systemAlertsTable).values({
      title: parsed.data.title,
      message: parsed.data.message,
      type: parsed.data.type ?? "warning",
      active: parsed.data.active,
      createdById: authUser.userId,
      updatedById: authUser.userId,
    });

    const created = await getLatestSystemAlert();
    if (created) {
      await createAuditLog({
        action: "create",
        entityType: "system_alert",
        entityId: created.id,
        userId: authUser.userId,
        tenantId: authUser.tenantId ?? null,
        newValues: parsed.data,
      });
    }
  }

  const alert = await getLatestSystemAlert();
  res.json(alert);
});

export default router;
