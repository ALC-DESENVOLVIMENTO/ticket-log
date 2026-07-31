import type { FastifyInstance } from "fastify";
import {
  appendMaskedAuditEvent,
  getUserContext,
  listWhatsappMessages,
  listWhatsappSessionsByScope,
  recordWhatsappMessage,
  reopenWhatsappSession,
} from "@ticketlog/db";
import { createWhatsappProvider } from "@ticketlog/whatsapp";
import { getAuthenticatedUser } from "../auth.js";
import { config } from "../config.js";
import { resolveAccessProfile } from "../roles.js";

const whatsappProvider = createWhatsappProvider({
  apiBaseUrl: config.whatsappApiBaseUrl,
  phoneNumberId: config.whatsappPhoneNumberId,
  accessToken: config.whatsappAccessToken,
});

function maskPhone(phoneE164: string): string {
  if (phoneE164.length <= 4) return "****";
  return `${phoneE164.slice(0, Math.max(0, phoneE164.length - 4))}****`;
}

function sessionExpiry(): Date {
  return new Date(Date.now() + config.whatsappSessionExpiryMinutes * 60_000);
}

async function requireCoordinatorOrAdmin(request: Parameters<typeof getAuthenticatedUser>[0]) {
  const authUser = await getAuthenticatedUser(request);
  const user = await getUserContext(authUser.id);
  if (!user) {
    throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 404 });
  }
  const access = resolveAccessProfile(user);
  if (!access.canApproveRequests) {
    throw Object.assign(new Error("WHATSAPP_SESSION_ACCESS_DENIED"), { statusCode: 403 });
  }
  return { user, access };
}

async function requireDevOrAdmin(request: Parameters<typeof getAuthenticatedUser>[0]) {
  const authUser = await getAuthenticatedUser(request);
  const user = await getUserContext(authUser.id);
  if (!user) {
    throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 404 });
  }
  const access = resolveAccessProfile(user);
  if (!access.canManageUsers) {
    throw Object.assign(new Error("WHATSAPP_MESSAGES_ACCESS_DENIED"), { statusCode: 403 });
  }
  return { user, access };
}

function sanitizeWhatsappBody(body: string | null): string {
  if (!body) return "";
  return body
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "***.***.***-**")
    .replace(/\b\d{6}\b/g, "******");
}

export async function whatsappSessionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/operations/whatsapp/sessions", async (request) => {
    const { user, access } = await requireCoordinatorOrAdmin(request);
    const query = request.query as { limit?: string };
    const limit = Math.max(1, Math.min(query.limit ? Number(query.limit) : 30, 100));
    const sessions = await listWhatsappSessionsByScope({
      operationScope: user.operation_scope,
      includeScope: access.canViewScopeRequests,
      authenticatedUserId: access.canViewScopeRequests ? undefined : user.id,
      limit,
    });

    return {
      sessions: sessions.map((session) => ({
        phoneE164: session.phone_e164,
        phoneMasked: maskPhone(session.phone_e164),
        state: session.state,
        authenticatedUserId: session.authenticated_user_id,
        authenticatedUserName: session.authenticated_user_name,
        authenticatedUserEmail: session.authenticated_user_email,
        operationScope:
          session.authenticated_user_scope ??
          String((session.metadata?.operationScope as string | undefined) ?? "GERAL"),
        activeRequestId: session.active_request_id,
        pendingVehiclePlate: session.pending_vehicle_plate,
        pendingAmountCents: session.pending_amount_cents,
        lockedUntil: session.locked_until,
        authenticatedAt: session.authenticated_at,
        expiresAt: session.expires_at,
        lastInteractionAt: session.last_interaction_at,
        updatedAt: session.updated_at,
      })),
    };
  });

  app.get("/admin/whatsapp/messages", async (request) => {
    await requireDevOrAdmin(request);
    const query = request.query as { limit?: string; phoneE164?: string; requestId?: string };
    const messages = await listWhatsappMessages({
      limit: query.limit ? Number(query.limit) : 150,
      phoneE164: query.phoneE164,
      requestId: query.requestId,
    });

    return {
      messages: messages.map((message) => ({
        id: message.id,
        providerMessageId: message.provider_message_id,
        phoneE164: message.phone_e164,
        direction: message.direction,
        requestId: message.request_id,
        protocol: message.request_protocol,
        vehiclePlate: message.vehicle_plate,
        requestStatus: message.request_status,
        authenticatedUserName: message.authenticated_user_name,
        body: sanitizeWhatsappBody(message.body),
        receivedAt: message.received_at,
      })),
    };
  });

  app.post("/operations/whatsapp/sessions/:phone/reopen", async (request, reply) => {
    const { user } = await requireCoordinatorOrAdmin(request);
    const params = request.params as { phone: string };
    const phoneE164 = decodeURIComponent(params.phone);
    const session = await reopenWhatsappSession({
      phoneE164,
      expiresAt: sessionExpiry(),
    });
    if (!session) {
      return reply.code(404).send({ error: "WHATSAPP_SESSION_NOT_FOUND" });
    }

    const sent = await whatsappProvider.sendTextMessage({
      toPhoneE164: phoneE164,
      body: "Sua sessao de atendimento foi reaberta. Envie seu CPF para autenticar novamente.",
    });
    await recordWhatsappMessage({
      providerMessageId: sent.providerMessageId ?? undefined,
      phoneE164,
      direction: "out",
      requestId: session.active_request_id ?? undefined,
      body: "Sua sessao de atendimento foi reaberta. Envie seu CPF para autenticar novamente.",
    });
    await appendMaskedAuditEvent({
      actorUserId: user.id,
      requestId: session.active_request_id ?? undefined,
      eventType: "WHATSAPP_SESSION_REOPENED",
      payload: { state: session.state },
      phoneE164,
    });

    return {
      ok: true,
      session: {
        phoneE164: session.phone_e164,
        state: session.state,
        expiresAt: session.expires_at,
      },
    };
  });
}
