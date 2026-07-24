import type { FastifyInstance } from "fastify";
import { consumeApprovalToken, getApprovalRequestByToken, getRequest, recordApproval, transitionRequest } from "@ticketlog/db";
import { enqueueLimitRequest } from "@ticketlog/queue";
import { evaluateLimitPolicy } from "@ticketlog/domain";
import { getAuthenticatedUser } from "../auth.js";
import { config } from "../config.js";

async function enqueueIfConfigured(requestId: string): Promise<{ queued: boolean; reason?: string }> {
  if (!process.env.REDIS_URL) return { queued: false, reason: "REDIS_URL_NOT_CONFIGURED" };
  await enqueueLimitRequest(requestId);
  return { queued: true };
}

export async function approvalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/approval/:token", async (request, reply) => {
    const params = request.params as { token: string };
    const found = await getApprovalRequestByToken(params.token);
    if (!found) return reply.code(404).send({ error: "APPROVAL_NOT_FOUND" });

    return {
      request: {
        id: found.id,
        vehiclePlate: found.vehicle_plate,
        vehicleGroup: found.vehicle_group,
        requestedAmount: found.requested_amount,
        requesterName: found.requester_name,
        requesterEmail: found.requester_email,
        status: found.status,
        expiresAt: found.expires_at,
        tokenExpiresAt: found.token_expires_at,
        tokenUsedAt: found.token_used_at,
      },
    };
  });

  app.post("/approval/:token/approve", async (request, reply) => {
    const user = await getAuthenticatedUser(request);
    const params = request.params as { token: string };
    const requestId = await consumeApprovalToken(params.token, user.id);

    if (!requestId) {
      return reply.code(401).send({ error: "INVALID_OR_EXPIRED_APPROVAL_TOKEN" });
    }

    const found = await getRequest(requestId);
    if (!found) return reply.code(404).send({ error: "REQUEST_NOT_FOUND" });

    if (found.status === "AGUARDANDO_AUTENTICACAO") {
      await transitionRequest(found.id, "AGUARDANDO_APROVACAO", user.id);
    }

    await recordApproval({
      requestId: found.id,
      approverId: user.id,
      level: 1,
      decision: "approved",
    });

    const policy = evaluateLimitPolicy(
      Number(found.requested_amount),
      config.groupPolicies[found.vehicle_group as keyof typeof config.groupPolicies] ??
        config.groupPolicies.GERAL_DE_RESTRICOES,
    );
    if (policy.requiresSecondApproval) {
      await transitionRequest(found.id, "AGUARDANDO_SEGUNDA_APROVACAO", user.id);
      return { status: "AGUARDANDO_SEGUNDA_APROVACAO" };
    }

    await recordApproval({
      requestId: found.id,
      approverId: user.id,
      level: 2,
      decision: "approved",
    });
    await transitionRequest(found.id, "NA_FILA", user.id);
    const queue = await enqueueIfConfigured(found.id);
    return { status: "NA_FILA", queue };
  });

  app.post("/requests/:id/second-approval", async (request, reply) => {
    const user = await getAuthenticatedUser(request);
    const params = request.params as { id: string };
    const found = await getRequest(params.id);
    if (!found) return reply.code(404).send({ error: "REQUEST_NOT_FOUND" });
    if (found.requester_id === user.id) {
      return reply.code(403).send({ error: "REQUESTER_CANNOT_SECOND_APPROVE" });
    }
    if (found.status !== "AGUARDANDO_SEGUNDA_APROVACAO") {
      return reply.code(409).send({ error: "REQUEST_NOT_WAITING_SECOND_APPROVAL" });
    }

    await recordApproval({
      requestId: found.id,
      approverId: user.id,
      level: 2,
      decision: "approved",
    });
    await transitionRequest(found.id, "NA_FILA", user.id);
    const queue = await enqueueIfConfigured(found.id);
    return { status: "NA_FILA", queue };
  });
}
