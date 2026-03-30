import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db } from "@workspace/db";
import { sessionsTable, usersTable } from "@workspace/db/schema";
import { eq, and, gt } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

export async function createSession(userId: number): Promise<string> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  await db.insert(sessionsTable).values({ sessionToken: token, userId, expiresAt });
  return token;
}

export async function getSessionUser(token: string) {
  const result = await db
    .select({
      userId: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      role: usersTable.role,
      tenantId: usersTable.tenantId,
      active: usersTable.active,
    })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(and(eq(sessionsTable.sessionToken, token), gt(sessionsTable.expiresAt, new Date())))
    .limit(1);
  return result[0] ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.sessionToken, token));
}

export const SESSION_COOKIE = "session";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: "Unauthorized", message: "Not authenticated" });
    return;
  }
  const user = await getSessionUser(token);
  if (!user || !user.active) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid or expired session" });
    return;
  }
  (req as any).user = user;
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: "Forbidden", message: "Insufficient permissions" });
      return;
    }
    next();
  };
}
