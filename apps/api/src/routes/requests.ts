import type { FastifyInstance } from "fastify";
import {
  buildRequestIdempotencyKey,
  evaluateLimitPolicy,
  isValidBrazilianPlate,
  isVehicleGroup,
  normalizePlate,
  type RequestState,
  type VehicleGroup,
} from "@ticketlog/domain";
import {
  appendAuditEvent,
  createApprovalToken,
  createRequest,
  getActiveRequestByPlate,
  getPool,
  getRequest,
  getRequestVisibleToUser,
  resolveRequestLookupId,
  getUserContext,
  listRequestsVisibleToUser,
  transitionRequest,
} from "@ticketlog/db";
import { enqueueLimitRequest } from "@ticketlog/queue";
import { config } from "../config.js";
import { getAuthenticatedUser } from "../auth.js";
import { assertCanCreateWebRequest, resolveAccessProfile } from "../roles.js";

async function enqueueIfConfigured(requestId: string): Promise<{ queued: boolean; reason?: string }> {
  if (!process.env.REDIS_URL) return { queued: false, reason: "REDIS_URL_NOT_CONFIGURED" };
  await enqueueLimitRequest(requestId);
  return { queued: true };
}

function expiresAt(): Date {
  return new Date(Date.now() + config.approvalTtlMinutes * 60_000);
}

function currentBucket(): string {
  const now = new Date();
  return now.toISOString().slice(0, 13);
}

async function resolveRequestParamId(rawId: string): Promise<string | null> {
  return resolveRequestLookupId(rawId);
}

