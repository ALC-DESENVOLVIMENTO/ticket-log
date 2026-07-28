import type { FastifyInstance, FastifyReply } from "fastify";
import {
  appendAuditEvent,
  claimOperationalRuntime,
  ensureOperationalRuntimeSchema,
  getOperationalRuntime,
  listUserRoles,
  releaseOperationalRuntime,
} from "@ticketlog/db";
import { getAuthenticatedUser } from "../auth.js";

const serviceKey = "ticketlog-worker";

function operatorStationUrl(baseUrl: string | null): string | null {
  const token = process.env.TICKETLOG_OPERATOR_ACCESS_TOKEN;
  if (!baseUrl || !token) return null;
  const url = new URL(baseUrl);
  url.searchParams.set("autoconnect", "true");
  url.searchParams.set("resize", "scale");
  url.searchParams.set("access", token);
  return url.toString();
}

async function requireOperator(request: Parameters<typeof getAuthenticatedUser>[0], reply: FastifyReply) {
  const user = await getAuthenticatedUser(request);
  const roles = await listUserRoles(user.id);
  if (!roles.some((role) => role === "APROVADOR" || role === "ADMINISTRADOR")) {
    await appendAuditEvent({
      actorUserId: user.id,
      eventType: "OPERATION_ACCESS_DENIED",
      payload: { roles },
    });
    reply.code(403).send({ error: "OPERATION_ACCESS_DENIED" });
    return null;
  }
  return { user, roles };
}

function publicRuntime(runtime: Awaited<ReturnType<typeof getOperationalRuntime>>, viewerUserId: string) {
  if (!runtime) {
    return {
      workerStatus: "OFFLINE",
      sessionStatus: "UNKNOWN",
      stale: true,
      stationEnabled: false,
      stationUrl: null,
      message: "Worker ainda nao publicou estado operacional.",
    };
  }

  const heartbeatAgeMs = Date.now() - new Date(runtime.heartbeat_at).getTime();
  const claimActive =
    Boolean(runtime.operator_user_id) &&
    Boolean(runtime.operator_claim_expires_at) &&
    new Date(runtime.operator_claim_expires_at as Date).getTime() > Date.now();
  const stationUrl = operatorStationUrl(runtime.station_url);
  return {
    workerStatus: heartbeatAgeMs > 60_000 ? "OFFLINE" : runtime.worker_status,
    sessionStatus: runtime.session_status,
    stale: heartbeatAgeMs > 60_000,
    heartbeatAt: runtime.heartbeat_at,
    providerMode: runtime.provider_mode,
    realExecutionEnabled: runtime.real_execution_enabled,
    headless: runtime.headless,
    stationEnabled: runtime.station_enabled,
    stationUrl: claimActive && runtime.operator_user_id === viewerUserId ? stationUrl : null,
    stationAvailable: Boolean(stationUrl),
    storageStatePresent: runtime.storage_state_present,
    userDataDirPresent: runtime.persistent_profile_present,
    currentRequestId: runtime.current_request_id,
    currentRequestStatus: runtime.current_request_status,
    currentStep: runtime.current_step,
    currentUrl: runtime.current_url,
    challengeType: runtime.challenge_type,
    statusMessage: runtime.status_message,
    operator: claimActive && runtime.operator_user_id
      ? {
          userId: runtime.operator_user_id,
          name: runtime.operator_name,
          claimedAt: runtime.operator_claimed_at,
          expiresAt: runtime.operator_claim_expires_at,
        }
      : null,
  };
}

export async function operationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/operations/ticketlog/session", async (request, reply) => {
    const access = await requireOperator(request, reply);
    if (!access) return;
    await ensureOperationalRuntimeSchema();
    return publicRuntime(await getOperationalRuntime(serviceKey), access.user.id);
  });

  app.post("/operations/ticketlog/claim", async (request, reply) => {
    const access = await requireOperator(request, reply);
    if (!access) return;
    await ensureOperationalRuntimeSchema();
    const runtime = await claimOperationalRuntime({
      serviceKey,
      userId: access.user.id,
      ttlMinutes: 15,
    });
    if (!runtime) {
      return reply.code(409).send({ error: "OPERATION_ALREADY_CLAIMED" });
    }
    await appendAuditEvent({
      actorUserId: access.user.id,
      requestId: runtime.current_request_id ?? undefined,
      eventType: "OPERATION_TAKEOVER_CLAIMED",
      payload: { workerInstanceId: runtime.worker_instance_id },
    });
    return publicRuntime(await getOperationalRuntime(serviceKey), access.user.id);
  });

  app.post("/operations/ticketlog/release", async (request, reply) => {
    const access = await requireOperator(request, reply);
    if (!access) return;
    const released = await releaseOperationalRuntime({
      serviceKey,
      userId: access.user.id,
    });
    if (!released) {
      return reply.code(409).send({ error: "OPERATION_NOT_OWNED_BY_USER" });
    }
    await appendAuditEvent({
      actorUserId: access.user.id,
      eventType: "OPERATION_TAKEOVER_RELEASED",
      payload: { serviceKey },
    });
    return { ok: true };
  });
}
