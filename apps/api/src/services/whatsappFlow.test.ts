import assert from "node:assert/strict";
import test from "node:test";
import { WhatsappFlowService, type WhatsappFlowDependencies } from "./whatsappFlow.js";
import { config } from "../config.js";

function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    phone_e164: "+5511999999999",
    state: "AGUARDANDO_CPF",
    authenticated_user_id: null,
    active_request_id: null,
    pending_vehicle_plate: null,
    pending_amount_cents: null,
    cpf_hash: null,
    cpf_last4: null,
    failed_cpf_attempts: 0,
    failed_mfa_attempts: 0,
    authentication_attempts: 0,
    locked_until: null,
    authenticated_at: null,
    expires_at: new Date(Date.now() + 60_000),
    last_message_id: null,
    last_interaction_at: new Date(),
    metadata: {},
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as any;
}

function createService(partialDeps: Partial<WhatsappFlowDependencies>) {
  const sentMessages: Array<{ toPhoneE164: string; body: string }> = [];
  const provider = {
    async sendTextMessage(message: { toPhoneE164: string; body: string }) {
      sentMessages.push(message);
      return { providerMessageId: `out-${sentMessages.length}` };
    },
  };

  const baseDeps: WhatsappFlowDependencies = {
    appendMaskedAuditEvent: async () => undefined,
    createRequest: async () =>
      ({
        id: "req-1",
        requester_id: "user-1",
        vehicle_plate: "PWH4E85",
        vehicle_group: "UTILITARIOS",
        requested_amount: "10.00",
        channel: "whatsapp",
        status: "NA_FILA",
        expires_at: new Date(),
      }) as any,
    findRequestNotification: async () => null,
    getActiveRequestByPlate: async () => null,
    getPrimaryAuthorizedPhoneByUserId: async () => "+5511988887777",
    getRequest: async () => null,
    getRequestNotificationContext: async () => null,
    getLatestWhatsappRequestByRequester: async () => null,
    getUserContext: async () =>
      ({
        id: "user-1",
        name: "Supervisor",
        employee_number: "1",
        corporate_email: "sup@example.com",
        operation_scope: "GERAL",
        status: "active",
        roles: ["SUPERVISOR"],
      }) as any,
    getVehicleByPlate: async () =>
      ({
        id: "vehicle-1",
        plate: "PWH4E85",
        vehicle_group: "UTILITARIOS",
        operation_scope: "GERAL",
        status: "active",
        current_limit: "20.00",
      }) as any,
    getWhatsappSessionByPhone: async () => buildSession(),
    hasAuthorizedPhoneForUser: async () => false,
    isAuthorizedPhoneForUser: async () => true,
    listCoordinatorsByScope: async () => [],
    markRequestNotification: async () => ({}) as any,
    recordWhatsappAuthAttempt: async () => undefined,
    recordWhatsappMessage: async () => true,
    transitionRequest: async () => ({}) as any,
    upsertWhatsappSession: async () => buildSession(),
    findUserByCpf: async () =>
      ({
        id: "user-1",
        name: "Supervisor",
        employee_number: "1",
        corporate_email: "sup@example.com",
        status: "active",
      }) as any,
    rejectRequest: async () => ({}) as any,
    enqueueLimitRequest: async () => undefined,
    decryptText: () => "SECRET",
    verifyTotpCode: () => true,
    ...partialDeps,
  };

  return {
    service: new WhatsappFlowService(provider as any, baseDeps),
    sentMessages,
  };
}

test("invalid CPF keeps the session waiting for CPF", async () => {
  const { service, sentMessages } = createService({
    getWhatsappSessionByPhone: async () => buildSession({ state: "AGUARDANDO_CPF" }),
  });

  await service.handleInboundMessage({
    providerMessageId: "msg-1",
    phoneE164: "+5511999999999",
    text: "123",
  });

  assert.match(sentMessages[0].body, /CPF invalido/i);
});

