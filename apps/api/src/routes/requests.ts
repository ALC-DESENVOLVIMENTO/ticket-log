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
  createApprovalToken,
  createRequest,
  getPool,
  getRequest,
  transitionRequest,
} from "@ticketlog/db";
import { enqueueLimitRequest } from "@ticketlog/queue";
import { config } from "../config.js";
import { getAuthenticatedUser } from "../auth.js";

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

export async function requestRoutes(app: FastifyInstance): Promise<void> {
  app.get("/requests", async (request) => {
    await getAuthenticatedUser(request);
    const query = request.query as { limit?: string };
    const limit = Math.max(1, Math.min(query.limit ? Number(query.limit) : 20, 100));
    const result = await getPool().query("select * from requests order by created_at desc limit $1", [limit]);
    return { requests: result.rows };
  });

  app.post("/requests", async (request, reply) => {
    const user = await getAuthenticatedUser(request);
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
    await getAuthenticatedUser(request);
    const params = request.params as { id: string };
    const found = await getRequest(params.id);
    if (!found) return reply.code(404).send({ error: "REQUEST_NOT_FOUND" });
    return found;
  });

  app.get("/requests/:id/details", async (request, reply) => {
    await getAuthenticatedUser(request);
    const params = request.params as { id: string };
    const found = await getRequest(params.id);
    if (!found) return reply.code(404).send({ error: "REQUEST_NOT_FOUND" });
    const [stepsResult, eventsResult] = await Promise.all([
      getPool().query(
        `select step_key, status, error_code, started_at, finished_at
           from automation_steps
          where request_id = $1
          order by started_at nulls first, step_key`,
        [params.id],
      ),
      getPool().query(
        `select event_type, created_at
           from audit_events
          where request_id = $1
          order by created_at desc
          limit 30`,
        [params.id],
      ),
    ]);
    const steps = stepsResult.rows;
    const events = eventsResult.rows;
    return { request: found, steps, events };
  });

  app.post("/requests/:id/retry", async (request, reply) => {
    await getAuthenticatedUser(request);
    const params = request.params as { id: string };
    const found = await getRequest(params.id);
    if (!found) return reply.code(404).send({ error: "REQUEST_NOT_FOUND" });
    if (!["FALHA_REPROCESSAVEL", "FALHA_MANUAL"].includes(found.status)) {
      return reply.code(409).send({ error: "REQUEST_NOT_RETRYABLE" });
    }
    await transitionRequest(found.id, "NA_FILA");
    return { ok: true, queue: await enqueueIfConfigured(found.id) };
  });
}
