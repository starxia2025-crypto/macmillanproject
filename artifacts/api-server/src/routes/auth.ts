import { Router } from "express";
import type { Request, Response } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { db } from "@workspace/db";
import { schoolsTable, ticketsTable, usersTable, tenantsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import {
  requireAuth,
  verifyPassword,
  hashPassword,
  createSession,
  deleteSession,
  SESSION_COOKIE,
} from "../lib/auth.js";
import { createAuditLog } from "../lib/audit.js";
import { parseDbJson } from "../lib/db-json.js";
import { logger } from "../lib/logger.js";

const router = Router();
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 15;
const CAPTCHA_REQUIRED_FAILED_ATTEMPTS = 3;
const CAPTCHA_EXPIRES_MINUTES = 5;
const INVALID_CREDENTIALS_MESSAGE = "Credenciales no validas";
const MIN_PASSWORD_LENGTH = 12;
const RESET_PASSWORD_EXPIRES_MINUTES = 30;

function useSecureSessionCookie() {
  return process.env.COOKIE_SECURE === "true";
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  captchaToken: z.string().optional(),
  captchaAnswer: z.string().optional(),
});

const changePasswordSchema = z.object({
  password: z.string().min(MIN_PASSWORD_LENGTH),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(MIN_PASSWORD_LENGTH),
});

const supportContactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  schoolName: z.string().trim().max(160).optional().or(z.literal("")),
  subject: z.string().trim().max(160).optional().or(z.literal("")),
  message: z.string().trim().min(10).max(2000),
});

function getClientIp(req: Request) {
  return (req.ip || req.socket.remoteAddress || "unknown").toString();
}

function getCaptchaSecret() {
  return process.env.CAPTCHA_SECRET || process.env.SESSION_SECRET || "helpdesk-local-captcha-secret";
}

function hashResetToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function buildResetPasswordUrl(req: Request, token: string) {
  const frontendUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.headers.host}/`;
  return `${frontendUrl.replace(/\/?$/, "/")}reset-password?token=${encodeURIComponent(token)}`;
}

function generateTicketNumber() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `TKT-${timestamp}-${random}`;
}

function signCaptchaPayload(payload: string) {
  return crypto.createHmac("sha256", getCaptchaSecret()).update(payload).digest("base64url");
}

function createCaptchaChallenge() {
  const left = crypto.randomInt(2, 10);
  const right = crypto.randomInt(2, 10);
  const payload = Buffer.from(JSON.stringify({
    answer: left + right,
    expiresAt: Date.now() + CAPTCHA_EXPIRES_MINUTES * 60 * 1000,
    nonce: crypto.randomBytes(12).toString("hex"),
  })).toString("base64url");

  return {
    question: `${left} + ${right}`,
    token: `${payload}.${signCaptchaPayload(payload)}`,
  };
}

function verifyCaptcha(token?: string, answer?: string) {
  if (!token || !answer) return false;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expectedSignature = signCaptchaPayload(payload);
  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return false;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { answer?: number; expiresAt?: number };
    if (!parsed.expiresAt || parsed.expiresAt < Date.now()) return false;
    return Number(answer.trim()) === parsed.answer;
  } catch {
    return false;
  }
}

function sendInvalidLoginResponse(res: Response, status: number, captchaRequired = false) {
  res.status(status).json({
    error: status === 429 ? "LoginTemporarilyLocked" : "Unauthorized",
    message: INVALID_CREDENTIALS_MESSAGE,
    captchaRequired,
    captcha: captchaRequired ? createCaptchaChallenge() : undefined,
  });
}

async function resolveSupportContactScope(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const matchedUsers = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      tenantId: usersTable.tenantId,
      schoolId: usersTable.schoolId,
      active: usersTable.active,
    })
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail))
    .limit(1);

  const matchedUser = matchedUsers[0];
  if (matchedUser?.active && matchedUser.tenantId) {
    return {
      tenantId: matchedUser.tenantId,
      schoolId: matchedUser.schoolId ?? null,
      createdById: matchedUser.id,
      requesterName: matchedUser.name,
    };
  }

  const envTenantId = Number(process.env["SUPPORT_CONTACT_TENANT_ID"] || "");
  const envSchoolId = Number(process.env["SUPPORT_CONTACT_SCHOOL_ID"] || "");
  const envFallbackUserId = Number(process.env["SUPPORT_CONTACT_FALLBACK_USER_ID"] || "");

  if (!Number.isNaN(envFallbackUserId) && envFallbackUserId > 0) {
    const fallbackUsers = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        tenantId: usersTable.tenantId,
        schoolId: usersTable.schoolId,
        active: usersTable.active,
      })
      .from(usersTable)
      .where(eq(usersTable.id, envFallbackUserId))
      .limit(1);

    const fallbackUser = fallbackUsers[0];
    if (fallbackUser?.active && (fallbackUser.tenantId || envTenantId > 0)) {
      return {
        tenantId: fallbackUser.tenantId ?? envTenantId,
        schoolId: !Number.isNaN(envSchoolId) && envSchoolId > 0 ? envSchoolId : (fallbackUser.schoolId ?? null),
        createdById: fallbackUser.id,
        requesterName: matchedUser?.name ?? null,
      };
    }
  }

  const supportUsers = await db
    .select({
      id: usersTable.id,
      tenantId: usersTable.tenantId,
      schoolId: usersTable.schoolId,
    })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.active, true),
        eq(usersTable.role, "tecnico"),
      ),
    )
    .limit(1);

  const supportUser = supportUsers[0];
  if (supportUser?.tenantId) {
    return {
      tenantId: supportUser.tenantId,
      schoolId: !Number.isNaN(envSchoolId) && envSchoolId > 0 ? envSchoolId : (supportUser.schoolId ?? null),
      createdById: supportUser.id,
      requesterName: matchedUser?.name ?? null,
    };
  }

  if (!Number.isNaN(envTenantId) && envTenantId > 0 && !Number.isNaN(envFallbackUserId) && envFallbackUserId > 0) {
    return {
      tenantId: envTenantId,
      schoolId: !Number.isNaN(envSchoolId) && envSchoolId > 0 ? envSchoolId : null,
      createdById: envFallbackUserId,
      requesterName: matchedUser?.name ?? null,
    };
  }

  return null;
}

async function createLoginAccessTicket(input: {
  email: string;
  subject: string;
  message: string;
  requesterName?: string | null;
  requesterPhone?: string | null;
  requesterSchoolName?: string | null;
  source: "login_support_contact" | "forgot_password";
  category: "contacto_soporte_login" | "recuperacion_contrasena_login";
  ip: string;
}) {
  const scope = await resolveSupportContactScope(input.email);
  if (!scope?.tenantId) {
    logger.error(
      { requesterEmail: input.email.toLowerCase(), source: input.source, ip: input.ip },
      "Login access ticket scope could not be resolved",
    );
    return null;
  }

  const ticketNumber = generateTicketNumber();
  const description = [
    input.source === "forgot_password"
      ? "Solicitud de recuperacion de contrasena creada desde la pantalla de acceso de Bridge."
      : "Solicitud creada desde la pantalla de acceso de Bridge.",
    "",
    `Nombre: ${input.requesterName || "-"}`,
    `Email: ${input.email.toLowerCase()}`,
    `Telefono: ${input.requesterPhone || "-"}`,
    `Colegio o centro: ${input.requesterSchoolName || "-"}`,
    "",
    "Mensaje:",
    input.message,
  ].join("\n");

  await db.insert(ticketsTable).values({
    ticketNumber,
    title: `[Acceso] ${input.subject}`,
    description,
    status: "nuevo",
    priority: "media",
    category: input.category,
    tenantId: scope.tenantId,
    schoolId: scope.schoolId ?? null,
    createdById: scope.createdById,
    customFields: JSON.stringify({
      source: input.source,
      requesterName: input.requesterName || null,
      requesterEmail: input.email.toLowerCase(),
      requesterPhone: input.requesterPhone || null,
      requesterSchoolName: input.requesterSchoolName || null,
      submittedAt: new Date().toISOString(),
    }),
  } as any);

  const createdTickets = await db
    .select({ id: ticketsTable.id })
    .from(ticketsTable)
    .where(eq(ticketsTable.ticketNumber, ticketNumber))
    .limit(1);

  const createdTicket = createdTickets[0];
  if (createdTicket) {
    await createAuditLog({
      action: "create",
      entityType: "ticket",
      entityId: createdTicket.id,
      userId: scope.createdById,
      tenantId: scope.tenantId,
      newValues: {
        source: input.source,
        requesterEmail: input.email.toLowerCase(),
        requesterName: input.requesterName || null,
      },
    });
  }

  logger.info(
    { requesterEmail: input.email.toLowerCase(), ticketNumber, tenantId: scope.tenantId, source: input.source, ip: input.ip },
    "Login access ticket created",
  );

  return { ticketNumber };
}

async function auditLoginSecurityEvent(params: {
  action: string;
  user?: typeof usersTable.$inferSelect;
  email: string;
  ip: string;
  newValues?: Record<string, unknown>;
}) {
  if (params.user) {
    await createAuditLog({
      action: params.action,
      entityType: "user",
      entityId: params.user.id,
      userId: params.user.id,
      tenantId: params.user.tenantId,
      newValues: {
        email: params.email,
        ip: params.ip,
        ...(params.newValues ?? {}),
      },
    });
    return;
  }

  logger.warn({ action: params.action, email: params.email, ip: params.ip }, "Login security event without user");
}

async function buildUserResponse(user: typeof usersTable.$inferSelect) {
  let tenantName: string | null = null;
  let tenantSlug: string | null = null;
  let tenantPrimaryColor: string | null = null;
  let tenantSidebarBackgroundColor: string | null = null;
  let tenantSidebarTextColor: string | null = null;
  let tenantLogoUrl: string | null = null;
  let tenantHasMochilasAccess = false;
  let tenantHasOrderLookup = false;
  let tenantHasReturnsAccess = false;
  let tenantQuickLinks: Array<{ label: string; url: string; icon: string }> = [];
  let schoolName: string | null = null;

  if (user.schoolId) {
    const schools = await db
      .select({ name: schoolsTable.name })
      .from(schoolsTable)
      .where(eq(schoolsTable.id, user.schoolId))
      .limit(1);

    schoolName = schools[0]?.name ?? null;
  }

  if (user.tenantId) {
    const tenants = await db
      .select({
        name: tenantsTable.name,
        slug: tenantsTable.slug,
        primaryColor: tenantsTable.primaryColor,
        sidebarBackgroundColor: tenantsTable.sidebarBackgroundColor,
        sidebarTextColor: tenantsTable.sidebarTextColor,
        logoUrl: tenantsTable.logoUrl,
        hasMochilasAccess: tenantsTable.hasMochilasAccess,
        hasOrderLookup: tenantsTable.hasOrderLookup,
        hasReturnsAccess: tenantsTable.hasReturnsAccess,
        quickLinks: tenantsTable.quickLinks,
      })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, user.tenantId))
      .limit(1);

    tenantName = tenants[0]?.name ?? null;
    tenantSlug = tenants[0]?.slug ?? null;
    tenantPrimaryColor = tenants[0]?.primaryColor ?? null;
    tenantSidebarBackgroundColor = tenants[0]?.sidebarBackgroundColor ?? null;
    tenantSidebarTextColor = tenants[0]?.sidebarTextColor ?? null;
    tenantLogoUrl = tenants[0]?.logoUrl ?? null;
    tenantHasMochilasAccess = tenants[0]?.hasMochilasAccess ?? false;
    tenantHasOrderLookup = tenants[0]?.hasOrderLookup ?? false;
    tenantHasReturnsAccess = tenants[0]?.hasReturnsAccess ?? false;
    tenantQuickLinks = parseDbJson<Array<{ label: string; url: string; icon: string }>>(tenants[0]?.quickLinks, []);
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId ?? null,
    schoolId: user.schoolId ?? null,
    schoolName,
    scopeType: user.scopeType,
    tenantName,
    tenantSlug,
    tenantPrimaryColor,
    tenantSidebarBackgroundColor,
    tenantSidebarTextColor,
    tenantLogoUrl,
    tenantHasMochilasAccess,
    tenantHasOrderLookup,
    tenantHasReturnsAccess,
    tenantQuickLinks,
    active: user.active,
    mustChangePassword: user.mustChangePassword ?? false,
    createdAt: user.createdAt,
  };
}

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: "Datos de solicitud no validos" });
    return;
  }

  const { password, captchaAnswer, captchaToken } = parsed.data;
  const email = parsed.data.email.toLowerCase();
  const ip = getClientIp(req);

  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  const user = users[0];
  if (!user || !user.active) {
    await auditLoginSecurityEvent({ action: "login_failed", email, ip });
    sendInvalidLoginResponse(res, 401);
    return;
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await auditLoginSecurityEvent({
      action: "login_blocked",
      user,
      email,
      ip,
      newValues: { lockedUntil: user.lockedUntil },
    });
    sendInvalidLoginResponse(res, 429);
    return;
  }

  const captchaRequired = (user.failedLoginAttempts ?? 0) >= CAPTCHA_REQUIRED_FAILED_ATTEMPTS;
  if (captchaRequired && !verifyCaptcha(captchaToken, captchaAnswer)) {
    await auditLoginSecurityEvent({
      action: "login_captcha_required",
      user,
      email,
      ip,
      newValues: { failedLoginAttempts: user.failedLoginAttempts ?? 0 },
    });
    sendInvalidLoginResponse(res, 401, true);
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const nextAttempts = (user.failedLoginAttempts ?? 0) + 1;
    const lockActivated = nextAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;
    const lockedUntil = lockActivated ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000) : null;

    await db
      .update(usersTable)
      .set({
        failedLoginAttempts: nextAttempts,
        lockedUntil,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id));

    await auditLoginSecurityEvent({
      action: "login_failed",
      user,
      email,
      ip,
      newValues: { failedLoginAttempts: nextAttempts },
    });

    if (lockActivated) {
      await auditLoginSecurityEvent({
        action: "login_locked",
        user,
        email,
        ip,
        newValues: { lockedUntil, failedLoginAttempts: nextAttempts },
      });
    }

    sendInvalidLoginResponse(res, lockActivated ? 429 : 401, !lockActivated && nextAttempts >= CAPTCHA_REQUIRED_FAILED_ATTEMPTS);
    return;
  }

  await db
    .update(usersTable)
    .set({
      lastLoginAt: new Date(),
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, user.id));

  const sessionToken = await createSession(user.id);

  res.cookie(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: useSecureSessionCookie(),
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  await createAuditLog({
    action: "login",
    entityType: "user",
    entityId: user.id,
    userId: user.id,
    tenantId: user.tenantId,
    newValues: { ip },
  });

  res.json(await buildUserResponse(user));
});

router.post("/logout", requireAuth, async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    await deleteSession(token);
  }
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: useSecureSessionCookie(),
    sameSite: "lax",
  });
  res.json({ message: "Sesion cerrada" });
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
    res.status(401).json({ error: "Unauthorized", message: "Usuario no encontrado" });
    return;
  }

  res.json(await buildUserResponse(user));
});

router.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: "La contrasena debe tener al menos 12 caracteres." });
    return;
  }

  const authUser = (req as any).user;
  const users = await db.select().from(usersTable).where(eq(usersTable.id, authUser.userId)).limit(1);
  const user = users[0];
  if (!user) {
    res.status(401).json({ error: "Unauthorized", message: "Usuario no encontrado" });
    return;
  }

  const samePassword = await verifyPassword(parsed.data.password, user.passwordHash);
  if (samePassword) {
    res.status(400).json({ error: "ValidationError", message: "La nueva contrasena debe ser diferente a la temporal." });
    return;
  }

  await db
    .update(usersTable)
    .set({
      passwordHash: await hashPassword(parsed.data.password),
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, user.id));

  await createAuditLog({
    action: "change_password",
    entityType: "user",
    entityId: user.id,
    userId: user.id,
    tenantId: user.tenantId,
    newValues: { ip: getClientIp(req), failedLoginAttempts: 0 },
  });

  res.json({ message: "Contrasena actualizada" });
});

router.post("/forgot-password", async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: "Revisa el correo indicado." });
    return;
  }

  const email = parsed.data.email.toLowerCase();

  try {
    const created = await createLoginAccessTicket({
      email,
      subject: "Recuperacion de contrasena",
      message: "El usuario solicita ayuda para recuperar su contrasena de acceso a Bridge.",
      source: "forgot_password",
      category: "recuperacion_contrasena_login",
      ip: getClientIp(req),
    });

    if (!created) {
      res.status(503).json({ error: "SupportNotConfigured", message: "El servicio de soporte no esta disponible ahora mismo." });
      return;
    }

    res.json({ message: `Tu solicitud se ha registrado correctamente con el numero ${created.ticketNumber}.`, ticketNumber: created.ticketNumber });
  } catch (error) {
    logger.error({ err: error, email, ip: getClientIp(req) }, "Forgot password ticket creation failed");
    res.status(500).json({ error: "InternalServerError", message: "No se pudo registrar tu solicitud en este momento." });
  }
});

router.post("/support-contact", async (req, res) => {
  const parsed = supportContactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: "Revisa los datos del formulario de contacto." });
    return;
  }
  const scope = await resolveSupportContactScope(parsed.data.email);
  if (!scope?.tenantId) {
    logger.error(
      { requesterEmail: parsed.data.email.toLowerCase(), ip: getClientIp(req) },
      "Support contact ticket scope could not be resolved",
    );
    res.status(503).json({ error: "SupportNotConfigured", message: "El servicio de soporte no esta disponible ahora mismo." });
    return;
  }

  try {
    const created = await createLoginAccessTicket({
      email: parsed.data.email.toLowerCase(),
      subject: parsed.data.subject,
      message: parsed.data.message,
      requesterName: parsed.data.name,
      requesterPhone: parsed.data.phone || null,
      requesterSchoolName: parsed.data.schoolName || null,
      source: "login_support_contact",
      category: "contacto_soporte_login",
      ip: getClientIp(req),
    });

    if (!created) {
      res.status(503).json({ error: "SupportNotConfigured", message: "El servicio de soporte no esta disponible ahora mismo." });
      return;
    }

    res.json({ message: `Tu solicitud se ha registrado correctamente con el numero ${created.ticketNumber}.`, ticketNumber: created.ticketNumber });
  } catch (error) {
    logger.error(
      { err: error, requesterEmail: parsed.data.email.toLowerCase(), ip: getClientIp(req) },
      "Support contact ticket creation failed",
    );
    res.status(500).json({ error: "InternalServerError", message: "No se pudo registrar tu solicitud en este momento." });
  }
});

router.post("/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ValidationError", message: "El enlace no es valido o la contrasena no cumple los requisitos." });
    return;
  }

  const tokenHash = hashResetToken(parsed.data.token);
  const users = await db.select().from(usersTable).where(eq(usersTable.resetPasswordTokenHash, tokenHash)).limit(1);
  const user = users[0];

  if (!user || !user.active || !user.resetPasswordExpiresAt || user.resetPasswordExpiresAt < new Date()) {
    res.status(400).json({ error: "ValidationError", message: "El enlace no es valido o ha caducado." });
    return;
  }

  const samePassword = await verifyPassword(parsed.data.password, user.passwordHash);
  if (samePassword) {
    res.status(400).json({ error: "ValidationError", message: "La nueva contrasena debe ser diferente a la anterior." });
    return;
  }

  await db
    .update(usersTable)
    .set({
      passwordHash: await hashPassword(parsed.data.password),
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      resetPasswordTokenHash: null,
      resetPasswordExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, user.id));

  await createAuditLog({
    action: "password_reset_completed",
    entityType: "user",
    entityId: user.id,
    userId: user.id,
    tenantId: user.tenantId,
    newValues: { ip: getClientIp(req) },
  });

  res.json({ message: "Contrasena actualizada" });
});

router.get("/microsoft", (req, res) => {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const tenantId = process.env.MICROSOFT_TENANT_ID || "common";
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI || `${req.protocol}://${req.headers.host}/api/auth/microsoft/callback`;

  if (!clientId) {
    res.status(503).json({
      error: "NotConfigured",
      message: "Microsoft OAuth no esta configurado. Anade MICROSOFT_CLIENT_ID y MICROSOFT_CLIENT_SECRET como variables de entorno.",
    });
    return;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: "openid profile email User.Read",
    state: "helpdesk_ms_login",
  });

  res.redirect(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`);
});

router.get("/microsoft/callback", async (req, res) => {
  const { code, error: oauthError } = req.query as Record<string, string>;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const tenantId = process.env.MICROSOFT_TENANT_ID || "common";
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI || `${req.protocol}://${req.headers.host}/api/auth/microsoft/callback`;
  const frontendUrl = process.env.FRONTEND_URL || "/";

  if (oauthError || !code) {
    res.redirect(`${frontendUrl}?error=microsoft_auth_failed`);
    return;
  }

  if (!clientId || !clientSecret) {
    res.redirect(`${frontendUrl}?error=microsoft_not_configured`);
    return;
  }

  try {
    const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) {
      res.redirect(`${frontendUrl}?error=token_exchange_failed`);
      return;
    }

    const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json() as any;

    const email = (profile.mail || profile.userPrincipalName || "").toLowerCase();
    const name = profile.displayName || email.split("@")[0];

    if (!email) {
      res.redirect(`${frontendUrl}?error=no_email`);
      return;
    }

    const existingUsers = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    let user = existingUsers[0];

    if (!user) {
      await db
        .insert(usersTable)
        .values({
          email,
          name,
          passwordHash: await hashPassword(crypto.randomBytes(32).toString("base64url")),
          role: "usuario_cliente",
          tenantId: null,
          schoolId: null,
          scopeType: "school",
          active: true,
        });

      const createdUsers = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
      user = createdUsers[0];
    }

    if (!user.active) {
      res.redirect(`${frontendUrl}?error=account_inactive`);
      return;
    }

    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

    const sessionToken = await createSession(user.id);
    res.cookie(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: useSecureSessionCookie(),
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    await createAuditLog({
      action: "login_microsoft",
      entityType: "user",
      entityId: user.id,
      userId: user.id,
      tenantId: user.tenantId,
    });

    res.redirect(`${frontendUrl}dashboard`);
  } catch (err) {
    console.error("Microsoft OAuth error:", err);
    res.redirect(`${frontendUrl}?error=server_error`);
  }
});

export default router;