test("valid CPF asks for MFA", async () => {
  const { service, sentMessages } = createService({
    getWhatsappSessionByPhone: async () => buildSession({ state: "AGUARDANDO_CPF" }),
  });

  await service.handleInboundMessage({
    providerMessageId: "msg-1",
    phoneE164: "+5511999999999",
    text: "12345678909",
  });

  assert.match(sentMessages[0].body, /Google Authenticator/i);
});

test("first contact without greeting still asks for CPF", async () => {
  const { service, sentMessages } = createService({
    getWhatsappSessionByPhone: async () => null,
  });

  await service.handleInboundMessage({
    providerMessageId: "msg-entry-1",
    phoneE164: "+5511999999999",
    text: "preciso de limite",
  });

  assert.match(sentMessages[0].body, /envie seu CPF/i);
});

test("valid MFA authenticates and requests plate and amount", async () => {
  const { service, sentMessages } = createService({
    getWhatsappSessionByPhone: async () =>
      buildSession({
        state: "AGUARDANDO_MFA",
        authenticated_user_id: "user-1",
        cpf_last4: "8909",
      }),
    getUserContext: async () =>
      ({
        id: "user-1",
        name: "Supervisor",
        employee_number: "1",
        corporate_email: "sup@example.com",
        operation_scope: "GERAL",
        status: "active",
        roles: ["SUPERVISOR"],
        mfa_enabled: true,
        mfa_secret_encrypted: Buffer.from("encrypted"),
      }) as any,
  });

  await service.handleInboundMessage({
    providerMessageId: "msg-2",
    phoneE164: "+5511999999999",
    text: "123456",
  });

  assert.match(sentMessages[0].body, /placa e o valor/i);
});

test("plate and amount in same message request confirmation", async () => {
  const { service, sentMessages } = createService({
    getWhatsappSessionByPhone: async () =>
      buildSession({
        state: "AUTENTICADO",
        authenticated_user_id: "user-1",
        authenticated_at: new Date(),
      }),
  });

  await service.handleInboundMessage({
    providerMessageId: "msg-3",
    phoneE164: "+5511999999999",
    text: "PWH4E85 10,00",
  });

  assert.match(sentMessages[0].body, /Confirme os dados da solicitacao/i);
  assert.match(sentMessages[0].body, /PWH4E85/);
  assert.match(sentMessages[0].body, /10,00|10\.00|R\$\s*10,00/i);
});

test("separated plate and amount asks only the missing field", async () => {
  const { service, sentMessages } = createService({
    getWhatsappSessionByPhone: async () =>
      buildSession({
        state: "AUTENTICADO",
        authenticated_user_id: "user-1",
        authenticated_at: new Date(),
      }),
  });

  await service.handleInboundMessage({
    providerMessageId: "msg-4",
    phoneE164: "+5511999999999",
    text: "PWH4E85",
  });

  assert.match(sentMessages[0].body, /novo limite/i);
});

test("separated plate and amount preserves the plate state for the next message", async () => {
  let currentSession = buildSession({
    state: "AUTENTICADO",
    authenticated_user_id: "user-1",
    authenticated_at: new Date(),
  });
  const { service, sentMessages } = createService({
    getWhatsappSessionByPhone: async () => currentSession,
    upsertWhatsappSession: async (input: any) => {
      currentSession = buildSession({
        state: input.state,
        authenticated_user_id: input.authenticatedUserId ?? currentSession.authenticated_user_id,
        active_request_id: input.activeRequestId ?? null,
        pending_vehicle_plate: input.pendingVehiclePlate ?? null,
        pending_amount_cents: input.pendingAmountCents ?? null,
        authenticated_at: input.authenticatedAt ?? currentSession.authenticated_at,
        metadata: input.metadata ?? {},
      });
      return currentSession;
    },
  });

  await service.handleInboundMessage({
    providerMessageId: "msg-separated-plate",
    phoneE164: "+5511999999999",
    text: "PWH4E85",
  });
  assert.equal(currentSession.state, "AGUARDANDO_VALOR");
  assert.equal(currentSession.pending_vehicle_plate, "PWH4E85");

  await service.handleInboundMessage({
    providerMessageId: "msg-separated-amount",
    phoneE164: "+5511999999999",
    text: "10",
  });

  assert.equal(currentSession.state, "AGUARDANDO_CONFIRMACAO");
  assert.match(sentMessages[sentMessages.length - 1].body, /Confirme os dados da solicitacao/i);
});

