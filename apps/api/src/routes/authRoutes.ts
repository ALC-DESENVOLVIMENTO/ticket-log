import type { FastifyInstance } from "fastify";
import { generateSecret, generateURI } from "otplib";
import QRCode from "qrcode";
import {
  createAuthSession,
  enableUserMfa,
  findUserByEmail,
  getUserContext,
  listUsers,
  revokeAuthSession,
  resetUserMfa,
  setUserMfaSecret,
  updateUserAdmin,
  upsertUser,
} from "@ticketlog/db";
import { config } from "../config.js";
import { getAuthenticatedUser } from "../auth.js";
import { verifyTotpCode } from "../mfa.js";
import { assertCanManageUsers, resolveAccessProfile } from "../roles.js";
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

function publicUser(user: Awaited<ReturnType<typeof getUserContext>> extends infer T ? Exclude<T, null> : never) {
  const access = resolveAccessProfile(user);
  return {
    id: user.id,
    name: user.name,
    email: user.corporate_email,
    roles: user.roles,
    operationScope: user.operation_scope ?? "GERAL",
    cpfMasked: user.cpf_last4 ? `***.***.***-${user.cpf_last4.slice(-2)}` : null,
    mfaEnabled: Boolean(user.mfa_enabled),
    access,
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
      if (!verifyTotpCode({ token: body.totpCode, secret })) {
        return reply.code(401).send({ error: "INVALID_MFA_CODE" });
      }
    }

    const sessionToken = await issueSession(request, user.id);
    const context = await getUserContext(user.id);
    if (!context) {
      return reply.code(404).send({ error: "USER_NOT_FOUND" });
    }
    return {
      sessionToken,
      requiresMfaSetup: !user.mfa_enabled,
      user: publicUser(context),
    };
  });

  app.get("/auth/me", async (request) => {
    const authUser = await getAuthenticatedUser(request);
    const user = await getUserContext(authUser.id);
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
    const user = await getUserContext(authUser.id);
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
    const user = await getUserContext(authUser.id);
    if (!user?.mfa_secret_encrypted) {
      return reply.code(409).send({ error: "MFA_SETUP_NOT_STARTED" });
    }

    const secret = decryptText(user.mfa_secret_encrypted);
    if (!body.code) {
      return reply.code(401).send({ error: "INVALID_MFA_CODE" });
    }

    if (!verifyTotpCode({ token: body.code, secret })) {
      return reply.code(401).send({ error: "INVALID_MFA_CODE" });
    }

    await enableUserMfa(user.id);
    return { ok: true };
  });

  app.get("/admin/users", async (request) => {
    const authUser = await getAuthenticatedUser(request);
    const user = await getUserContext(authUser.id);
    if (!user) throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 404 });
    assertCanManageUsers(user);
    return { users: await listUsers() };
  });

  app.post("/admin/users", async (request, reply) => {
    const authUser = await getAuthenticatedUser(request);
    const requester = await getUserContext(authUser.id);
    if (!requester) throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 404 });
    assertCanManageUsers(requester);
    const body = request.body as {
      name?: string;
      employeeNumber?: string;
      corporateEmail?: string;
      cpf?: string;
      operationScope?: string;
      phoneE164?: string;
      password?: string;
      roles?: string[];
    };

    if (!body.name || !body.employeeNumber || !body.corporateEmail || !body.password || !body.cpf) {
      return reply.code(400).send({ error: "MISSING_REQUIRED_USER_FIELDS" });
    }

    const user = await upsertUser({
      name: body.name,
      employeeNumber: body.employeeNumber,
      corporateEmail: body.corporateEmail,
      cpf: body.cpf,
      operationScope: body.operationScope,
      phoneE164: body.phoneE164,
      passwordHash: await hashPassword(body.password),
      roles: body.roles,
    });

    const context = await getUserContext(user.id);
    if (!context) throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 404 });
    return { user: publicUser(context) };
  });

  app.patch("/admin/users/:userId", async (request, reply) => {
    const authUser = await getAuthenticatedUser(request);
    const requester = await getUserContext(authUser.id);
    if (!requester) throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 404 });
    assertCanManageUsers(requester);

    const params = request.params as { userId: string };
    const body = request.body as {
      name?: string;
      employeeNumber?: string;
      corporateEmail?: string;
      operationScope?: string;
      phoneE164?: string;
      password?: string;
      roles?: string[];
    };

    if (!body.name || !body.employeeNumber || !body.corporateEmail) {
      return reply.code(400).send({ error: "MISSING_REQUIRED_USER_FIELDS" });
    }

    const user = await updateUserAdmin({
      userId: params.userId,
      name: body.name,
      employeeNumber: body.employeeNumber,
      corporateEmail: body.corporateEmail,
      operationScope: body.operationScope,
      phoneE164: body.phoneE164,
      passwordHash: body.password ? await hashPassword(body.password) : undefined,
      roles: body.roles,
    });

    const context = await getUserContext(user.id);
    if (!context) throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 404 });
    return { user: publicUser(context) };
  });

  app.post("/admin/users/:userId/reset-mfa", async (request) => {
    const authUser = await getAuthenticatedUser(request);
    const requester = await getUserContext(authUser.id);
    if (!requester) throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 404 });
    assertCanManageUsers(requester);

    const params = request.params as { userId: string };
    await resetUserMfa(params.userId);
    return { ok: true };
  });
}
