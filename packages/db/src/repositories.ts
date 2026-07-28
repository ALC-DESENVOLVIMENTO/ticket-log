import { randomBytes, createHash } from "node:crypto";
import { assertTransition, type RequestState } from "@ticketlog/domain";
import { getPool } from "./client.js";
import { appendAuditEvent } from "./audit.js";

export interface DbUser {
  id: string;
  name: string;
  employee_number: string;
  corporate_email: string;
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
    "select id, name, employee_number, corporate_email, status, mfa_enabled from users order by name",
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

export async function upsertUser(input: {
  name: string;
  employeeNumber: string;
  corporateEmail: string;
  passwordHash?: string;
  phoneE164?: string;
  roles?: string[];
}): Promise<DbUser> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const user = await client.query<DbUser>(
      `insert into users(name, employee_number, corporate_email, password_hash, password_changed_at, status)
       values ($1, $2, $3, $4, case when $4 is null then null else now() end, 'active')
       on conflict (corporate_email)
       do update set name = excluded.name,
                     employee_number = excluded.employee_number,
                     password_hash = coalesce(excluded.password_hash, users.password_hash),
                     password_changed_at = case when excluded.password_hash is null then users.password_changed_at else now() end,
                     status = 'active'
       returning *`,
      [input.name, input.employeeNumber, input.corporateEmail, input.passwordHash ?? null],
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

    for (const role of input.roles ?? ["SOLICITANTE"]) {
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
}): Promise<void> {
  await getPool().query(
    `insert into approvals(request_id, approver_id, level, decision)
     values ($1, $2, $3, $4)
     on conflict (request_id, approver_id) do nothing`,
    [input.requestId, input.approverId, input.level, input.decision],
  );
  await appendAuditEvent({
    requestId: input.requestId,
    actorUserId: input.approverId,
    eventType: "REQUEST_APPROVAL_RECORDED",
    payload: { level: input.level, decision: input.decision },
  });
}

export async function getRequest(id: string): Promise<DbRequest | null> {
  const result = await getPool().query<DbRequest>("select * from requests where id = $1", [id]);
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