test("confirmation message id makes each legitimate Whatsapp request unique", async () => {
  let capturedIdempotencyKey = "";
  const { service } = createService({
    getWhatsappSessionByPhone: async () =>
      buildSession({
        state: "AGUARDANDO_CONFIRMACAO",
        authenticated_user_id: "user-1",
        pending_vehicle_plate: "PWH4E85",
        pending_amount_cents: 1000,
        authenticated_at: new Date(),
        metadata: { vehicleGroup: "UTILITARIOS" },
      }),
    createRequest: async (input: any) => {
      capturedIdempotencyKey = input.idempotencyKey;
      return {
        id: "req-unique",
        requester_id: "user-1",
        vehicle_plate: "PWH4E85",
        vehicle_group: "UTILITARIOS",
        requested_amount: "10.00",
        channel: "whatsapp",
        status: "NA_FILA",
        expires_at: new Date(),
      } as any;
    },
  });

  await service.handleInboundMessage({
    providerMessageId: "wamid.unique-confirmation",
    phoneE164: "+5511999999999",
    text: "confirmar",
  });

  const firstKey = capturedIdempotencyKey;
  capturedIdempotencyKey = "";
  await service.handleInboundMessage({
    providerMessageId: "wamid.another-confirmation",
    phoneE164: "+5511999999999",
    text: "confirmar",
  });

  assert.notEqual(firstKey, capturedIdempotencyKey);
});

test("request requiring approval is parked instead of enqueued", async () => {
  const previousThreshold = config.groupPolicies.UTILITARIOS.doubleApprovalFrom;
  config.groupPolicies.UTILITARIOS.doubleApprovalFrom = 5;
  let queued = false;

  const { service, sentMessages } = createService({
    getWhatsappSessionByPhone: async () =>
      buildSession({
        state: "AGUARDANDO_CONFIRMACAO",
        authenticated_user_id: "user-1",
        pending_vehicle_plate: "PWH4E85",
        pending_amount_cents: 1000,
        authenticated_at: new Date(),
        metadata: { vehicleGroup: "UTILITARIOS" },
      }),
    createRequest: async () =>
      ({
        id: "req-approval",
        requester_id: "user-1",
        vehicle_plate: "PWH4E85",
        vehicle_group: "UTILITARIOS",
        requested_amount: "10.00",
        channel: "whatsapp",
        status: "AGUARDANDO_SEGUNDA_APROVACAO",
        expires_at: new Date(),
      }) as any,
    enqueueLimitRequest: async () => {
      queued = true;
    },
  });

  await service.handleInboundMessage({
    providerMessageId: "msg-5",
    phoneE164: "+5511999999999",
    text: "confirmar",
  });

  assert.equal(queued, false);
  assert.match(sentMessages[sentMessages.length - 1].body, /aguardando aprovacao/i);
  config.groupPolicies.UTILITARIOS.doubleApprovalFrom = previousThreshold;
});

test("cancel command resets current flow", async () => {
  const { service, sentMessages } = createService({
    getWhatsappSessionByPhone: async () =>
      buildSession({
        state: "AUTENTICADO",
        authenticated_user_id: "user-1",
        pending_vehicle_plate: "PWH4E85",
        pending_amount_cents: 1000,
      }),
  });

  await service.handleInboundMessage({
    providerMessageId: "msg-6",
    phoneE164: "+5511999999999",
    text: "cancelar",
  });

  assert.match(sentMessages[0].body, /Solicitacao cancelada/i);
});

