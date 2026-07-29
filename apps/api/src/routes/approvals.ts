import type { FastifyInstance } from "fastify";
import {
  approveRequestWithToken,
  getActiveRequestByPlate,
  getApprovalRequestByToken,
  getRequest,
  getRequestVisibleToUser,
  getUserContext,
  recordApproval,
  rejectRequest,
  transitionRequest,
} from "@ticketlog/db";
import { enqueueLimitRequest } from "@ticketlog/queue";
import { evaluateLimitPolicy } from "@ticketlog/domain";
import { getAuthenticatedUser } from "../auth.js";
import { config } from "../config.js";
import { assertCanApproveRequest, resolveAccessProfile } from "../roles.js";
import { createWhatsappProvider } from "@ticketlog/whatsapp";
import { notifyWhatsappRequestResolved } from "../services/whatsappFlow.js";

const whatsappProvider = createWhatsappProvider({
  apiBaseUrl: config.whatsappApiBaseUrl,
  phoneNumberId: config.whatsappPhoneNumberId,
  accessToken: config.whatsappAccessToken,
});

async function enqueueIfConfigured(
  app: FastifyInstance,
  requestId: string,
): Promise<{ queued: boolean; reason?: string }> {
  if (!process.env.REDIS_URL) return { queued: false, reason: "REDIS_URL_NOT_CONFIGURED" };
  try {
    await enqueueLimitRequest(requestId);
    return { queued: true };
  } catch (error) {
    app.log.error(
      {
        requestId,
        errorName: error instanceof Error ? error.name : "UNKNOWN_ERROR",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      "approval recorded but queue enqueue failed",
    );
    return { queued: false, reason: "QUEUE_ENQUEUE_FAILED" };
  }
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
    const found = await getApprovalRequestByToken(params.token);
    if (!found) return reply.code(401).send({ error: "INVALID_OR_EXPIRED_APPROVAL_TOKEN" });

    const policy = evaluateLimitPolicy(
      Number(found.requested_amount),
      config.groupPolicies[found.vehicle_group as keyof typeof config.groupPolicies] ??
        config.groupPolicies.GERAL_DE_RESTRICOES,
    );
    let approval;
    try {
      approval = await approveRequestWithToken({
        token: params.token,
        userId: user.id,
        requiresSecondApproval: policy.requiresSecondApproval,
      });
    } catch (error) {
      const databaseError = error as { code?: string; constraint?: string };
      if (
        databaseError.code === "23505" &&
        databaseError.constraint === "uq_active_plate_processing"
      ) {
        const activeRequest = await getActiveRequestByPlate(found.vehicle_plate, found.id);
        return reply.code(409).send({
          error: "PLATE_ALREADY_HAS_ACTIVE_REQUEST",
          existingRequestId: activeRequest?.id ?? null,
          existingStatus: activeRequest?.status ?? null,
        });
      }
      throw error;
    }
    if (!approval) {
      return reply.code(401).send({ error: "INVALID_OR_EXPIRED_APPROVAL_TOKEN" });
    }

    if (approval.request.status === "AGUARDANDO_SEGUNDA_APROVACAO") {
      return {
        status: approval.request.status,
        recovered: approval.recovered,
      };
    }

    const queue =
      approval.request.status === "NA_FILA"
        ? await enqueueIfConfigured(app, approval.request.id)
        : { queued: false, reason: "REQUEST_ALREADY_ADVANCED" };
    return {
      status: approval.request.status,
      queue,
      recovered: approval.recovered,
    };
  });

  app.post("/requests/:id/second-approval", async (request, reply) => {
    const authUser = await getAuthenticatedUser(request);
    const user = await getUserContext(authUser.id);
    if (!user) throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 404 });
    assertCanApproveRequest(user);
    const params = request.params as { id: string };
    const access = resolveAccessProfile(user);
    const found = access.isAdmin
      ? await getRequest(params.id)
      : await getRequestVisibleToUser({
          requestId: params.id,
          userId: user.id,
          includeScope: access.canViewScopeRequests,
          operationScope: user.operation_scope,
        });
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
    const queue = await enqueueIfConfigured(app, found.id);
    return { status: "NA_FILA", queue };
  });

  app.post("/requests/:id/reject", async (request, reply) => {
    const authUser = await getAuthenticatedUser(request);
    const user = await getUserContext(authUser.id);
    if (!user) throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 404 });
    assertCanApproveRequest(user);
    const params = request.params as { id: string };
    const body = request.body as { justification?: string };
    if (!body.justification?.trim()) {
      return reply.code(400).send({ error: "REJECTION_JUSTIFICATION_REQUIRED" });
    }

    const access = resolveAccessProfile(user);
    const found = access.isAdmin
      ? await getRequest(params.id)
      : await getRequestVisibleToUser({
          requestId: params.id,
          userId: user.id,
          includeScope: access.canViewScopeRequests,
          operationScope: user.operation_scope,
        });
    if (!found) return reply.code(404).send({ error: "REQUEST_NOT_FOUND" });
    if (found.requester_id === user.id) {
      return reply.code(403).send({ error: "REQUESTER_CANNOT_REJECT_OWN_REQUEST" });
    }

    const requestResult = await rejectRequest({
      requestId: found.id,
      approverId: user.id,
      justification: body.justification.trim(),
    });
    await notifyWhatsappRequestResolved({
      provider: whatsappProvider,
      requestId: requestResult.id,
    }).catch((error) => {
      app.log.error({ requestId: requestResult.id, error }, "failed to notify whatsapp after rejection");
    });
    return { status: requestResult.status };
  });
}
