import { randomBytes, createHash } from "node:crypto";
import {
  assertTransition,
  type RequestState,
  normalizeCpf,
  maskCpf,
  type RoleKey,
} from "@ticketlog/domain";
import { getPool } from "./client.js";
import { appendAuditEvent } from "./audit.js";

export interface DbUser {
  id: string;
  name: string;
  employee_number: string;
  corporate_email: string;
  cpf_hash?: string | null;
  cpf_last4?: string | null;
  operation_scope?: string;
  status: string;
  password_hash?: string | null;
  mfa_secret_encrypted?: Buffer | null;
  mfa_enabled?: boolean;
}

export interface DbRequest {
  id: string;
  idempotency_key: string;
  vehicle_plate: string;
  vehicle_group: string;
  requested_amount: string;
  requester_id: string;
  channel: string;
  status: RequestState;
  expires_at: Date;
  previous_limit: string | null;
  new_limit: string | null;
}

export interface DbAutomationStep {
  step_key: string;
  status: string;
  error_code: string | null;
  started_at: Date | null;
  finished_at: Date | null;
}

export interface DbAuditEventSummary {
  event_type: string;
  created_at: Date;
}

export interface DbUserContext extends DbUser {
  roles: RoleKey[];
}

export interface DbWhatsappSession {
  id: string;
  phone_e164: string;
  state: string;
  authenticated_user_id: string | null;
  active_request_id: string | null;
  pending_vehicle_plate: string | null;
  pending_amount_cents: number | null;
  cpf_hash: string | null;
  cpf_last4: string | null;
  failed_cpf_attempts: number;
  failed_mfa_attempts: number;
  authentication_attempts: number;
  locked_until: Date | null;
  authenticated_at: Date | null;
  expires_at: Date;
  last_message_id: string | null;
  last_interaction_at: Date;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface DbWhatsappSessionOverview extends DbWhatsappSession {
  authenticated_user_name: string | null;
  authenticated_user_email: string | null;
  authenticated_user_scope: string | null;
}

export interface DbRequestNotification {
  id: string;
  request_id: string;
  event_key: string;
  channel: string;
  recipient_phone_e164: string | null;
  provider_message_id: string | null;
  status: string;
  created_at: Date;
  sent_at: Date | null;
}

export interface OperationalRuntime {
  service_key: string;
  worker_instance_id: string;
  worker_status: string;
  session_status: string;
  provider_mode: string;
  real_execution_enabled: boolean;
  headless: boolean;
  station_enabled: boolean;
  station_url: string | null;
  storage_state_present: boolean;
  persistent_profile_present: boolean;
  current_request_id: string | null;
  current_request_status?: string | null;
  current_step: string | null;
  current_url: string | null;
  challenge_type: string | null;
  status_message: string | null;
  operator_user_id: string | null;
  operator_name?: string | null;
  operator_claimed_at: Date | null;
  operator_claim_expires_at: Date | null;
  heartbeat_at: Date;
  updated_at: Date;
}

export async function ensureOperationalRuntimeSchema(): Promise<void> {
  await getPool().query(`
    create table if not exists operational_runtime (
      service_key text primary key,
      worker_instance_id text not null,
      worker_status text not null,
      session_status text not null,
      provider_mode text not null,
      real_execution_enabled boolean not null default false,
      headless boolean not null default true,
      station_enabled boolean not null default false,
      station_url text,
      storage_state_present boolean not null default false,
      persistent_profile_present boolean not null default false,
      current_request_id uuid,
      current_step text,
      current_url text,
      challenge_type text,
      status_message text,
      operator_user_id uuid references users(id),
      operator_claimed_at timestamptz,
      operator_claim_expires_at timestamptz,
      heartbeat_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
}

function hashCpfForLookup(cpf: string): { hash: string; last4: string } {
  const normalized = normalizeCpf(cpf);
  return {
    hash: createHash("sha256").update(normalized).digest("hex"),
    last4: normalized.slice(-4),
  };
}

async function insertRequestStatusHistory(input: {
  client?: any;
  requestId: string;
  fromStatus?: string | null;
  toStatus: string;
  actorUserId?: string;
  origin?: string;
  reasonCode?: string;
}): Promise<void> {
  const client = input.client ?? getPool();
  await client.query(
    `insert into request_status_history(request_id, from_status, to_status, actor_user_id, origin, reason_code)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      input.requestId,
      input.fromStatus ?? null,
      input.toStatus,
      input.actorUserId ?? null,
      input.origin ?? "SYSTEM",
      input.reasonCode ?? null,
    ],
  );
}