test("failed previous request does not block a new request", async () => {
  const { service, sentMessages } = createService({
    getWhatsappSessionByPhone: async () =>
      buildSession({
        state: "PROCESSANDO",
        authenticated_user_id: "user-1",
        active_request_id: "req-old",
        authenticated_at: new Date(),
      }),
    getRequest: async (id: string) =>
      id === "req-old"
        ? ({
            id: "req-old",
            requester_id: "user-1",
            vehicle_plate: "OLD1A23",
            vehicle_group: "UTILITARIOS",
            requested_amount: "10.00",
            channel: "whatsapp",
            status: "RESULTADO_INDETERMINADO",
            expires_at: new Date(),
          } as any)
        : null,
    upsertWhatsappSession: async (input: any) =>
      buildSession({
        state: input.state ?? "AUTENTICADO",
        authenticated_user_id: input.authenticatedUserId ?? "user-1",
        active_request_id: input.activeRequestId ?? null,
        pending_vehicle_plate: input.pendingVehiclePlate ?? null,
        pending_amount_cents: input.pendingAmountCents ?? null,
        authenticated_at: new Date(),
      }),
  });

  await service.handleInboundMessage({
    providerMessageId: "msg-entry-2",
    phoneE164: "+5511999999999",
    text: "PWH4E85 10,00",
  });

  assert.match(sentMessages[0].body, /Confirme os dados da solicitacao/i);
  assert.match(sentMessages[0].body, /PWH4E85/);
});

test("failed previous request with random text shows guided menu instead of asking for plate", async () => {
  const { service, sentMessages } = createService({
    getWhatsappSessionByPhone: async () =>
      buildSession({
        state: "PROCESSANDO",
        authenticated_user_id: "user-1",
        active_request_id: "req-old",
        authenticated_at: new Date(),
      }),
    getRequest: async (id: string) =>
      id === "req-old"
        ? ({
            id: "req-old",
            requester_id: "user-1",
            vehicle_plate: "OLD1A23",
            vehicle_group: "UTILITARIOS",
            requested_amount: "10.00",
            channel: "whatsapp",
            status: "RESULTADO_INDETERMINADO",
            expires_at: new Date(),
          } as any)
        : null,
    upsertWhatsappSession: async (input: any) =>
      buildSession({
        state: input.state ?? "ERRO",
        authenticated_user_id: input.authenticatedUserId ?? "user-1",
        active_request_id: input.activeRequestId ?? null,
        pending_vehicle_plate: input.pendingVehiclePlate ?? null,
        pending_amount_cents: input.pendingAmountCents ?? null,
        authenticated_at: new Date(),
      }),
  });

  await service.handleInboundMessage({
    providerMessageId: "msg-entry-3",
    phoneE164: "+5511999999999",
    text: "j",
  });

  assert.doesNotMatch(sentMessages[0].body, /Informe a placa do veiculo/i);
  assert.match(sentMessages[0].body, /nova solicitacao|placa e o valor|Opcoes/i);
});

test("authenticated session does not treat CPF-like input as amount", async () => {
  const { service, sentMessages } = createService({
    getWhatsappSessionByPhone: async () =>
      buildSession({
        state: "AUTENTICADO",
        authenticated_user_id: "user-1",
        authenticated_at: new Date(),
      }),
  });

  await service.handleInboundMessage({
    providerMessageId: "msg-entry-4",
    phoneE164: "+5511999999999",
    text: "44214899806",
  });

  assert.match(sentMessages[0].body, /sessao ja esta autenticada|placa e o valor/i);
  assert.doesNotMatch(sentMessages[0].body, /Valor invalido/i);
});