export async function requestRoutes(app: FastifyInstance): Promise<void> {
  app.get("/requests", async (request) => {
    const authUser = await getAuthenticatedUser(request);
    const user = await getUserContext(authUser.id);
    if (!user) throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 404 });
    const query = request.query as { limit?: string };
    const limit = Math.max(1, Math.min(query.limit ? Number(query.limit) : 20, 100));
    const access = resolveAccessProfile(user);
    if (access.isAdmin) {
      const result = await getPool().query("select * from requests order by created_at desc limit $1", [limit]);
      return { requests: result.rows };
    }
    return {
      requests: await listRequestsVisibleToUser({
        userId: user.id,
        includeScope: access.canViewScopeRequests,
        operationScope: user.operation_scope,
        limit,
      }),
    };
  });

  app.post("/requests", async (request, reply) => {
    const authUser = await getAuthenticatedUser(request);
    const user = await getUserContext(authUser.id);
    if (!user) throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 404 });
    assertCanCreateWebRequest(user);
    const body = request.body as any;
    const vehiclePlate = normalizePlate(String(body.vehiclePlate ?? ""));
    const requestedAmount = Number(body.requestedAmount);
    const vehicleGroup: VehicleGroup = isVehicleGroup(String(body.vehicleGroup))
      ? body.vehicleGroup
      : "GERAL_DE_RESTRICOES";

    if (!isValidBrazilianPlate(vehiclePlate)) {
      return reply.code(400).send({ error: "INVALID_PLATE" });
    }

    const policy = evaluateLimitPolicy(requestedAmount, config.groupPolicies[vehicleGroup]);
    if (!policy.allowed) {
      return reply.code(422).send({ error: policy.reason, vehicleGroup });
    }

    const activeRequest = await getActiveRequestByPlate(vehiclePlate);
    if (activeRequest) {
      return reply.code(409).send({
        error: "PLATE_ALREADY_HAS_ACTIVE_REQUEST",
        existingRequestId: activeRequest.id,
        existingStatus: activeRequest.status,
      });
    }

    const idempotencyKey = buildRequestIdempotencyKey({
      requesterId: user.id,
      vehiclePlate,
      vehicleGroup,
      requestedAmount,
      bucket: currentBucket(),
    });

    const initialState: RequestState = "AGUARDANDO_APROVACAO";
    const created = await createRequest({
      idempotencyKey,
      vehiclePlate,
      vehicleGroup,
      requestedAmount,
      requesterId: user.id,
      channel: "web",
      status: initialState,
      justification: body.justification,
      expiresAt: expiresAt(),
    });

    const token = await createApprovalToken(created.id, user.id, created.expires_at);

    return reply.code(201).send({
      request: created,
      requiresSecondApproval: policy.requiresSecondApproval,
      vehicleGroup,
      approvalUrl: `${config.appBaseUrl}/approval/${token}`,
    });
  });

  app.get("/requests/:id", async (request, reply) => {
    const authUser = await getAuthenticatedUser(request);
    const user = await getUserContext(authUser.id);
    if (!user) throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 404 });
    const params = request.params as { id: string };
    const resolvedId = await resolveRequestParamId(params.id);
    if (!resolvedId) return reply.code(404).send({ error: "REQUEST_NOT_FOUND" });
    const access = resolveAccessProfile(user);
    const found = access.isAdmin
      ? await getRequest(resolvedId)
      : await getRequestVisibleToUser({
          requestId: resolvedId,
          userId: user.id,
          includeScope: access.canViewScopeRequests,
          operationScope: user.operation_scope,
        });
    if (!found) return reply.code(404).send({ error: "REQUEST_NOT_FOUND" });
    return found;
  });

  app.get("/requests/:id/details", async (request, reply) => {
    const authUser = await getAuthenticatedUser(request);
    const user = await getUserContext(authUser.id);
    if (!user) throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 404 });
    const params = request.params as { id: string };
    const resolvedId = await resolveRequestParamId(params.id);
    if (!resolvedId) return reply.code(404).send({ error: "REQUEST_NOT_FOUND" });
    const access = resolveAccessProfile(user);
    const found = access.isAdmin
      ? await getRequest(resolvedId)
      : await getRequestVisibleToUser({
          requestId: resolvedId,
          userId: user.id,
          includeScope: access.canViewScopeRequests,
          operationScope: user.operation_scope,
        });
    if (!found) return reply.code(404).send({ error: "REQUEST_NOT_FOUND" });
    const [stepsResult, eventsResult] = await Promise.all([
      getPool().query(
        `select step_key, status, error_code, started_at, finished_at
           from automation_steps
          where request_id = $1
          order by started_at nulls first, step_key`,
        [resolvedId],
      ),
      getPool().query(
        `select event_type, created_at
           from audit_events
          where request_id = $1
          order by created_at desc
          limit 30`,
        [resolvedId],
      ),
    ]);
    const steps = stepsResult.rows;
    const events = eventsResult.rows;
    return { request: found, steps, events };
  });

  app.post("/requests/:id/approval-link", async (request, reply) => {
    const authUser = await getAuthenticatedUser(request);
    const user = await getUserContext(authUser.id);
    if (!user) throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 404 });
    const params = request.params as { id: string };
    const resolvedId = await resolveRequestParamId(params.id);
    if (!resolvedId) return reply.code(404).send({ error: "REQUEST_NOT_FOUND" });
    const found = await getRequest(resolvedId);
    if (!found) return reply.code(404).send({ error: "REQUEST_NOT_FOUND" });
    if (found.requester_id !== user.id) {
      return reply.code(403).send({ error: "APPROVAL_LINK_NOT_ALLOWED" });
    }
    if (!["AGUARDANDO_AUTENTICACAO", "AGUARDANDO_APROVACAO"].includes(found.status)) {
      return reply.code(409).send({ error: "REQUEST_NOT_WAITING_FIRST_APPROVAL" });
    }
    if (new Date(found.expires_at).getTime() <= Date.now()) {
      return reply.code(410).send({ error: "REQUEST_EXPIRED" });
    }

    const token = await createApprovalToken(found.id, user.id, found.expires_at);
    await appendAuditEvent({
      requestId: found.id,
      actorUserId: user.id,
      eventType: "APPROVAL_LINK_REISSUED",
      payload: { expiresAt: found.expires_at },
    });
    return {
      approvalUrl: `${config.appBaseUrl}/approval/${token}`,
      expiresAt: found.expires_at,
    };
  });

  app.post("/requests/:id/retry", async (request, reply) => {
    const authUser = await getAuthenticatedUser(request);
    const user = await getUserContext(authUser.id);
    if (!user) throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 404 });
    const params = request.params as { id: string };
    const resolvedId = await resolveRequestParamId(params.id);
    if (!resolvedId) return reply.code(404).send({ error: "REQUEST_NOT_FOUND" });
    const access = resolveAccessProfile(user);
    const found = access.isAdmin
      ? await getRequest(resolvedId)
      : await getRequestVisibleToUser({
          requestId: resolvedId,
          userId: user.id,
          includeScope: access.canViewScopeRequests,
          operationScope: user.operation_scope,
        });
    if (!found) return reply.code(404).send({ error: "REQUEST_NOT_FOUND" });
    if (!["NA_FILA", "FALHA_REPROCESSAVEL", "FALHA_MANUAL", "LIMITE_ALTERADO"].includes(found.status)) {
      return reply.code(409).send({ error: "REQUEST_NOT_RETRYABLE" });
    }
    if (!["NA_FILA", "LIMITE_ALTERADO"].includes(found.status)) {
      await transitionRequest(found.id, "NA_FILA");
    }
    const queue = await enqueueIfConfigured(found.id);
    await appendAuditEvent({
      requestId: found.id,
      eventType: "REQUEST_REENQUEUED",
      payload: { previousStatus: found.status, queue },
    });
    return { ok: true, queue };
  });
}
