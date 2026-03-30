import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { usersTable, tenantsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  requireAuth,
  verifyPassword,
  createSession,
  deleteSession,
  SESSION_COOKIE,
} from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: "Invalid request body" });
    return;
  }
  const { email, password } = parsed.data;

  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  const user = users[0];
  if (!user || !user.active) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid credentials" });
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid credentials" });
    return;
  }

  // Update last login
  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

  const sessionToken = await createSession(user.id);

  res.cookie(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  let tenantName: string | null = null;
  let tenantSlug: string | null = null;
  if (user.tenantId) {
    const tenants = await db
      .select({ name: tenantsTable.name, slug: tenantsTable.slug })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, user.tenantId))
      .limit(1);
    tenantName = tenants[0]?.name ?? null;
    tenantSlug = tenants[0]?.slug ?? null;
  }

  await createAuditLog({
    action: "login",
    entityType: "user",
    entityId: user.id,
    userId: user.id,
    tenantId: user.tenantId,
  });

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId ?? null,
    tenantName,
    tenantSlug,
    active: user.active,
    createdAt: user.createdAt,
  });
});

router.post("/logout", requireAuth, async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    await deleteSession(token);
  }
  res.clearCookie(SESSION_COOKIE);
  res.json({ message: "Logged out" });
});

router.get("/me", requireAuth, async (req, res) => {
  const authUser = (req as any).user;
  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, authUser.userId))
    .limit(1);

  const user = users[0];
  if (!user) {
    res.status(401).json({ error: "Unauthorized", message: "User not found" });
    return;
  }

  let tenantName: string | null = null;
  let tenantSlug: string | null = null;
  if (user.tenantId) {
    const tenants = await db
      .select({ name: tenantsTable.name, slug: tenantsTable.slug })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, user.tenantId))
      .limit(1);
    tenantName = tenants[0]?.name ?? null;
    tenantSlug = tenants[0]?.slug ?? null;
  }

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId ?? null,
    tenantName,
    tenantSlug,
    active: user.active,
    createdAt: user.createdAt,
  });
});

export default router;