export async function upsertOperationalRuntime(input: {
  serviceKey?: string;
  workerInstanceId: string;
  workerStatus: string;
  sessionStatus: string;
  providerMode: string;
  realExecutionEnabled: boolean;
  headless: boolean;
  stationEnabled: boolean;
  stationUrl?: string | null;
  storageStatePresent: boolean;
  persistentProfilePresent: boolean;
  currentRequestId?: string | null;
  currentStep?: string | null;
  currentUrl?: string | null;
  challengeType?: string | null;
  statusMessage?: string | null;
}): Promise<void> {
  await getPool().query(
    `insert into operational_runtime(
       service_key, worker_instance_id, worker_status, session_status, provider_mode,
       real_execution_enabled, headless, station_enabled, station_url,
       storage_state_present, persistent_profile_present, current_request_id,
       current_step, current_url, challenge_type, status_message, heartbeat_at, updated_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),now())
     on conflict (service_key)
     do update set worker_instance_id = excluded.worker_instance_id,
                   worker_status = excluded.worker_status,
                   session_status = excluded.session_status,
                   provider_mode = excluded.provider_mode,
                   real_execution_enabled = excluded.real_execution_enabled,
                   headless = excluded.headless,
                   station_enabled = excluded.station_enabled,
                   station_url = excluded.station_url,
                   storage_state_present = excluded.storage_state_present,
                   persistent_profile_present = excluded.persistent_profile_present,
                   current_request_id = excluded.current_request_id,
                   current_step = excluded.current_step,
                   current_url = excluded.current_url,
                   challenge_type = excluded.challenge_type,
                   status_message = excluded.status_message,
                   heartbeat_at = now(),
                   updated_at = now()`,
    [
      input.serviceKey ?? "ticketlog-worker",
      input.workerInstanceId,
      input.workerStatus,
      input.sessionStatus,
      input.providerMode,
      input.realExecutionEnabled,
      input.headless,
      input.stationEnabled,
      input.stationUrl ?? null,
      input.storageStatePresent,
      input.persistentProfilePresent,
      input.currentRequestId ?? null,
      input.currentStep ?? null,
      input.currentUrl ?? null,
      input.challengeType ?? null,
      input.statusMessage ?? null,
    ],
  );
}

export async function getOperationalRuntime(serviceKey = "ticketlog-worker"): Promise<OperationalRuntime | null> {
  const result = await getPool().query<OperationalRuntime>(
    `select r.*, u.name as operator_name, q.status as current_request_status
       from operational_runtime r
       left join users u on u.id = r.operator_user_id
       left join requests q on q.id = r.current_request_id
      where r.service_key = $1`,
    [serviceKey],
  );
  return result.rows[0] ?? null;
}

export async function claimOperationalRuntime(input: {
  userId: string;
  serviceKey?: string;
  ttlMinutes?: number;
}): Promise<OperationalRuntime | null> {
  const result = await getPool().query<OperationalRuntime>(
    `update operational_runtime
        set operator_user_id = $2,
            operator_claimed_at = now(),
            operator_claim_expires_at = now() + ($3 * interval '1 minute'),
            updated_at = now()
      where service_key = $1
        and (
          operator_user_id is null
          or operator_user_id = $2
          or operator_claim_expires_at < now()
        )
      returning *`,
    [input.serviceKey ?? "ticketlog-worker", input.userId, input.ttlMinutes ?? 15],
  );
  return result.rows[0] ?? null;
}

