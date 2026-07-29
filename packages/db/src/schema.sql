create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  employee_number text unique not null,
  corporate_email text unique not null,
  cpf_hash text unique,
  cpf_last4 text,
  operation_scope text not null default 'GERAL',
  password_hash text,
  password_changed_at timestamptz,
  mfa_secret_encrypted bytea,
  mfa_enabled boolean not null default false,
  mfa_enrolled_at timestamptz,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

alter table if exists users
  add column if not exists cpf_hash text,
  add column if not exists cpf_last4 text,
  add column if not exists operation_scope text not null default 'GERAL',
  add column if not exists password_hash text,
  add column if not exists password_changed_at timestamptz,
  add column if not exists mfa_secret_encrypted bytea,
  add column if not exists mfa_enabled boolean not null default false,
  add column if not exists mfa_enrolled_at timestamptz;

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null
);

create table if not exists permissions (
  id uuid primary key default gen_random_uuid(),
  key text unique not null
);

create table if not exists user_roles (
  user_id uuid not null references users(id),
  role_id uuid not null references roles(id),
  primary key (user_id, role_id)
);

create table if not exists role_permissions (
  role_id uuid not null references roles(id),
  permission_id uuid not null references permissions(id),
  primary key (role_id, permission_id)
);

create table if not exists authorized_phones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  phone_e164 text unique not null,
  verified_at timestamptz,
  revoked_at timestamptz
);

create table if not exists auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  token_hash text unique not null,
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists idx_auth_sessions_user_active
  on auth_sessions(user_id, expires_at)
  where revoked_at is null;

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  plate text unique not null,
  vehicle_group text,
  operation_scope text,
  status text,
  current_limit numeric(12,2),
  updated_at timestamptz not null default now()
);

create table if not exists limit_policies (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null,
  scope_id uuid,
  max_amount numeric(12,2) not null,
  period_window text not null default '24 hours',
  double_approval_from numeric(12,2) not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists requests (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text unique not null,
  vehicle_plate text not null,
  vehicle_group text not null default 'GERAL_DE_RESTRICOES',
  requested_amount numeric(12,2) not null check (requested_amount > 0),
  previous_limit numeric(12,2),
  new_limit numeric(12,2),
  requester_id uuid not null references users(id),
  channel text not null,
  status text not null,
  justification text,
  platform_result text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists vehicles
  add column if not exists vehicle_group text,
  add column if not exists operation_scope text;

alter table if exists requests
  add column if not exists vehicle_group text not null default 'GERAL_DE_RESTRICOES';

create table if not exists approval_tokens (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id),
  expected_user_id uuid not null references users(id),
  token_hash text unique not null,
  used_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id),
  approver_id uuid not null references users(id),
  level int not null,
  decision text not null,
  justification text,
  decided_at timestamptz not null default now(),
  unique (request_id, approver_id),
  unique (request_id, level)
);

alter table if exists approvals
  add column if not exists justification text;

create table if not exists automation_steps (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id),
  step_key text not null,
  status text not null,
  started_at timestamptz,
  finished_at timestamptz,
  evidence_id uuid,
  error_code text,
  unique (request_id, step_key)
);

create table if not exists execution_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id),
  job_id text,
  attempt_no int not null,
  worker_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result text
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid,
  actor_user_id uuid,
  event_type text not null,
  payload_hash text not null,
  payload_encrypted bytea,
  previous_event_hash text,
  event_hash text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text unique,
  phone_e164 text,
  direction text not null,
  request_id uuid,
  payload_hash text,
  body text,
  received_at timestamptz not null default now()
);

create table if not exists whatsapp_sessions (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text unique not null,
  state text not null,
  authenticated_user_id uuid references users(id),
  active_request_id uuid references requests(id),
  pending_vehicle_plate text,
  pending_amount_cents bigint,
  cpf_hash text,
  cpf_last4 text,
  failed_cpf_attempts int not null default 0,
  failed_mfa_attempts int not null default 0,
  authentication_attempts int not null default 0,
  locked_until timestamptz,
  authenticated_at timestamptz,
  expires_at timestamptz not null,
  last_message_id text,
  last_interaction_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_sessions_state_expires
  on whatsapp_sessions(state, expires_at);

create table if not exists whatsapp_auth_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references whatsapp_sessions(id),
  phone_e164 text not null,
  attempt_kind text not null,
  success boolean not null,
  cpf_hash text,
  cpf_last4 text,
  user_id uuid references users(id),
  error_code text,
  blocked_until timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_auth_attempts_phone_created
  on whatsapp_auth_attempts(phone_e164, created_at desc);

create table if not exists request_status_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id),
  from_status text,
  to_status text not null,
  actor_user_id uuid references users(id),
  origin text not null default 'SYSTEM',
  reason_code text,
  created_at timestamptz not null default now()
);

create index if not exists idx_request_status_history_request_created
  on request_status_history(request_id, created_at desc);

create table if not exists request_notifications (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id),
  event_key text not null,
  channel text not null,
  recipient_phone_e164 text,
  provider_message_id text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (request_id, event_key, channel)
);

create index if not exists idx_request_notifications_request_created
  on request_notifications(request_id, created_at desc);

create table if not exists platform_sessions (
  id uuid primary key default gen_random_uuid(),
  account_label text not null,
  encrypted_storage_state bytea,
  status text not null,
  last_validated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

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
);

create index if not exists idx_operational_runtime_heartbeat
  on operational_runtime(heartbeat_at);

create table if not exists evidences (
  id uuid primary key default gen_random_uuid(),
  request_id uuid,
  storage_url text not null,
  redaction_status text not null default 'pending',
  sha256 text not null,
  created_at timestamptz not null default now()
);

create table if not exists manual_incidents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id),
  reason text not null,
  assigned_to uuid,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists uq_active_plate_processing
  on requests(vehicle_plate)
  where status in ('NA_FILA', 'EM_PROCESSAMENTO', 'LIMITE_ALTERADO');

create index if not exists idx_requests_status_created on requests(status, created_at);
create index if not exists idx_requests_plate_created on requests(vehicle_plate, created_at);
create index if not exists idx_audit_request_created on audit_events(request_id, created_at);
create unique index if not exists uq_whatsapp_provider_msg on whatsapp_messages(provider_message_id);
create unique index if not exists uq_active_limit_policy_scope on limit_policies(scope_type) where active is true;

insert into roles(name) values ('SUPERVISOR'), ('COORDENADOR'), ('SOLICITANTE'), ('APROVADOR'), ('ADMINISTRADOR')
on conflict (name) do nothing;

insert into permissions(key) values
  ('request:view:self'),
  ('request:view:scope'),
  ('request:create'),
  ('request:approve'),
  ('request:second-approve'),
  ('request:reject'),
  ('request:retry'),
  ('admin:users'),
  ('admin:policies'),
  ('audit:read')
on conflict (key) do nothing;

insert into limit_policies(scope_type, scope_id, max_amount, period_window, double_approval_from, active)
values
  ('vehicle_group:GERAL_DE_RESTRICOES', null, 2000.00, '24 hours', 0.00, true),
  ('vehicle_group:VEICULO_DE_PASSEIO', null, 70.00, '24 hours', 0.00, true),
  ('vehicle_group:UTILITARIOS', null, 90.00, '24 hours', 0.00, true),
  ('vehicle_group:VAN', null, 100.00, '24 hours', 0.00, true),
  ('vehicle_group:VUC', null, 150.00, '24 hours', 0.00, true)
on conflict do nothing;
