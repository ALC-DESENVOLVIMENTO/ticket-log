import type { FastifyInstance } from "fastify";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import {
  createAuthSession,
  enableUserMfa,
  findUserByEmail,
  findUserById,
  listUsers,
  revokeAuthSession,
  setUserMfaSecret,
  upsertUser,
} from "@ticketlog/db";
import { config } from "../config.js";
import { getAuthenticatedUser } from "../auth.js";
import {
  createOpaqueToken,
  decryptText,
  encryptText,
  hashPassword,
  hashToken,
  verifyPassword,
} from "../security.js";

function sessionExpiresAt(): Date {
  return new Date(Date.now() + 12 * 60 * 60_000);
}

function publicUser(user: { id: string; name: string; corporate_email: string; mfa_enabled?: boolean }) {
  return {
    id: user.id,
    name: user.name,
    email: user.corporate_email,
    mfaEnabled: Boolean(user.mfa_enabled),
  };
}

async function issueSession(request: any, userId: string): Promise<string> {
  const token = createOpaqueToken();
  await createAuthSession({
    userId,
    tokenHash: hashToken(token),
    userAgent: request.headers["user-agent"],
    ipAddress: request.ip,
    expiresAt: sessionExpiresAt(),
  });
  return token;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/login", async (request, reply) => {
    const body = request.body as { email?: string; password?: string; totpCode?: string };
    const user = body.email ? await findUserByEmail(body.email) : null;
    if (!user || !(await verifyPassword(String(body.password ?? ""), user.password_hash))) {
      return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    }

    if (user.mfa_enabled) {
      if (!body.totpCode || !user.mfa_secret_encrypted) {
        return reply.code(202).send({ mfaRequired: true });
      }

      const secret = decryptText(user.mfa_secret_encrypted);
      const result = await verify({ token: body.totpCode, secret });
      if (!result.valid) {
        return reply.code(401).send({ error: "INVALID_MFA_CODE" });
      }
    }

    const sessionToken = await issueSession(request, user.id);
    return {
      sessionToken,
      requiresMfaSetup: !user.mfa_enabled,
      user: publicUser(user),
    };
  });

  app.get("/auth/me", async (request) => {
    const authUser = await getAuthenticatedUser(request);
    const user = await findUserById(authUser.id);
    if (!user) throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 404 });
    return { user: publicUser(user) };
  });

  app.post("/auth/logout", async (request) => {
    const authorization = request.headers.authorization;
    if (authorization?.startsWith("Bearer ")) {
      await revokeAuthSession(hashToken(authorization.slice("Bearer ".length)));
    }
    return { ok: true };
  });

  app.post("/auth/mfa/setup", async (request) => {
    const authUser = await getAuthenticatedUser(request);
    const user = await findUserById(authUser.id);
    if (!user) throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 404 });

    const secret = generateSecret();
    await setUserMfaSecret(user.id, encryptText(secret));

    const otpauthUrl = generateURI({ issuer: config.companyName, label: user.corporate_email, secret });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
    return { secret, otpauthUrl, qrCodeDataUrl };
  });

  app.post("/auth/mfa/verify", async (request, reply) => {
    const authUser = await getAuthenticatedUser(request);
    const body = request.body as { code?: string };
    const user = await findUserById(authUser.id);
    if (!user?.mfa_secret_encrypted) {
      return reply.code(409).send({ error: "MFA_SETUP_NOT_STARTED" });
    }

    const secret = decryptText(user.mfa_secret_encrypted);
    if (!body.code) {
      return reply.code(401).send({ error: "INVALID_MFA_CODE" });
    }

    const result = await verify({ token: body.code, secret });
    if (!result.valid) {
      return reply.code(401).send({ error: "INVALID_MFA_CODE" });
    }

    await enableUserMfa(user.id);
    return { ok: true };
  });

  app.get("/admin/users", async (request) => {
    await getAuthenticatedUser(request);
    return { users: await listUsers() };
  });

  app.post("/admin/users", async (request, reply) => {
    await getAuthenticatedUser(request);
    const body = request.body as {
      name?: string;
      employeeNumber?: string;
      corporateEmail?: string;
      phoneE164?: string;
      password?: string;
      roles?: string[];
    };

    if (!body.name || !body.employeeNumber || !body.corporateEmail || !body.password) {
      return reply.code(400).send({ error: "MISSING_REQUIRED_USER_FIELDS" });
    }

    const user = await upsertUser({
      name: body.name,
      employeeNumber: body.employeeNumber,
      corporateEmail: body.corporateEmail,
      phoneE164: body.phoneE164,
      passwordHash: await hashPassword(body.password),
      roles: body.roles,
    });

    return { user: publicUser(user) };
  });
}
