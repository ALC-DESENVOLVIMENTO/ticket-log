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
