import type { FastifyRequest } from "fastify";
import { findUserBySessionTokenHash } from "@ticketlog/db";
import { hashToken } from "./security.js";

export interface AuthenticatedUser {
  id: string;
  email?: string;
  name?: string;
}

export async function getAuthenticatedUser(request: FastifyRequest): Promise<AuthenticatedUser> {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length);
    const user = await findUserBySessionTokenHash(hashToken(token));
    if (!user) {
      throw Object.assign(new Error("INVALID_SESSION"), { statusCode: 401 });
    }

    return {
      id: user.id,
      email: user.corporate_email,
      name: user.name,
    };
  }

  if (process.env.AUTH_MODE !== "development-header") {
    throw Object.assign(new Error("AUTHENTICATION_REQUIRED"), { statusCode: 401 });
  }

  const userId = request.headers["x-user-id"];
  if (!userId || Array.isArray(userId)) {
    throw Object.assign(new Error("AUTHENTICATION_REQUIRED"), { statusCode: 401 });
  }

  return {
    id: userId,
    email: String(request.headers["x-user-email"] ?? ""),
    name: String(request.headers["x-user-name"] ?? ""),
  };
}