export async function releaseOperationalRuntime(input: {
  userId: string;
  serviceKey?: string;
}): Promise<boolean> {
  const result = await getPool().query(
    `update operational_runtime
        set operator_user_id = null,
            operator_claimed_at = null,
            operator_claim_expires_at = null,
            updated_at = now()
      where service_key = $1 and operator_user_id = $2`,
    [input.serviceKey ?? "ticketlog-worker", input.userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function findUserByPhone(phoneE164: string): Promise<DbUser | null> {
  const result = await getPool().query<DbUser>(
    `select u.*
       from users u
       join authorized_phones p on p.user_id = u.id
      where p.phone_e164 = $1
        and p.revoked_at is null
        and u.status = 'active'`,
    [phoneE164],
  );
  return result.rows[0] ?? null;
}

export async function findUserByCpf(cpf: string): Promise<DbUser | null> {
  const { hash } = hashCpfForLookup(cpf);
  const result = await getPool().query<DbUser>(
    "select * from users where cpf_hash = $1 and status = 'active'",
    [hash],
  );
  return result.rows[0] ?? null;
}

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  const result = await getPool().query<DbUser>(
    "select * from users where lower(corporate_email) = lower($1) and status = 'active'",
    [email],
  );
  return result.rows[0] ?? null;
}

export async function findUserById(userId: string): Promise<DbUser | null> {
  const result = await getPool().query<DbUser>(
    "select * from users where id = $1 and status = 'active'",
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function listUsers(): Promise<DbUser[]> {
  const result = await getPool().query<DbUser>(
    "select id, name, employee_number, corporate_email, cpf_last4, operation_scope, status, mfa_enabled from users order by name",
  );
  return result.rows;
}

export async function listUserRoles(userId: string): Promise<string[]> {
  const result = await getPool().query<{ name: string }>(
    `select r.name
       from user_roles ur
       join roles r on r.id = ur.role_id
      where ur.user_id = $1
      order by r.name`,
    [userId],
  );
  return result.rows.map((row) => row.name);
}

export async function getUserContext(userId: string): Promise<DbUserContext | null> {
  const user = await findUserById(userId);
  if (!user) return null;
  const roles = (await listUserRoles(userId)) as RoleKey[];
  return {
    ...user,
    roles,
  };
}

export async function getUserContextByPhone(phoneE164: string): Promise<DbUserContext | null> {
  const user = await findUserByPhone(phoneE164);
  if (!user) return null;
  const roles = (await listUserRoles(user.id)) as RoleKey[];
  return {
    ...user,
    roles,
  };
}

export async function upsertUser(input: {
  name: string;
  employeeNumber: string;
  corporateEmail: string;
  cpf?: string;
  operationScope?: string;
  passwordHash?: string;
  phoneE164?: string;
  roles?: string[];
}): Promise<DbUser> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const cpf = input.cpf ? hashCpfForLookup(input.cpf) : null;
    const user = await client.query<DbUser>(
      `insert into users(name, employee_number, corporate_email, cpf_hash, cpf_last4, operation_scope, password_hash, password_changed_at, status)
       values ($1, $2, $3, $4, $5, $6, $7, case when $7 is null then null else now() end, 'active')
       on conflict (corporate_email)
       do update set name = excluded.name,
                     employee_number = excluded.employee_number,
                     cpf_hash = coalesce(excluded.cpf_hash, users.cpf_hash),
                     cpf_last4 = coalesce(excluded.cpf_last4, users.cpf_last4),
                     operation_scope = coalesce(excluded.operation_scope, users.operation_scope),
                     password_hash = coalesce(excluded.password_hash, users.password_hash),
                     password_changed_at = case when excluded.password_hash is null then users.password_changed_at else now() end,
                     status = 'active'
       returning *`,
      [
        input.name,
        input.employeeNumber,
        input.corporateEmail,
        cpf?.hash ?? null,
        cpf?.last4 ?? null,
        input.operationScope ?? "GERAL",
        input.passwordHash ?? null,
      ],
    );

    if (input.phoneE164) {
      await client.query(
        `insert into authorized_phones(user_id, phone_e164, verified_at)
         values ($1, $2, now())
         on conflict (phone_e164)
         do update set user_id = excluded.user_id, revoked_at = null`,
        [user.rows[0].id, input.phoneE164],
      );
    }

    for (const role of input.roles ?? ["SUPERVISOR"]) {
      await client.query(
        `insert into user_roles(user_id, role_id)
         select $1, id from roles where name = $2
         on conflict do nothing`,
        [user.rows[0].id, role],
      );
    }

    await client.query("commit");
    return user.rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function setUserMfaSecret(userId: string, encryptedSecret: Buffer): Promise<void> {
  await getPool().query(
    "update users set mfa_secret_encrypted = $2, mfa_enabled = false where id = $1",
    [userId, encryptedSecret],
  );
}

export async function enableUserMfa(userId: string): Promise<void> {
  await getPool().query(
    "update users set mfa_enabled = true, mfa_enrolled_at = now() where id = $1",
    [userId],
  );
}

export async function createAuthSession(input: {
  userId: string;
  tokenHash: string;
  userAgent?: string;
  ipAddress?: string;
  expiresAt: Date;
}): Promise<void> {
  await getPool().query(
    `insert into auth_sessions(user_id, token_hash, user_agent, ip_address, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [input.userId, input.tokenHash, input.userAgent ?? null, input.ipAddress ?? null, input.expiresAt],
  );
}

export async function findUserBySessionTokenHash(tokenHash: string): Promise<DbUser | null> {
  const result = await getPool().query<DbUser>(
    `select u.*
       from auth_sessions s
       join users u on u.id = s.user_id
      where s.token_hash = $1
        and s.revoked_at is null
        and s.expires_at > now()
        and u.status = 'active'`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

export async function revokeAuthSession(tokenHash: string): Promise<void> {
  await getPool().query(
    "update auth_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null",
    [tokenHash],
  );
}

export async function createRequest(input: {
  idempotencyKey: string;
  vehiclePlate: string;
  vehicleGroup: string;
  requestedAmount: number;
  requesterId: string;
  channel: string;
  status: RequestState;
  justification?: string;
  expiresAt: Date;
}): Promise<DbRequest> {
  const result = await getPool().query<DbRequest>(
    `insert into requests(
      idempotency_key, vehicle_plate, vehicle_group, requested_amount, requester_id, channel, status, justification, expires_at
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    on conflict (idempotency_key) do update set updated_at = now()
    returning *`,
    [
      input.idempotencyKey,
      input.vehiclePlate,
      input.vehicleGroup,
      input.requestedAmount,
      input.requesterId,
      input.channel,
      input.status,
      input.justification ?? null,
      input.expiresAt,
    ],
  );
  await appendAuditEvent({
    requestId: result.rows[0].id,
    actorUserId: input.requesterId,
    eventType: "REQUEST_CREATED_OR_REUSED",
    payload: { plate: input.vehiclePlate, group: input.vehicleGroup, amount: input.requestedAmount, channel: input.channel },
  });
  await insertRequestStatusHistory({
    requestId: result.rows[0].id,
    fromStatus: null,
    toStatus: result.rows[0].status,
    actorUserId: input.requesterId,
    origin: input.channel.toUpperCase(),
  });
  return result.rows[0];
}

export async function createApprovalToken(requestId: string, expectedUserId: string, expiresAt: Date): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  await getPool().query(
    `insert into approval_tokens(request_id, expected_user_id, token_hash, expires_at)
     values ($1, $2, $3, $4)`,
    [requestId, expectedUserId, tokenHash, expiresAt],
  );

  return token;
}

export async function consumeApprovalToken(token: string, userId: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const result = await getPool().query<{ request_id: string }>(
    `update approval_tokens
        set used_at = now()
      where token_hash = $1
        and expected_user_id = $2
        and used_at is null
        and expires_at > now()
      returning request_id`,
    [tokenHash, userId],
  );
  return result.rows[0]?.request_id ?? null;
}

export async function approveRequestWithToken(input: {
  token: string;
  userId: string;
  requiresSecondApproval: boolean;
}): Promise<{ request: DbRequest; recovered: boolean } | null> {
  const tokenHash = createHash("sha256").update(input.token).digest("hex");
  const client = await getPool().connect();

  try {
    await client.query("begin");
    const consumed = await client.query<{ request_id: string }>(
      `update approval_tokens
          set used_at = now()
        where token_hash = $1
          and expected_user_id = $2
          and used_at is null
          and expires_at > now()
        returning request_id`,
      [tokenHash, input.userId],
    );

    let requestId = consumed.rows[0]?.request_id;
    let recovered = false;

    if (!requestId) {
      const existing = await client.query<{ request_id: string }>(
        `select request_id
           from approval_tokens
          where token_hash = $1
            and expected_user_id = $2
            and used_at is not null
            and expires_at > now()
          for update`,
        [tokenHash, input.userId],
      );
      requestId = existing.rows[0]?.request_id;
      recovered = Boolean(requestId);
    }

    if (!requestId) {
      await client.query("rollback");
      return null;
    }

    const current = await client.query<DbRequest>(
      "select * from requests where id = $1 for update",
      [requestId],
    );
    let request = current.rows[0];
    if (!request) throw new Error("REQUEST_NOT_FOUND");

    const existingApproval = await client.query(
      `select 1
         from approvals
        where request_id = $1
          and approver_id = $2
          and level = 1
          and decision = 'approved'`,
      [requestId, input.userId],
    );

    const hasExistingApproval = (existingApproval.rowCount ?? 0) > 0;

    if (request.status === "AGUARDANDO_AUTENTICACAO") {
      assertTransition(request.status, "AGUARDANDO_APROVACAO");
      const updated = await client.query<DbRequest>(
        "update requests set status = $1, updated_at = now() where id = $2 returning *",
        ["AGUARDANDO_APROVACAO", requestId],
      );
      await insertRequestStatusHistory({
        client,
        requestId,
        fromStatus: request.status,
        toStatus: "AGUARDANDO_APROVACAO",
        actorUserId: input.userId,
      });
      await appendAuditEvent({
        client,
        requestId,
        actorUserId: input.userId,
        eventType: "REQUEST_STATE_CHANGED",
        payload: { from: request.status, to: "AGUARDANDO_APROVACAO" },
      });
      request = updated.rows[0];
    }

    if (
      hasExistingApproval &&
      request.status !== "AGUARDANDO_APROVACAO"
    ) {
      await client.query("commit");
      return { request, recovered: true };
    }

    if (request.status !== "AGUARDANDO_APROVACAO") {
      throw new Error(`REQUEST_NOT_WAITING_FIRST_APPROVAL:${request.status}`);
    }

    if (!hasExistingApproval) {
      await client.query(
        `insert into approvals(request_id, approver_id, level, decision)
         values ($1, $2, 1, 'approved')
         on conflict do nothing`,
        [requestId, input.userId],
      );
      await appendAuditEvent({
        client,
        requestId,
        actorUserId: input.userId,
        eventType: "REQUEST_APPROVAL_RECORDED",
        payload: { level: 1, decision: "approved", recovered },
      });
    }

    const target: RequestState = input.requiresSecondApproval
      ? "AGUARDANDO_SEGUNDA_APROVACAO"
      : "NA_FILA";
    assertTransition(request.status, target);
    const updated = await client.query<DbRequest>(
      "update requests set status = $1, updated_at = now() where id = $2 returning *",
      [target, requestId],
    );
    await insertRequestStatusHistory({
      client,
      requestId,
      fromStatus: request.status,
      toStatus: target,
      actorUserId: input.userId,
    });
    await appendAuditEvent({
      client,
      requestId,
      actorUserId: input.userId,
      eventType: "REQUEST_STATE_CHANGED",
      payload: { from: request.status, to: target },
    });

    await client.query("commit");
    return { request: updated.rows[0], recovered };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function getApprovalRequestByToken(token: string): Promise<(DbRequest & {
  requester_name: string;
  requester_email: string;
  expected_user_id: string;
  token_expires_at: Date;
  token_used_at: Date | null;
}) | null> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const result = await getPool().query<DbRequest & {
    requester_name: string;
    requester_email: string;
    expected_user_id: string;
    token_expires_at: Date;
    token_used_at: Date | null;
  }>(
    `select r.*,
            u.name as requester_name,
            u.corporate_email as requester_email,
            t.expected_user_id,
            t.expires_at as token_expires_at,
            t.used_at as token_used_at
       from approval_tokens t
       join requests r on r.id = t.request_id
       join users u on u.id = r.requester_id
      where t.token_hash = $1`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

export async function recordApproval(input: {
  requestId: string;
  approverId: string;
  level: number;
  decision: "approved" | "rejected";
  justification?: string;
}): Promise<void> {
  await getPool().query(
    `insert into approvals(request_id, approver_id, level, decision, justification)
     values ($1, $2, $3, $4, $5)
     on conflict (request_id, approver_id) do nothing`,
    [input.requestId, input.approverId, input.level, input.decision, input.justification ?? null],
  );
  await appendAuditEvent({
    requestId: input.requestId,
    actorUserId: input.approverId,
    eventType: "REQUEST_APPROVAL_RECORDED",
    payload: { level: input.level, decision: input.decision, justification: input.justification ?? null },
  });
}

export async function getRequest(id: string): Promise<DbRequest | null> {
  const result = await getPool().query<DbRequest>("select * from requests where id = $1", [id]);
  return result.rows[0] ?? null;
}

export async function getActiveRequestByPlate(
  vehiclePlate: string,
  excludeRequestId?: string,
): Promise<DbRequest | null> {
  const result = await getPool().query<DbRequest>(
    `select *
       from requests
      where vehicle_plate = $1
        and status in ('NA_FILA', 'EM_PROCESSAMENTO', 'LIMITE_ALTERADO')
        and ($2::uuid is null or id <> $2::uuid)
      order by created_at
      limit 1`,
    [vehiclePlate, excludeRequestId ?? null],
  );
  return result.rows[0] ?? null;
}

export async function listRecentRequests(limit = 20): Promise<DbRequest[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  const result = await getPool().query<DbRequest>(
    "select * from requests order by created_at desc limit $1",
    [boundedLimit],
  );
  return result.rows;
}

export async function listAutomationSteps(requestId: string): Promise<DbAutomationStep[]> {
  const result = await getPool().query<DbAutomationStep>(
    `select step_key, status, error_code, started_at, finished_at
       from automation_steps
      where request_id = $1
      order by started_at nulls first, step_key`,
    [requestId],
  );
  return result.rows;
}

export async function listAuditEventSummaries(requestId: string, limit = 20): Promise<DbAuditEventSummary[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  const result = await getPool().query<DbAuditEventSummary>(
    `select event_type, created_at
       from audit_events
      where request_id = $1
      order by created_at desc
      limit $2`,
    [requestId, boundedLimit],
  );
  return result.rows;
}

export async function transitionRequest(id: string, to: RequestState, actorUserId?: string): Promise<DbRequest> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const current = await client.query<DbRequest>("select * from requests where id = $1 for update", [id]);
    const request = current.rows[0];
    if (!request) throw new Error("REQUEST_NOT_FOUND");
    assertTransition(request.status, to);

    const updated = await client.query<DbRequest>(
      "update requests set status = $1, updated_at = now() where id = $2 returning *",
      [to, id],
    );
    await insertRequestStatusHistory({
      client,
      requestId: id,
      fromStatus: request.status,
      toStatus: to,
      actorUserId,
    });
    await appendAuditEvent({
      client,
      requestId: id,
      actorUserId,
      eventType: "REQUEST_STATE_CHANGED",
      payload: { from: request.status, to },
    });
    await client.query("commit");
    return updated.rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function rejectRequest(input: {
  requestId: string;
  approverId: string;
  justification: string;
}): Promise<DbRequest> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const current = await client.query<DbRequest>("select * from requests where id = $1 for update", [input.requestId]);
    const request = current.rows[0];
    if (!request) throw new Error("REQUEST_NOT_FOUND");
    if (!["AGUARDANDO_APROVACAO", "AGUARDANDO_SEGUNDA_APROVACAO"].includes(request.status)) {
      throw new Error("REQUEST_NOT_PENDING_APPROVAL");
    }

    await client.query(
      `insert into approvals(request_id, approver_id, level, decision, justification)
       values ($1, $2, $3, 'rejected', $4)`,
      [input.requestId, input.approverId, request.status === "AGUARDANDO_SEGUNDA_APROVACAO" ? 2 : 1, input.justification],
    );

    const updated = await client.query<DbRequest>(
      "update requests set status = 'REJEITADA', updated_at = now() where id = $1 returning *",
      [input.requestId],
    );
    await insertRequestStatusHistory({
      client,
      requestId: input.requestId,
      fromStatus: request.status,
      toStatus: "REJEITADA",
      actorUserId: input.approverId,
      reasonCode: "REJECTED_BY_APPROVER",
    });
    await appendAuditEvent({
      client,
      requestId: input.requestId,
      actorUserId: input.approverId,
      eventType: "REQUEST_REJECTED",
      payload: { from: request.status, justification: input.justification },
    });
    await client.query("commit");
    return updated.rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertAutomationStep(input: {
  requestId: string;
  stepKey: string;
  status: string;
  errorCode?: string;
}): Promise<void> {
  await getPool().query(
    `insert into automation_steps(request_id, step_key, status, started_at, finished_at, error_code)
     values ($1, $2, $3, case when $3 = 'RUNNING' then now() else null end, case when $3 in ('DONE', 'FAILED', 'SKIPPED') then now() else null end, $4)
     on conflict (request_id, step_key)
     do update set status = excluded.status,
                   finished_at = case when excluded.status in ('DONE', 'FAILED', 'SKIPPED') then now() else automation_steps.finished_at end,
                   error_code = excluded.error_code`,
    [input.requestId, input.stepKey, input.status, input.errorCode ?? null],
  );
}

export async function hasCompletedStep(requestId: string, stepKey: string): Promise<boolean> {
  const result = await getPool().query(
    "select 1 from automation_steps where request_id = $1 and step_key = $2 and status = 'DONE'",
    [requestId, stepKey],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateLimitResult(input: {
  requestId: string;
  previousLimit?: number | null;
  newLimit?: number | null;
  platformResult: string;
}): Promise<void> {
  await getPool().query(
    `update requests
        set previous_limit = $2,
            new_limit = $3,
            platform_result = $4,
            updated_at = now()
      where id = $1`,
    [input.requestId, input.previousLimit ?? null, input.newLimit ?? null, input.platformResult],
  );
}

export async function updatePreviousLimit(requestId: string, previousLimit: number | null): Promise<void> {
  await getPool().query(
    `update requests
        set previous_limit = $2,
            updated_at = now()
      where id = $1`,
    [requestId, previousLimit],
  );
}

export async function getPrimaryAuthorizedPhoneByUserId(userId: string): Promise<string | null> {
  const result = await getPool().query<{ phone_e164: string }>(
    `select phone_e164
       from authorized_phones
      where user_id = $1
        and revoked_at is null
      order by verified_at desc nulls last, id
      limit 1`,
    [userId],
  );
  return result.rows[0]?.phone_e164 ?? null;
}

export async function hasAuthorizedPhoneForUser(userId: string): Promise<boolean> {
  const result = await getPool().query(
    `select 1
       from authorized_phones
      where user_id = $1
        and revoked_at is null
      limit 1`,
    [userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function isAuthorizedPhoneForUser(userId: string, phoneE164: string): Promise<boolean> {
  const result = await getPool().query(
    `select 1
       from authorized_phones
      where user_id = $1
        and phone_e164 = $2
        and revoked_at is null
      limit 1`,
    [userId, phoneE164],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getVehicleByPlate(plate: string): Promise<{
  id: string;
  plate: string;
  vehicle_group: string | null;
  operation_scope: string | null;
  status: string | null;
  current_limit: string | null;
} | null> {
  const result = await getPool().query<{
    id: string;
    plate: string;
    vehicle_group: string | null;
    operation_scope: string | null;
    status: string | null;
    current_limit: string | null;
  }>(
    `select id, plate, vehicle_group, operation_scope, status, current_limit::text
       from vehicles
      where plate = $1`,
    [plate],
  );
  return result.rows[0] ?? null;
}

export async function listRequestsVisibleToUser(input: {
  userId: string;
  includeScope: boolean;
  limit?: number;
  operationScope?: string;
}): Promise<DbRequest[]> {
  const boundedLimit = Math.max(1, Math.min(input.limit ?? 20, 100));
  if (input.includeScope && input.operationScope) {
    const result = await getPool().query<DbRequest>(
      `select r.*
         from requests r
         join users u on u.id = r.requester_id
        where u.operation_scope = $1
        order by r.created_at desc
        limit $2`,
      [input.operationScope, boundedLimit],
    );
    return result.rows;
  }

  const result = await getPool().query<DbRequest>(
    `select *
       from requests
      where requester_id = $1
      order by created_at desc
      limit $2`,
    [input.userId, boundedLimit],
  );
  return result.rows;
}

export async function getRequestVisibleToUser(input: {
  requestId: string;
  userId: string;
  includeScope: boolean;
  operationScope?: string;
}): Promise<DbRequest | null> {
  const result = await getPool().query<DbRequest>(
    `select r.*
       from requests r
       join users u on u.id = r.requester_id
      where r.id = $1
        and (
          r.requester_id = $2
          or ($3::boolean = true and $4::text is not null and u.operation_scope = $4)
        )`,
    [input.requestId, input.userId, input.includeScope, input.operationScope ?? null],
  );
  return result.rows[0] ?? null;
}

export async function getLatestWhatsappRequestByRequester(userId: string): Promise<DbRequest | null> {
  const result = await getPool().query<DbRequest>(
    `select *
       from requests
      where requester_id = $1
        and channel = 'whatsapp'
      order by created_at desc
      limit 1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function listCoordinatorsByScope(operationScope: string, excludeUserId?: string): Promise<DbUserContext[]> {
  const result = await getPool().query<DbUser>(
    `select distinct u.*
       from users u
       join user_roles ur on ur.user_id = u.id
       join roles r on r.id = ur.role_id
      where u.status = 'active'
        and u.operation_scope = $1
        and r.name in ('COORDENADOR', 'APROVADOR', 'ADMINISTRADOR')
        and ($2::uuid is null or u.id <> $2::uuid)
      order by u.name`,
    [operationScope, excludeUserId ?? null],
  );

  const items: DbUserContext[] = [];
  for (const row of result.rows) {
    items.push({
      ...row,
      roles: (await listUserRoles(row.id)) as RoleKey[],
    });
  }
  return items;
}

export async function getPendingApprovalRequestsByScope(operationScope: string, limit = 50): Promise<DbRequest[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  const result = await getPool().query<DbRequest>(
    `select r.*
       from requests r
       join users u on u.id = r.requester_id
      where u.operation_scope = $1
        and r.status in ('AGUARDANDO_APROVACAO', 'AGUARDANDO_SEGUNDA_APROVACAO')
      order by r.created_at desc
      limit $2`,
    [operationScope, boundedLimit],
  );
  return result.rows;
}

export async function getWhatsappSessionByPhone(phoneE164: string): Promise<DbWhatsappSession | null> {
  const result = await getPool().query<DbWhatsappSession>(
    `select *
       from whatsapp_sessions
      where phone_e164 = $1`,
    [phoneE164],
  );
  return result.rows[0] ?? null;
}

export async function listWhatsappSessionsByScope(input: {
  operationScope?: string;
  includeScope: boolean;
  authenticatedUserId?: string;
  limit?: number;
}): Promise<DbWhatsappSessionOverview[]> {
  const boundedLimit = Math.max(1, Math.min(input.limit ?? 50, 100));

  if (input.includeScope && input.operationScope) {
    const result = await getPool().query<DbWhatsappSessionOverview>(
      `select s.*,
              u.name as authenticated_user_name,
              u.corporate_email as authenticated_user_email,
              u.operation_scope as authenticated_user_scope
         from whatsapp_sessions s
         left join users u on u.id = s.authenticated_user_id
        where (
          u.operation_scope = $1
          or (u.id is null and coalesce(s.metadata->>'operationScope', 'GERAL') = $1)
        )
        order by s.updated_at desc
        limit $2`,
      [input.operationScope, boundedLimit],
    );
    return result.rows;
  }

  if (input.authenticatedUserId) {
    const result = await getPool().query<DbWhatsappSessionOverview>(
      `select s.*,
              u.name as authenticated_user_name,
              u.corporate_email as authenticated_user_email,
              u.operation_scope as authenticated_user_scope
         from whatsapp_sessions s
         left join users u on u.id = s.authenticated_user_id
        where s.authenticated_user_id = $1
        order by s.updated_at desc
        limit $2`,
      [input.authenticatedUserId, boundedLimit],
    );
    return result.rows;
  }

  return [];
}

export async function reopenWhatsappSession(input: {
  phoneE164: string;
  expiresAt: Date;
}): Promise<DbWhatsappSession | null> {
  const result = await getPool().query<DbWhatsappSession>(
    `update whatsapp_sessions
        set state = 'AGUARDANDO_CPF',
            active_request_id = null,
            pending_vehicle_plate = null,
            pending_amount_cents = null,
            failed_cpf_attempts = 0,
            failed_mfa_attempts = 0,
            authentication_attempts = 0,
            locked_until = null,
            expires_at = $2,
            last_interaction_at = now(),
            updated_at = now()
      where phone_e164 = $1
      returning *`,
    [input.phoneE164, input.expiresAt],
  );
  return result.rows[0] ?? null;
}

export async function upsertWhatsappSession(input: {
  phoneE164: string;
  state: string;
  authenticatedUserId?: string | null;
  activeRequestId?: string | null;
  pendingVehiclePlate?: string | null;
  pendingAmountCents?: number | null;
  cpf?: string | null;
  failedCpfAttempts?: number;
  failedMfaAttempts?: number;
  authenticationAttempts?: number;
  lockedUntil?: Date | null;
  authenticatedAt?: Date | null;
  expiresAt: Date;
  lastMessageId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<DbWhatsappSession> {
  const cpf = input.cpf ? hashCpfForLookup(input.cpf) : null;
  const result = await getPool().query<DbWhatsappSession>(
    `insert into whatsapp_sessions(
       phone_e164, state, authenticated_user_id, active_request_id, pending_vehicle_plate,
       pending_amount_cents, cpf_hash, cpf_last4, failed_cpf_attempts, failed_mfa_attempts,
       authentication_attempts, locked_until, authenticated_at, expires_at, last_message_id,
       metadata, last_interaction_at, updated_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),now())
     on conflict (phone_e164)
     do update set state = excluded.state,
                   authenticated_user_id = excluded.authenticated_user_id,
                   active_request_id = excluded.active_request_id,
                   pending_vehicle_plate = excluded.pending_vehicle_plate,
                   pending_amount_cents = excluded.pending_amount_cents,
                   cpf_hash = coalesce(excluded.cpf_hash, whatsapp_sessions.cpf_hash),
                   cpf_last4 = coalesce(excluded.cpf_last4, whatsapp_sessions.cpf_last4),
                   failed_cpf_attempts = excluded.failed_cpf_attempts,
                   failed_mfa_attempts = excluded.failed_mfa_attempts,
                   authentication_attempts = excluded.authentication_attempts,
                   locked_until = excluded.locked_until,
                   authenticated_at = excluded.authenticated_at,
                   expires_at = excluded.expires_at,
                   last_message_id = excluded.last_message_id,
                   metadata = excluded.metadata,
                   last_interaction_at = now(),
                   updated_at = now()
     returning *`,
    [
      input.phoneE164,
      input.state,
      input.authenticatedUserId ?? null,
      input.activeRequestId ?? null,
      input.pendingVehiclePlate ?? null,
      input.pendingAmountCents ?? null,
      cpf?.hash ?? null,
      cpf?.last4 ?? null,
      input.failedCpfAttempts ?? 0,
      input.failedMfaAttempts ?? 0,
      input.authenticationAttempts ?? 0,
      input.lockedUntil ?? null,
      input.authenticatedAt ?? null,
      input.expiresAt,
      input.lastMessageId ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return result.rows[0];
}

export async function recordWhatsappAuthAttempt(input: {
  sessionId?: string;
  phoneE164: string;
  attemptKind: "CPF" | "MFA";
  success: boolean;
  cpf?: string;
  userId?: string;
  errorCode?: string;
  blockedUntil?: Date | null;
}): Promise<void> {
  const cpf = input.cpf ? hashCpfForLookup(input.cpf) : null;
  await getPool().query(
    `insert into whatsapp_auth_attempts(
       session_id, phone_e164, attempt_kind, success, cpf_hash, cpf_last4, user_id, error_code, blocked_until
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      input.sessionId ?? null,
      input.phoneE164,
      input.attemptKind,
      input.success,
      cpf?.hash ?? null,
      cpf?.last4 ?? null,
      input.userId ?? null,
      input.errorCode ?? null,
      input.blockedUntil ?? null,
    ],
  );
}

export async function findRequestNotification(input: {
  requestId: string;
  eventKey: string;
  channel: string;
}): Promise<DbRequestNotification | null> {
  const result = await getPool().query<DbRequestNotification>(
    `select *
       from request_notifications
      where request_id = $1
        and event_key = $2
        and channel = $3`,
    [input.requestId, input.eventKey, input.channel],
  );
  return result.rows[0] ?? null;
}

export async function markRequestNotification(input: {
  requestId: string;
  eventKey: string;
  channel: string;
  recipientPhoneE164?: string | null;
  providerMessageId?: string | null;
  status: string;
}): Promise<DbRequestNotification> {
  const result = await getPool().query<DbRequestNotification>(
    `insert into request_notifications(
       request_id, event_key, channel, recipient_phone_e164, provider_message_id, status, sent_at
     ) values ($1,$2,$3,$4,$5,$6,case when $6 = 'sent' then now() else null end)
     on conflict (request_id, event_key, channel)
     do update set recipient_phone_e164 = excluded.recipient_phone_e164,
                   provider_message_id = excluded.provider_message_id,
                   status = excluded.status,
                   sent_at = case when excluded.status = 'sent' then now() else request_notifications.sent_at end
     returning *`,
    [
      input.requestId,
      input.eventKey,
      input.channel,
      input.recipientPhoneE164 ?? null,
      input.providerMessageId ?? null,
      input.status,
    ],
  );
  return result.rows[0];
}

export async function appendMaskedAuditEvent(input: {
  requestId?: string;
  actorUserId?: string;
  eventType: string;
  payload: Record<string, unknown>;
  cpf?: string;
  phoneE164?: string;
}): Promise<void> {
  const maskedPayload = {
    ...input.payload,
    ...(input.cpf ? { cpf: maskCpf(input.cpf) } : {}),
    ...(input.phoneE164
      ? { phone: `${input.phoneE164.slice(0, Math.max(0, input.phoneE164.length - 4))}****` }
      : {}),
  };
  await appendAuditEvent({
    requestId: input.requestId,
    actorUserId: input.actorUserId,
    eventType: input.eventType,
    payload: maskedPayload,
  });
}

export async function getRequestNotificationContext(requestId: string): Promise<{
  request: DbRequest;
  requester: DbUserContext;
  requesterPhoneE164: string | null;
} | null> {
  const request = await getRequest(requestId);
  if (!request) return null;
  const requester = await getUserContext(request.requester_id);
  if (!requester) return null;
  const requesterPhoneE164 = await getPrimaryAuthorizedPhoneByUserId(request.requester_id);
  return {
    request,
    requester,
    requesterPhoneE164,
  };
}

export async function recordWhatsappMessage(input: {
  providerMessageId?: string;
  phoneE164?: string;
  direction: "in" | "out";
  requestId?: string;
  body?: string;
  payload?: unknown;
}): Promise<boolean> {
  const payloadHash = input.payload
    ? createHash("sha256").update(JSON.stringify(input.payload)).digest("hex")
    : null;

  const result = await getPool().query(
    `insert into whatsapp_messages(provider_message_id, phone_e164, direction, request_id, payload_hash, body)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (provider_message_id) do nothing`,
    [
      input.providerMessageId ?? null,
      input.phoneE164 ?? null,
      input.direction,
      input.requestId ?? null,
      payloadHash,
      input.body ?? null,
    ],
  );

  return (result.rowCount ?? 0) === 1;
}