test("terminal request remains available for status follow-up", async () => {
  const terminalRequest = {
    id: "req-terminal",
    requester_id: "user-1",
    vehicle_plate: "PWH4E85",
    vehicle_group: "UTILITARIOS",
    requested_amount: "10.00",
    channel: "whatsapp",
    status: "RESULTADO_INDETERMINADO",
    expires_at: new Date(),
  } as any;

  const { service, sentMessages } = createService({
    getWhatsappSessionByPhone: async () =>
      buildSession({
        state: "ERRO",
        authenticated_user_id: "user-1",
        active_request_id: "req-terminal",
        authenticated_at: new Date(),
      }),
    getRequest: async (id: string) => (id === "req-terminal" ? terminalRequest : null),
  });

  await service.handleInboundMessage({
    providerMessageId: "msg-entry-5",
    phoneE164: "+5511999999999",
    text: "?",
  });

  assert.match(sentMessages[0].body, /Status atual: RESULTADO_INDETERMINADO/i);
  assert.match(sentMessages[0].body, /PWH4E85/i);
});

test("new request option from no active status asks directly for plate", async () => {
  const { service, sentMessages } = createService({
    getWhatsappSessionByPhone: async () =>
      buildSession({
        state: "AUTENTICADO",
        authenticated_user_id: "user-1",
        active_request_id: null,
        authenticated_at: new Date(),
      }),
  });

  await service.handleInboundMessage({
    providerMessageId: "msg-entry-6",
    phoneE164: "+5511999999999",
    text: "op_nova_solicitacao",
  });

  assert.match(sentMessages[0].body, /Informe a placa do veiculo/i);
});

test("new request option does not restore the latest terminal request", async () => {
  const { service, sentMessages } = createService({
    getWhatsappSessionByPhone: async () =>
      buildSession({
        state: "ERRO",
        authenticated_user_id: "user-1",
        active_request_id: null,
        authenticated_at: new Date(),
      }),
    getLatestWhatsappRequestByRequester: async () =>
      ({
        id: "req-old-terminal",
        requester_id: "user-1",
        vehicle_plate: "OLD1A23",
        vehicle_group: "UTILITARIOS",
        requested_amount: "10.00",
        channel: "whatsapp",
        status: "RESULTADO_INDETERMINADO",
        expires_at: new Date(),
      }) as any,
    upsertWhatsappSession: async (input: any) =>
      buildSession({
        state: input.state,
        authenticated_user_id: input.authenticatedUserId ?? "user-1",
        active_request_id: input.activeRequestId ?? null,
        pending_vehicle_plate: input.pendingVehiclePlate ?? null,
        pending_amount_cents: input.pendingAmountCents ?? null,
        authenticated_at: input.authenticatedAt ?? new Date(),
        metadata: input.metadata ?? {},
      }),
  });

  await service.handleInboundMessage({
    providerMessageId: "msg-new-after-error",
    phoneE164: "+5511999999999",
    text: "op_nova_solicitacao",
  });

  assert.match(sentMessages[0].body, /Nova solicitacao iniciada|Informe a placa do veiculo/i);
  assert.doesNotMatch(sentMessages[0].body, /OLD1A23|RESULTADO_INDETERMINADO/i);
});

test("new request option replaces an unfinished draft", async () => {
  const { service, sentMessages } = createService({
    getWhatsappSessionByPhone: async () =>
      buildSession({
        state: "AGUARDANDO_CONFIRMACAO",
        authenticated_user_id: "user-1",
        pending_vehicle_plate: "PWH4E85",
        pending_amount_cents: 1000,
        authenticated_at: new Date(),
        metadata: { vehicleGroup: "UTILITARIOS" },
      }),
  });

  await service.handleInboundMessage({
    providerMessageId: "msg-replace-draft",
    phoneE164: "+5511999999999",
    text: "op_nova_solicitacao",
  });

  assert.match(sentMessages[0].body, /Nova solicitacao iniciada/i);
  assert.doesNotMatch(sentMessages[0].body, /confirme a solicitacao ou cancele/i);
});
