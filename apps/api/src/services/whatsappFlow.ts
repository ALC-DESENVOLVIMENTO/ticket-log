import {
  buildRequestIdempotencyKey,
  formatAppDateTime,
  evaluateLimitPolicy,
  formatRequestProtocol,
  isValidBrazilianPlate,
  isValidCpf,
  maskCpf,
  normalizeCpf,
  normalizePlate,
  parseMoneyToCents,
  centsToAmount,
  type VehicleGroup,
} from "@ticketlog/domain";
import {
  appendMaskedAuditEvent,
  createRequest,
  findRequestNotification,
  getActiveRequestByPlate,
  getPrimaryAuthorizedPhoneByUserId,
  getRequest,
  getRequestNotificationContext,
  getLatestWhatsappRequestByRequester,
  getUserContext,
  getVehicleByPlate,
  getWhatsappSessionByPhone,
  hasAuthorizedPhoneForUser,
  isAuthorizedPhoneForUser,
  listCoordinatorsByScope,
  markRequestNotification,
  recordWhatsappAuthAttempt,
  recordWhatsappMessage,
  transitionRequest,
  upsertWhatsappSession,
  findUserByCpf,
  type DbRequest,
  type DbUserContext,
  rejectRequest,
} from "@ticketlog/db";
import type { WhatsappOption, WhatsappProvider } from "@ticketlog/whatsapp";
import { enqueueLimitRequest } from "@ticketlog/queue";
import { config } from "../config.js";
import { verifyTotpCode } from "../mfa.js";
import { resolveAccessProfile } from "../roles.js";
import { decryptText } from "../security.js";

export type WhatsappConversationState =
  | "INICIO"
  | "AGUARDANDO_CPF"
  | "AGUARDANDO_MFA"
  | "AUTENTICADO"
  | "AGUARDANDO_PLACA"
  | "AGUARDANDO_VALOR"
  | "AGUARDANDO_CONFIRMACAO"
  | "PROCESSANDO"
  | "PENDENTE_APROVACAO"
  | "CONCLUIDO"
  | "ERRO"
  | "EXPIRADO";

interface PendingInput {
  plate: string;
  amountCents: number;
  vehicleGroup: VehicleGroup;
}

export interface WhatsappFlowDependencies {
  appendMaskedAuditEvent: typeof appendMaskedAuditEvent;
  createRequest: typeof createRequest;
  findRequestNotification: typeof findRequestNotification;
  getActiveRequestByPlate: typeof getActiveRequestByPlate;
  getPrimaryAuthorizedPhoneByUserId: typeof getPrimaryAuthorizedPhoneByUserId;
  getRequest: typeof getRequest;
  getRequestNotificationContext: typeof getRequestNotificationContext;
  getLatestWhatsappRequestByRequester: typeof getLatestWhatsappRequestByRequester;
  getUserContext: typeof getUserContext;
  getVehicleByPlate: typeof getVehicleByPlate;
  getWhatsappSessionByPhone: typeof getWhatsappSessionByPhone;
  hasAuthorizedPhoneForUser: typeof hasAuthorizedPhoneForUser;
  isAuthorizedPhoneForUser: typeof isAuthorizedPhoneForUser;
  listCoordinatorsByScope: typeof listCoordinatorsByScope;
  markRequestNotification: typeof markRequestNotification;
  recordWhatsappAuthAttempt: typeof recordWhatsappAuthAttempt;
  recordWhatsappMessage: typeof recordWhatsappMessage;
  transitionRequest: typeof transitionRequest;
  upsertWhatsappSession: typeof upsertWhatsappSession;
  findUserByCpf: typeof findUserByCpf;
  rejectRequest: typeof rejectRequest;
  enqueueLimitRequest: typeof enqueueLimitRequest;
  decryptText: typeof decryptText;
  verifyTotpCode: typeof verifyTotpCode;
}

const defaultWhatsappFlowDependencies: WhatsappFlowDependencies = {
  appendMaskedAuditEvent,
  createRequest,
  findRequestNotification,
  getActiveRequestByPlate,
  getPrimaryAuthorizedPhoneByUserId,
  getRequest,
  getRequestNotificationContext,
  getLatestWhatsappRequestByRequester,
  getUserContext,
  getVehicleByPlate,
  getWhatsappSessionByPhone,
  hasAuthorizedPhoneForUser,
  isAuthorizedPhoneForUser,
  listCoordinatorsByScope,
  markRequestNotification,
  recordWhatsappAuthAttempt,
  recordWhatsappMessage,
  transitionRequest,
  upsertWhatsappSession,
  findUserByCpf,
  rejectRequest,
  enqueueLimitRequest,
  decryptText,
  verifyTotpCode,
};

function normalizeMessageText(input: string): string {
  return input.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function lowerMessage(input: string): string {
  return normalizeMessageText(input).toLowerCase();
}

function maskPhone(phoneE164: string): string {
  if (phoneE164.length <= 4) return "****";
  return `${phoneE164.slice(0, phoneE164.length - 4)}****`;
}

function sessionExpiry(now: Date): Date {
  return new Date(now.getTime() + config.whatsappSessionExpiryMinutes * 60_000);
}

function parsePlateAndAmount(text: string): {
  plate?: string;
  amountCents?: number;
  invalidAmount?: boolean;
} {
  const normalized = normalizeMessageText(text);
  const plateMatch = normalized.match(/[A-Za-z]{3}[-\s]?[0-9][A-Za-z0-9][0-9]{2}/);
  const amountSource = plateMatch?.[0]
    ? normalized.replace(plateMatch[0], " ").trim()
    : normalized;
  const amountMatch = amountSource.match(
    /(?:R\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{2})|(?:R\$\s*)?\d{1,5}(?:,\d{2})?|(?:R\$\s*)?\d{1,5}(?:\.\d{2})?/,
  );

  let amountCents: number | undefined;
  let invalidAmount = false;
  if (amountMatch?.[0]) {
    try {
      amountCents = parseMoneyToCents(amountMatch[0]);
    } catch {
      invalidAmount = true;
    }
  }

  return {
    plate: plateMatch?.[0] ? normalizePlate(plateMatch[0]) : undefined,
    amountCents,
    invalidAmount,
  };
}

function isCancel(text: string): boolean {
  return lowerMessage(text) === "cancelar";
}

function isExit(text: string): boolean {
  return lowerMessage(text) === "sair";
}

function isConfirm(text: string): boolean {
  return ["confirmar", "confirmo", "ok", "sim", "op_confirmar"].includes(lowerMessage(text));
}

function isStartNewRequest(text: string): boolean {
  return [
    "nova",
    "novo",
    "nova solicitacao",
    "nova solicitação",
    "iniciar",
    "op_nova_solicitacao",
  ].includes(lowerMessage(text));
}

function isFinishConversation(text: string): boolean {
  return ["finalizar", "encerrar", "op_finalizar"].includes(lowerMessage(text));
}

function isStatusIntent(text: string): boolean {
  return ["status", "acompanhar", "protocolo", "op_ver_status"].includes(lowerMessage(text));
}

function looksLikeCpfInput(text: string): boolean {
  return normalizeCpf(text).length === 11;
}

function defaultMenuOptions(): WhatsappOption[] {
  return [
    { id: "op_nova_solicitacao", title: "Nova solicitacao" },
    { id: "op_ver_status", title: "Ver status" },
    { id: "op_finalizar", title: "Finalizar" },
  ];
}

function buildSuccessMessage(input: {
  plate: string;
  previousLimit: number | null;
  newLimit: number | null;
  executedAt: Date;
  protocol: string;
}): string {
  return [
    "Alteracao realizada com sucesso.",
    `Placa: ${input.plate}`,
    `Limite anterior: ${formatCurrency(input.previousLimit)}`,
    `Novo limite: ${formatCurrency(input.newLimit)}`,
    `Data e hora: ${formatAppDateTime(input.executedAt)}`,
    `Protocolo: ${input.protocol}`,
  ].join("\n");
}

function formatCurrency(value: number | string | null | undefined): string {
  const numeric = value === null || value === undefined ? null : Number(value);
  if (numeric === null || !Number.isFinite(numeric)) return "n/d";
  return numeric.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function sendText(input: {
  provider: WhatsappProvider;
  recordWhatsappMessageFn: typeof recordWhatsappMessage;
  toPhoneE164: string;
  body: string;
  requestId?: string;
  replyToMessageId?: string;
}): Promise<void> {
  const sent = await input.provider.sendTextMessage({
    toPhoneE164: input.toPhoneE164,
    body: input.body,
    replyToMessageId: input.replyToMessageId,
  });
  await input.recordWhatsappMessageFn({
    providerMessageId: sent.providerMessageId ?? undefined,
    phoneE164: input.toPhoneE164,
    direction: "out",
    requestId: input.requestId,
    body: input.body,
  });
}

async function sendGuidedMessage(input: {
  provider: WhatsappProvider;
  recordWhatsappMessageFn: typeof recordWhatsappMessage;
  toPhoneE164: string;
  body: string;
  options?: WhatsappOption[];
  requestId?: string;
  replyToMessageId?: string;
}): Promise<void> {
  if (input.options?.length && input.provider.sendOptionsMessage) {
    const sent = await input.provider.sendOptionsMessage({
      toPhoneE164: input.toPhoneE164,
      body: input.body,
      replyToMessageId: input.replyToMessageId,
      options: input.options,
    });
    await input.recordWhatsappMessageFn({
      providerMessageId: sent.providerMessageId ?? undefined,
      phoneE164: input.toPhoneE164,
      direction: "out",
      requestId: input.requestId,
      body: `${input.body}\nOpcoes: ${input.options.map((option) => option.title).join(" | ")}`,
    });
    return;
  }

  const fallbackBody = input.options?.length
    ? `${input.body}\nOpcoes:\n${input.options.map((option, index) => `${index + 1}. ${option.title}`).join("\n")}`
    : input.body;
  await sendText({
    provider: input.provider,
    recordWhatsappMessageFn: input.recordWhatsappMessageFn,
    toPhoneE164: input.toPhoneE164,
    body: fallbackBody,
    requestId: input.requestId,
    replyToMessageId: input.replyToMessageId,
  });
}

async function notifyCoordinatorApprovalNeeded(input: {
  provider: WhatsappProvider;
  deps: WhatsappFlowDependencies;
  request: DbRequest;
  requester: DbUserContext;
  plate: string;
  requestedAmount: number;
}): Promise<void> {
  const coordinators = await input.deps.listCoordinatorsByScope(input.requester.operation_scope ?? "GERAL", input.requester.id);
  for (const coordinator of coordinators) {
    const phone = await input.deps.getPrimaryAuthorizedPhoneByUserId(coordinator.id);
    if (!phone) continue;

    const eventKey = `APPROVAL_NEEDED:${coordinator.id}`;
    const existing = await input.deps.findRequestNotification({
      requestId: input.request.id,
      eventKey,
      channel: "whatsapp",
    });
    if (existing?.status === "sent") continue;

    await sendText({
      provider: input.provider,
      recordWhatsappMessageFn: input.deps.recordWhatsappMessage,
      toPhoneE164: phone,
      requestId: input.request.id,
      body: [
        "Solicitacao pendente de aprovacao.",
        `Protocolo: ${formatRequestProtocol(input.request.id)}`,
        `Solicitante: ${input.requester.name}`,
        `Placa: ${input.plate}`,
        `Valor solicitado: ${formatCurrency(input.requestedAmount)}`,
        `Acesse o painel para aprovar ou rejeitar: ${config.appBaseUrl}`,
      ].join("\n"),
    });
    await input.deps.markRequestNotification({
      requestId: input.request.id,
      eventKey,
      channel: "whatsapp",
      recipientPhoneE164: phone,
      status: "sent",
    });
  }
}

async function resetSession(
  deps: WhatsappFlowDependencies,
  phoneE164: string,
  lastMessageId?: string,
): Promise<void> {
  await deps.upsertWhatsappSession({
    phoneE164,
    state: "AGUARDANDO_CPF",
    activeRequestId: null,
    authenticatedUserId: null,
    pendingVehiclePlate: null,
    pendingAmountCents: null,
    expiresAt: sessionExpiry(new Date()),
    lastMessageId,
  });
}

function buildNextActionBody(status: string): string {
  if (status === "CONCLUIDA") {
    return "Se quiser, podemos abrir uma nova solicitacao agora ou encerrar o atendimento.";
  }
  if (status === "LIMITE_ALTERADO") {
    return "O limite ja foi alterado e a liberacao complementar segue em tratativa. Posso consultar o status ou encerrar o atendimento.";
  }
  if (["RESULTADO_INDETERMINADO", "FALHA_MANUAL", "FALHA_REPROCESSAVEL"].includes(status)) {
    return "A solicitacao anterior nao foi concluida com seguranca. Voce pode consultar o status, iniciar uma nova solicitacao ou encerrar.";
  }
  if (["REJEITADA", "CANCELADA", "EXPIRADA"].includes(status)) {
    return "Essa solicitacao foi encerrada. Posso iniciar uma nova solicitacao ou encerrar o atendimento.";
  }
  return "Posso consultar o status atual, iniciar uma nova solicitacao ou encerrar o atendimento.";
}

function buildAuthenticatedPrompt(): string {
  return [
    "Sua sessao ja esta autenticada.",
    "Para abrir uma nova solicitacao, envie a placa e o valor. Exemplo: PWH4E85 10,00.",
    "Se preferir, escolha uma opcao abaixo.",
  ].join("\n");
}

async function resolvePendingInput(
  deps: WhatsappFlowDependencies,
  user: DbUserContext,
  current: PendingInput | null,
  text: string,
): Promise<{ pending: PendingInput | null; message?: string }> {
  const parsed = parsePlateAndAmount(text);
  const pending = current ? { ...current } : ({ plate: "", amountCents: 0, vehicleGroup: "GERAL_DE_RESTRICOES" } as PendingInput);

  if (parsed.plate) {
    if (!isValidBrazilianPlate(parsed.plate)) {
      return { pending: null, message: "Placa invalida. Envie no formato ABC1234 ou ABC1D23." };
    }

    const vehicle = await deps.getVehicleByPlate(parsed.plate);
    if (!vehicle) {
      return { pending: null, message: "Veiculo nao localizado. Envie uma nova placa." };
    }
    if (vehicle.operation_scope && vehicle.operation_scope !== user.operation_scope) {
      return { pending: null, message: "Voce nao possui permissao para solicitar alteracao desse veiculo." };
    }

    pending.plate = parsed.plate;
    pending.vehicleGroup = (vehicle.vehicle_group as VehicleGroup | null) ?? "GERAL_DE_RESTRICOES";
  }

  if (parsed.invalidAmount) {
    return { pending: null, message: "Valor invalido. Envie no formato 10,00 ou 150,50." };
  }

  if (parsed.amountCents) {
    pending.amountCents = parsed.amountCents;
  }

  if (!pending.plate) {
    return { pending: null, message: "Informe a placa do veiculo." };
  }
  if (!pending.amountCents) {
    return { pending: { ...pending }, message: "Informe o novo limite desejado no formato 10,00." };
  }

  const policy = evaluateLimitPolicy(
    centsToAmount(pending.amountCents),
    config.groupPolicies[pending.vehicleGroup],
  );
  if (!policy.allowed) {
    return {
      pending: null,
      message: "Valor acima da politica permitida para esse grupo. Envie um novo valor.",
    };
  }

  return { pending };
}

export class WhatsappFlowService {
  private readonly deps: WhatsappFlowDependencies;

  constructor(
    private readonly provider: WhatsappProvider,
    deps: Partial<WhatsappFlowDependencies> = {},
  ) {
    this.deps = { ...defaultWhatsappFlowDependencies, ...deps };
  }

  async handleInboundMessage(input: {
    providerMessageId: string;
    phoneE164: string;
    text: string;
  }): Promise<void> {
    const now = new Date();
    const normalizedText = normalizeMessageText(input.text);
    let session = await this.deps.getWhatsappSessionByPhone(input.phoneE164);

    if (!session) {
      session = await this.deps.upsertWhatsappSession({
        phoneE164: input.phoneE164,
        state: "AGUARDANDO_CPF",
        expiresAt: sessionExpiry(now),
        lastMessageId: input.providerMessageId,
      });
      if (isValidCpf(normalizeCpf(normalizedText))) {
        await this.handleCpfStep(session, input, normalizedText, now);
        return;
      }
      await sendGuidedMessage({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: [
          `Bem-vindo ao atendimento de abastecimento da ${config.companyName}.`,
          "Para comecar, envie seu CPF cadastrado.",
        ].join("\n"),
        options: defaultMenuOptions(),
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    if (session.locked_until && new Date(session.locked_until).getTime() > now.getTime()) {
      await sendText({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: `A autenticacao foi bloqueada temporariamente. Tente novamente apos ${formatAppDateTime(session.locked_until)}.`,
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    const currentRequest = session.active_request_id ? await this.deps.getRequest(session.active_request_id) : null;
    const terminalRequest =
      currentRequest &&
      ["CONCLUIDA", "REJEITADA", "CANCELADA", "EXPIRADA", "RESULTADO_INDETERMINADO", "FALHA_MANUAL", "FALHA_REPROCESSAVEL"].includes(
        currentRequest.status,
      );
    if (terminalRequest && (isStartNewRequest(normalizedText) || parsePlateAndAmount(normalizedText).plate || parsePlateAndAmount(normalizedText).amountCents)) {
      session = await this.deps.upsertWhatsappSession({
        phoneE164: input.phoneE164,
        state: "AUTENTICADO",
        authenticatedUserId: session.authenticated_user_id,
        activeRequestId: null,
        pendingVehiclePlate: null,
        pendingAmountCents: null,
        failedCpfAttempts: 0,
        failedMfaAttempts: 0,
        authenticationAttempts: 0,
        authenticatedAt: session.authenticated_at,
        expiresAt: sessionExpiry(now),
        lastMessageId: input.providerMessageId,
        metadata: {},
      });
    }

    if (new Date(session.expires_at).getTime() <= now.getTime()) {
      await this.deps.upsertWhatsappSession({
        phoneE164: input.phoneE164,
        state: "EXPIRADO",
        expiresAt: sessionExpiry(now),
        lastMessageId: input.providerMessageId,
      });
      await sendText({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: "Sua sessao expirou por inatividade. Envie seu CPF para autenticar novamente.",
        replyToMessageId: input.providerMessageId,
      });
      session = await this.deps.getWhatsappSessionByPhone(input.phoneE164);
      if (!session) return;
      await this.deps.upsertWhatsappSession({
        phoneE164: input.phoneE164,
        state: "AGUARDANDO_CPF",
        expiresAt: sessionExpiry(now),
        lastMessageId: input.providerMessageId,
      });
      return;
    }

    if (isExit(normalizedText)) {
      await resetSession(this.deps, input.phoneE164, input.providerMessageId);
      await this.deps.appendMaskedAuditEvent({
        actorUserId: session.authenticated_user_id ?? undefined,
        eventType: "WHATSAPP_SESSION_CLOSED",
        phoneE164: input.phoneE164,
        payload: { state: session.state },
      });
      await sendText({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: "Sessao encerrada. Quando quiser iniciar de novo, envie seu CPF.",
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    if (isCancel(normalizedText)) {
      if (session.active_request_id) {
        const currentRequest = await this.deps.getRequest(session.active_request_id);
        if (currentRequest && ["AGUARDANDO_APROVACAO", "AGUARDANDO_SEGUNDA_APROVACAO", "NA_FILA"].includes(currentRequest.status)) {
          await this.deps.transitionRequest(currentRequest.id, "CANCELADA", session.authenticated_user_id ?? undefined);
        }
      }
      await resetSession(this.deps, input.phoneE164, input.providerMessageId);
      await sendText({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: "Solicitacao cancelada. Envie seu CPF para iniciar uma nova solicitacao.",
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    switch (session.state as WhatsappConversationState) {
      case "INICIO":
      case "AGUARDANDO_CPF":
      case "EXPIRADO":
        await this.handleCpfStep(session, input, normalizedText, now);
        return;
      case "AGUARDANDO_MFA":
        await this.handleMfaStep(session, input, normalizedText, now);
        return;
      case "AUTENTICADO":
      case "AGUARDANDO_PLACA":
      case "AGUARDANDO_VALOR":
      case "AGUARDANDO_CONFIRMACAO":
        await this.handleRequestStep(session, input, normalizedText, now);
        return;
      case "PROCESSANDO":
      case "PENDENTE_APROVACAO":
      case "CONCLUIDO":
      case "ERRO":
      default:
        await this.handleStatusStep(session, input, normalizedText, now);
        return;
    }
  }

  private async handleCpfStep(
    session: Awaited<ReturnType<typeof getWhatsappSessionByPhone>> extends infer T ? Exclude<T, null> : never,
    input: { providerMessageId: string; phoneE164: string; text: string },
    text: string,
    now: Date,
  ): Promise<void> {
    const cpf = normalizeCpf(text);
    if (!isValidCpf(cpf)) {
      if (isStartNewRequest(text) || isStatusIntent(text) || isFinishConversation(text)) {
        await sendGuidedMessage({
          provider: this.provider,
          recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
          toPhoneE164: input.phoneE164,
          body: "Para comecar o atendimento com seguranca, envie seu CPF cadastrado.",
          options: defaultMenuOptions(),
          replyToMessageId: input.providerMessageId,
        });
        return;
      }
      const attempts = session.failed_cpf_attempts + 1;
      const lockedUntil = attempts >= config.whatsappMaxAuthAttempts
        ? new Date(now.getTime() + config.whatsappTemporaryBlockMinutes * 60_000)
        : null;
      await this.deps.upsertWhatsappSession({
        phoneE164: input.phoneE164,
        state: "AGUARDANDO_CPF",
        failedCpfAttempts: attempts,
        failedMfaAttempts: 0,
        authenticationAttempts: attempts,
        lockedUntil,
        expiresAt: sessionExpiry(now),
        lastMessageId: input.providerMessageId,
      });
      await this.deps.recordWhatsappAuthAttempt({
        sessionId: session.id,
        phoneE164: input.phoneE164,
        attemptKind: "CPF",
        success: false,
        cpf,
        errorCode: "INVALID_CPF",
        blockedUntil: lockedUntil,
      });
      await sendText({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: lockedUntil
          ? "CPF invalido. As tentativas foram bloqueadas temporariamente por seguranca."
          : "CPF invalido. Envie novamente apenas os 11 digitos.",
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    const user = await this.deps.findUserByCpf(cpf);
    if (!user) {
      await this.deps.recordWhatsappAuthAttempt({
        sessionId: session.id,
        phoneE164: input.phoneE164,
        attemptKind: "CPF",
        success: false,
        cpf,
        errorCode: "USER_NOT_FOUND",
      });
      await sendText({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: "CPF nao autorizado para este atendimento. Se precisar, fale com o administrador para liberar seu acesso.",
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    const context = await this.deps.getUserContext(user.id);
    if (!context || !resolveAccessProfile(context).canCreateWhatsappRequest) {
      await this.deps.recordWhatsappAuthAttempt({
        sessionId: session.id,
        phoneE164: input.phoneE164,
        attemptKind: "CPF",
        success: false,
        cpf,
        userId: user.id,
        errorCode: "ROLE_NOT_ALLOWED",
      });
      await sendText({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: "Seu perfil nao possui permissao para solicitar alteracoes por este canal.",
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    const hasAuthorizedPhone = await this.deps.hasAuthorizedPhoneForUser(context.id);
    if (hasAuthorizedPhone && !(await this.deps.isAuthorizedPhoneForUser(context.id, input.phoneE164))) {
      await this.deps.recordWhatsappAuthAttempt({
        sessionId: session.id,
        phoneE164: input.phoneE164,
        attemptKind: "CPF",
        success: false,
        cpf,
        userId: context.id,
        errorCode: "PHONE_NOT_AUTHORIZED",
      });
      await sendText({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: "Este numero de WhatsApp nao esta autorizado para o CPF informado.",
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    await this.deps.recordWhatsappAuthAttempt({
      sessionId: session.id,
      phoneE164: input.phoneE164,
      attemptKind: "CPF",
      success: true,
      cpf,
      userId: context.id,
    });
    await this.deps.appendMaskedAuditEvent({
      actorUserId: context.id,
      eventType: "WHATSAPP_CPF_VALIDATED",
      phoneE164: input.phoneE164,
      cpf,
      payload: {
        userId: context.id,
        role: context.roles.join(","),
      },
    });
    await this.deps.upsertWhatsappSession({
      phoneE164: input.phoneE164,
      state: "AGUARDANDO_MFA",
      authenticatedUserId: context.id,
      cpf,
      failedCpfAttempts: 0,
      failedMfaAttempts: 0,
      authenticationAttempts: 0,
      expiresAt: sessionExpiry(now),
      lastMessageId: input.providerMessageId,
      metadata: {},
    });
    await sendText({
      provider: this.provider,
      recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
      toPhoneE164: input.phoneE164,
      body: `CPF ${maskCpf(cpf)} validado. Agora envie o codigo de 6 digitos do Google Authenticator.`,
      replyToMessageId: input.providerMessageId,
    });
  }

  private async handleMfaStep(
    session: Awaited<ReturnType<typeof getWhatsappSessionByPhone>> extends infer T ? Exclude<T, null> : never,
    input: { providerMessageId: string; phoneE164: string; text: string },
    text: string,
    now: Date,
  ): Promise<void> {
    const user = session.authenticated_user_id ? await this.deps.getUserContext(session.authenticated_user_id) : null;
    if (!user || !user.mfa_secret_encrypted || !user.mfa_enabled) {
      await resetSession(this.deps, input.phoneE164, input.providerMessageId);
      await sendText({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: "Nao foi possivel validar sua autenticacao. Envie seu CPF para reiniciar.",
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    const code = text.replace(/\D/g, "");
    let valid = false;
    if (code.length === 6) {
      try {
        const secret = this.deps.decryptText(user.mfa_secret_encrypted);
        valid = this.deps.verifyTotpCode({ token: code, secret });
      } catch {
        valid = false;
      }
    }
    if (!valid) {
      const attempts = session.failed_mfa_attempts + 1;
      const lockedUntil = attempts >= config.whatsappMaxAuthAttempts
        ? new Date(now.getTime() + config.whatsappTemporaryBlockMinutes * 60_000)
        : null;
      await this.deps.upsertWhatsappSession({
        phoneE164: input.phoneE164,
        state: "AGUARDANDO_MFA",
        authenticatedUserId: user.id,
        pendingVehiclePlate: session.pending_vehicle_plate,
        pendingAmountCents: session.pending_amount_cents,
        failedCpfAttempts: session.failed_cpf_attempts,
        failedMfaAttempts: attempts,
        authenticationAttempts: attempts,
        lockedUntil,
        expiresAt: sessionExpiry(now),
        lastMessageId: input.providerMessageId,
        metadata: session.metadata,
      });
      await this.deps.recordWhatsappAuthAttempt({
        sessionId: session.id,
        phoneE164: input.phoneE164,
        attemptKind: "MFA",
        success: false,
        userId: user.id,
        errorCode: "INVALID_MFA",
        blockedUntil: lockedUntil,
      });
      await sendText({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: lockedUntil
          ? "Codigo MFA invalido. A autenticacao foi bloqueada temporariamente por seguranca."
          : "Codigo MFA invalido. Envie novamente o codigo de 6 digitos do Google Authenticator.",
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    await this.deps.recordWhatsappAuthAttempt({
      sessionId: session.id,
      phoneE164: input.phoneE164,
      attemptKind: "MFA",
      success: true,
      userId: user.id,
    });
    await this.deps.appendMaskedAuditEvent({
      actorUserId: user.id,
      eventType: "WHATSAPP_AUTHENTICATED",
      phoneE164: input.phoneE164,
      payload: {
        userId: user.id,
        role: user.roles.join(","),
      },
    });
    await this.deps.upsertWhatsappSession({
      phoneE164: input.phoneE164,
      state: "AUTENTICADO",
      authenticatedUserId: user.id,
      pendingVehiclePlate: null,
      pendingAmountCents: null,
      failedCpfAttempts: 0,
      failedMfaAttempts: 0,
      authenticationAttempts: 0,
      lockedUntil: null,
      authenticatedAt: now,
      expiresAt: sessionExpiry(now),
      lastMessageId: input.providerMessageId,
      metadata: {},
    });
    await sendText({
      provider: this.provider,
      recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
      toPhoneE164: input.phoneE164,
      body: "Autenticacao confirmada. Envie a placa e o valor do novo limite. Exemplo: PWH4E85 10,00",
      replyToMessageId: input.providerMessageId,
    });
  }

  private async handleRequestStep(
    session: Awaited<ReturnType<typeof getWhatsappSessionByPhone>> extends infer T ? Exclude<T, null> : never,
    input: { providerMessageId: string; phoneE164: string; text: string },
    text: string,
    now: Date,
  ): Promise<void> {
    const user = session.authenticated_user_id ? await this.deps.getUserContext(session.authenticated_user_id) : null;
    if (!user) {
      await resetSession(this.deps, input.phoneE164, input.providerMessageId);
      await sendText({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: "Sua sessao precisa ser autenticada novamente. Envie seu CPF.",
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    if (isFinishConversation(text)) {
      await resetSession(this.deps, input.phoneE164, input.providerMessageId);
      await sendText({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: "Atendimento finalizado. Quando quiser iniciar novamente, envie seu CPF.",
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    const pendingFromSession =
      session.pending_vehicle_plate && session.pending_amount_cents
        ? ({
            plate: session.pending_vehicle_plate,
            amountCents: Number(session.pending_amount_cents),
            vehicleGroup: ((session.metadata?.vehicleGroup as VehicleGroup | undefined) ?? "GERAL_DE_RESTRICOES"),
          } as PendingInput)
        : session.pending_vehicle_plate
          ? ({
              plate: session.pending_vehicle_plate,
              amountCents: 0,
              vehicleGroup: ((session.metadata?.vehicleGroup as VehicleGroup | undefined) ?? "GERAL_DE_RESTRICOES"),
            } as PendingInput)
          : null;

    const parsed = parsePlateAndAmount(text);
    const hasPendingPlate = Boolean(pendingFromSession?.plate);
    const hasActionableRequestInput =
      isStartNewRequest(text) ||
      Boolean(parsed.plate) ||
      (hasPendingPlate && (parsed.invalidAmount || parsed.amountCents !== undefined));

    if (isStartNewRequest(text)) {
      await this.deps.upsertWhatsappSession({
        phoneE164: input.phoneE164,
        state: "AGUARDANDO_PLACA",
        authenticatedUserId: user.id,
        activeRequestId: null,
        pendingVehiclePlate: null,
        pendingAmountCents: null,
        failedCpfAttempts: 0,
        failedMfaAttempts: 0,
        authenticationAttempts: 0,
        authenticatedAt: session.authenticated_at ?? now,
        expiresAt: sessionExpiry(now),
        lastMessageId: input.providerMessageId,
        metadata: {},
      });
      await sendText({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: "Nova solicitacao iniciada. Informe a placa do veiculo.",
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    if ((session.state as WhatsappConversationState) === "AGUARDANDO_CONFIRMACAO" && !isConfirm(text)) {
      await sendGuidedMessage({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: "Revise os dados acima. Se estiver tudo certo, confirme a solicitacao ou cancele.",
        options: [
          { id: "op_confirmar", title: "Confirmar" },
          { id: "cancelar", title: "Cancelar" },
        ],
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    if (isStatusIntent(text)) {
      const guidance =
        (session.state as WhatsappConversationState) === "AGUARDANDO_CONFIRMACAO"
          ? "Voce tem uma solicitacao pronta para confirmar. Confirme ou cancele para continuar."
          : pendingFromSession?.plate
            ? `Estamos montando sua solicitacao para a placa ${pendingFromSession.plate}. Envie o valor ou cancele para recomecar.`
            : "Estamos montando uma nova solicitacao. Envie a placa do veiculo ou cancele para encerrar.";
      await sendGuidedMessage({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: guidance,
        options:
          (session.state as WhatsappConversationState) === "AGUARDANDO_CONFIRMACAO"
            ? [
                { id: "op_confirmar", title: "Confirmar" },
                { id: "cancelar", title: "Cancelar" },
              ]
            : [{ id: "cancelar", title: "Cancelar" }],
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    if (
      (session.state as WhatsappConversationState) === "AUTENTICADO" &&
      !pendingFromSession &&
      !hasActionableRequestInput
    ) {
      const body = looksLikeCpfInput(text)
        ? buildAuthenticatedPrompt()
        : "Nao consegui identificar uma nova solicitacao. Envie a placa e o valor juntos, por exemplo: PWH4E85 10,00.";
      await sendGuidedMessage({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body,
        options: defaultMenuOptions(),
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    if ((session.state as WhatsappConversationState) === "AGUARDANDO_PLACA" && !parsed.plate) {
      await sendText({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: "Informe a placa do veiculo no formato ABC1234 ou ABC1D23.",
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    if ((session.state as WhatsappConversationState) === "AGUARDANDO_CONFIRMACAO" && isConfirm(text)) {
      if (!pendingFromSession) {
        await resetSession(this.deps, input.phoneE164, input.providerMessageId);
        await sendText({
          provider: this.provider,
          recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
          toPhoneE164: input.phoneE164,
          body: "Nao encontrei os dados pendentes da solicitacao. Envie a placa e o valor novamente.",
          replyToMessageId: input.providerMessageId,
        });
        return;
      }

      const activeRequest = await this.deps.getActiveRequestByPlate(pendingFromSession.plate);
      if (activeRequest) {
        await sendText({
          provider: this.provider,
          recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
          toPhoneE164: input.phoneE164,
          body: `Ja existe uma operacao em andamento para a placa ${pendingFromSession.plate}. Protocolo atual: ${activeRequest.id}.`,
          replyToMessageId: input.providerMessageId,
        });
        return;
      }

      const amount = centsToAmount(pendingFromSession.amountCents);
      const policy = evaluateLimitPolicy(amount, config.groupPolicies[pendingFromSession.vehicleGroup]);
      const request = await this.deps.createRequest({
        idempotencyKey: buildRequestIdempotencyKey({
          requesterId: user.id,
          vehiclePlate: pendingFromSession.plate,
          vehicleGroup: pendingFromSession.vehicleGroup,
          requestedAmount: amount,
          bucket: `whatsapp-confirmation:${input.providerMessageId}`,
        }),
        vehiclePlate: pendingFromSession.plate,
        vehicleGroup: pendingFromSession.vehicleGroup,
        requestedAmount: amount,
        requesterId: user.id,
        channel: "whatsapp",
        status: policy.requiresSecondApproval ? "AGUARDANDO_SEGUNDA_APROVACAO" : "NA_FILA",
        expiresAt: new Date(now.getTime() + config.approvalTtlMinutes * 60_000),
      });

      await this.deps.appendMaskedAuditEvent({
        requestId: request.id,
        actorUserId: user.id,
        phoneE164: input.phoneE164,
        eventType: "WHATSAPP_REQUEST_CREATED",
        payload: {
          userId: user.id,
          name: user.name,
          profile: user.roles.join(","),
          plate: pendingFromSession.plate,
          requestedAmount: amount,
          origin: "WHATSAPP",
        },
      });

      if (policy.requiresSecondApproval) {
        await notifyCoordinatorApprovalNeeded({
          provider: this.provider,
          deps: this.deps,
          request,
          requester: user,
          plate: pendingFromSession.plate,
          requestedAmount: amount,
        });
        await this.deps.upsertWhatsappSession({
          phoneE164: input.phoneE164,
          state: "PENDENTE_APROVACAO",
          authenticatedUserId: user.id,
          activeRequestId: request.id,
          pendingVehiclePlate: null,
          pendingAmountCents: null,
          failedCpfAttempts: 0,
          failedMfaAttempts: 0,
          authenticationAttempts: 0,
          authenticatedAt: session.authenticated_at ?? now,
          expiresAt: sessionExpiry(now),
          lastMessageId: input.providerMessageId,
          metadata: {},
        });
        await sendText({
          provider: this.provider,
          recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
          toPhoneE164: input.phoneE164,
          requestId: request.id,
        body: [
          "Solicitacao registrada e aguardando aprovacao do coordenador.",
          `Placa: ${pendingFromSession.plate}`,
          `Valor solicitado: ${formatCurrency(amount)}`,
          `Protocolo: ${formatRequestProtocol(request.id)}`,
          "Vou avisar por aqui assim que houver aprovacao ou rejeicao.",
        ].join("\n"),
          replyToMessageId: input.providerMessageId,
        });
        return;
      }

      await this.deps.enqueueLimitRequest(request.id);
      await this.deps.upsertWhatsappSession({
        phoneE164: input.phoneE164,
        state: "PROCESSANDO",
        authenticatedUserId: user.id,
        activeRequestId: request.id,
        pendingVehiclePlate: null,
        pendingAmountCents: null,
        failedCpfAttempts: 0,
        failedMfaAttempts: 0,
        authenticationAttempts: 0,
        authenticatedAt: session.authenticated_at ?? now,
        expiresAt: sessionExpiry(now),
        lastMessageId: input.providerMessageId,
        metadata: {},
      });
      await sendText({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        requestId: request.id,
        body: [
          "Solicitacao recebida e em processamento.",
          `Placa: ${pendingFromSession.plate}`,
          `Valor solicitado: ${formatCurrency(amount)}`,
          `Protocolo: ${formatRequestProtocol(request.id)}`,
          "Assim que a Ticket Log responder, eu aviso por aqui.",
        ].join("\n"),
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    const resolved = await resolvePendingInput(this.deps, user, pendingFromSession, text);
    if (resolved.message) {
      const nextPending = resolved.pending ?? pendingFromSession;
      await this.deps.upsertWhatsappSession({
        phoneE164: input.phoneE164,
        state: nextPending?.plate ? "AGUARDANDO_VALOR" : "AGUARDANDO_PLACA",
        authenticatedUserId: user.id,
        pendingVehiclePlate: nextPending?.plate ?? null,
        pendingAmountCents: nextPending?.amountCents || null,
        failedCpfAttempts: 0,
        failedMfaAttempts: 0,
        authenticationAttempts: 0,
        authenticatedAt: session.authenticated_at ?? now,
        expiresAt: sessionExpiry(now),
        lastMessageId: input.providerMessageId,
        metadata: nextPending ? { vehicleGroup: nextPending.vehicleGroup } : session.metadata,
      });
      await sendText({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: resolved.message,
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    if (!resolved.pending) {
      await sendText({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: "Nao consegui entender os dados. Envie a placa e o valor no formato PWH4E85 10,00.",
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    await this.deps.upsertWhatsappSession({
      phoneE164: input.phoneE164,
      state: "AGUARDANDO_CONFIRMACAO",
      authenticatedUserId: user.id,
      pendingVehiclePlate: resolved.pending.plate,
      pendingAmountCents: resolved.pending.amountCents,
      failedCpfAttempts: 0,
      failedMfaAttempts: 0,
      authenticationAttempts: 0,
      authenticatedAt: session.authenticated_at ?? now,
      expiresAt: sessionExpiry(now),
      lastMessageId: input.providerMessageId,
      metadata: { vehicleGroup: resolved.pending.vehicleGroup },
    });
    await sendGuidedMessage({
      provider: this.provider,
      recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
      toPhoneE164: input.phoneE164,
      body: [
        "Confirme os dados da solicitacao:",
        `Placa: ${resolved.pending.plate}`,
        `Novo limite solicitado: ${formatCurrency(centsToAmount(resolved.pending.amountCents))}`,
        `Grupo: ${resolved.pending.vehicleGroup}`,
      ].join("\n"),
      options: [
        { id: "op_confirmar", title: "Confirmar" },
        { id: "cancelar", title: "Cancelar" },
      ],
      replyToMessageId: input.providerMessageId,
    });
  }

  private async handleStatusStep(
    session: Awaited<ReturnType<typeof getWhatsappSessionByPhone>> extends infer T ? Exclude<T, null> : never,
    input: { providerMessageId: string; phoneE164: string; text: string },
    text: string,
    now: Date,
  ): Promise<void> {
    let request = session.active_request_id ? await this.deps.getRequest(session.active_request_id) : null;
    const parsed = parsePlateAndAmount(text);
    if (
      !session.active_request_id &&
      (isStartNewRequest(text) || Boolean(parsed.plate) || Boolean(parsed.amountCents))
    ) {
      const reset = await this.deps.upsertWhatsappSession({
        phoneE164: input.phoneE164,
        state: "AUTENTICADO",
        authenticatedUserId: session.authenticated_user_id,
        activeRequestId: null,
        pendingVehiclePlate: null,
        pendingAmountCents: null,
        failedCpfAttempts: 0,
        failedMfaAttempts: 0,
        authenticationAttempts: 0,
        authenticatedAt: session.authenticated_at,
        expiresAt: sessionExpiry(now),
        lastMessageId: input.providerMessageId,
        metadata: {},
      });
      await this.handleRequestStep(reset, input, text, now);
      return;
    }

    if (!request && session.authenticated_user_id) {
      const latestRequest = await this.deps.getLatestWhatsappRequestByRequester(session.authenticated_user_id);
      if (latestRequest) {
        request = latestRequest;
        const sessionState: WhatsappConversationState =
          latestRequest.status === "CONCLUIDA"
            ? "CONCLUIDO"
            : ["REJEITADA", "CANCELADA", "EXPIRADA", "RESULTADO_INDETERMINADO", "FALHA_MANUAL", "FALHA_REPROCESSAVEL"].includes(
                  latestRequest.status,
                )
              ? "ERRO"
              : latestRequest.status === "AGUARDANDO_APROVACAO" || latestRequest.status === "AGUARDANDO_SEGUNDA_APROVACAO"
                ? "PENDENTE_APROVACAO"
                : "PROCESSANDO";
        await this.deps.upsertWhatsappSession({
          phoneE164: input.phoneE164,
          state: sessionState,
          authenticatedUserId: session.authenticated_user_id,
          activeRequestId: latestRequest.id,
          pendingVehiclePlate: null,
          pendingAmountCents: null,
          failedCpfAttempts: 0,
          failedMfaAttempts: 0,
          authenticationAttempts: 0,
          authenticatedAt: session.authenticated_at,
          expiresAt: sessionExpiry(now),
          lastMessageId: input.providerMessageId,
          metadata: session.metadata,
        });
      }
    }
    if (!request) {
      if (isFinishConversation(text)) {
        await resetSession(this.deps, input.phoneE164, input.providerMessageId);
        await sendText({
          provider: this.provider,
          recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
          toPhoneE164: input.phoneE164,
          body: "Atendimento finalizado. Quando quiser de novo, basta enviar qualquer mensagem e depois seu CPF.",
          replyToMessageId: input.providerMessageId,
        });
        return;
      }
      if (isStartNewRequest(text)) {
        await this.deps.upsertWhatsappSession({
          phoneE164: input.phoneE164,
          state: "AGUARDANDO_PLACA",
          authenticatedUserId: session.authenticated_user_id,
          activeRequestId: null,
          pendingVehiclePlate: null,
          pendingAmountCents: null,
          failedCpfAttempts: 0,
          failedMfaAttempts: 0,
          authenticationAttempts: 0,
          authenticatedAt: session.authenticated_at,
          expiresAt: sessionExpiry(now),
          lastMessageId: input.providerMessageId,
          metadata: {},
        });
        await sendText({
          provider: this.provider,
          recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
          toPhoneE164: input.phoneE164,
          body: "Informe a placa do veiculo.",
          replyToMessageId: input.providerMessageId,
        });
        return;
      }

      await this.deps.upsertWhatsappSession({
        phoneE164: input.phoneE164,
        state: "AUTENTICADO",
        authenticatedUserId: session.authenticated_user_id,
        activeRequestId: null,
        pendingVehiclePlate: null,
        pendingAmountCents: null,
        failedCpfAttempts: 0,
        failedMfaAttempts: 0,
        authenticationAttempts: 0,
        authenticatedAt: session.authenticated_at,
        expiresAt: sessionExpiry(now),
        lastMessageId: input.providerMessageId,
        metadata: {},
      });

      if (parsePlateAndAmount(text).plate || parsePlateAndAmount(text).amountCents) {
        await this.handleRequestStep(
          {
            ...session,
            state: "AUTENTICADO",
            active_request_id: null,
            pending_vehicle_plate: null,
            pending_amount_cents: null,
          },
          input,
          text,
          now,
        );
        return;
      }
      await sendGuidedMessage({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: "Nao ha solicitacao ativa no momento. Posso abrir uma nova solicitacao para voce agora.",
        options: defaultMenuOptions(),
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    const isResolvedStatus = ["CONCLUIDA", "REJEITADA", "CANCELADA", "EXPIRADA"].includes(request.status);
    const isFailedStatus = ["RESULTADO_INDETERMINADO", "FALHA_MANUAL", "FALHA_REPROCESSAVEL"].includes(request.status);

    if (isFinishConversation(text)) {
      await resetSession(this.deps, input.phoneE164, input.providerMessageId);
      await sendText({
        provider: this.provider,
        recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
        toPhoneE164: input.phoneE164,
        body: "Atendimento finalizado. Quando quiser iniciar novamente, envie qualquer mensagem e depois seu CPF.",
        replyToMessageId: input.providerMessageId,
      });
      return;
    }

    if ((isResolvedStatus || isFailedStatus) && (isStartNewRequest(text) || parsePlateAndAmount(text).plate || parsePlateAndAmount(text).amountCents)) {
      const reset = await this.deps.upsertWhatsappSession({
        phoneE164: input.phoneE164,
        state: "AUTENTICADO",
        authenticatedUserId: session.authenticated_user_id,
        activeRequestId: null,
        pendingVehiclePlate: null,
        pendingAmountCents: null,
        failedCpfAttempts: 0,
        failedMfaAttempts: 0,
        authenticationAttempts: 0,
        authenticatedAt: session.authenticated_at,
        expiresAt: sessionExpiry(now),
        lastMessageId: input.providerMessageId,
        metadata: {},
      });
      await this.handleRequestStep(reset, input, text, now);
      return;
    }

    const statusBody = [
      `Protocolo: ${formatRequestProtocol(request.id)}`,
      `Status atual: ${request.status}`,
      `Placa: ${request.vehicle_plate}`,
      `Valor solicitado: ${formatCurrency(request.requested_amount)}`,
      buildNextActionBody(request.status),
    ].join("\n");

    await sendGuidedMessage({
      provider: this.provider,
      recordWhatsappMessageFn: this.deps.recordWhatsappMessage,
      toPhoneE164: input.phoneE164,
      requestId: request.id,
      body: statusBody,
      options: defaultMenuOptions(),
      replyToMessageId: input.providerMessageId,
    });
  }
}

export async function notifyWhatsappRequestResolved(input: {
  provider: WhatsappProvider;
  requestId: string;
}): Promise<void> {
  const context = await getRequestNotificationContext(input.requestId);
  if (!context || context.request.channel !== "whatsapp" || !context.requesterPhoneE164) return;

  const status = context.request.status;
  const eventKey = status === "CONCLUIDA" ? "REQUEST_COMPLETED" : `REQUEST_STATUS:${status}`;
  const existing = await findRequestNotification({
    requestId: context.request.id,
    eventKey,
    channel: "whatsapp",
  });
  if (existing?.status === "sent") return;

  const message =
    status === "CONCLUIDA"
      ? buildSuccessMessage({
          plate: context.request.vehicle_plate,
          previousLimit: context.request.previous_limit === null ? null : Number(context.request.previous_limit),
          newLimit: context.request.new_limit === null ? null : Number(context.request.new_limit),
          executedAt: new Date(),
          protocol: formatRequestProtocol(context.request.id),
        })
      : context.steps.some((step) => step.step_key === "CHANGE_LIMIT" && step.status === "DONE") &&
          context.steps.some((step) => step.step_key === "EVA_RELEASE" && step.status === "FAILED")
        ? [
            "O limite foi alterado com sucesso, mas a liberacao complementar ainda nao foi concluida.",
            `Placa: ${context.request.vehicle_plate}`,
            `Limite anterior: ${formatCurrency(context.request.previous_limit)}`,
            `Novo limite: ${formatCurrency(context.request.new_limit)}`,
            "Nossa equipe vai continuar a tratativa operacional.",
            `Protocolo: ${formatRequestProtocol(context.request.id)}`,
          ].join("\n")
        : [
            "Nao foi possivel concluir a alteracao neste momento.",
            "Entre em contato novamente daqui a 30 minutos.",
            `Protocolo: ${formatRequestProtocol(context.request.id)}`,
            `Placa: ${context.request.vehicle_plate}`,
          ].join("\n");

  await sendGuidedMessage({
    provider: input.provider,
    recordWhatsappMessageFn: recordWhatsappMessage,
    toPhoneE164: context.requesterPhoneE164,
    requestId: context.request.id,
    body: `${message}\n${buildNextActionBody(status)}`,
    options: defaultMenuOptions(),
  });
  await markRequestNotification({
    requestId: context.request.id,
    eventKey,
    channel: "whatsapp",
    recipientPhoneE164: context.requesterPhoneE164,
    status: "sent",
  });
  await upsertWhatsappSession({
    phoneE164: context.requesterPhoneE164,
    state: status === "CONCLUIDA" ? "CONCLUIDO" : "ERRO",
    authenticatedUserId: context.request.requester_id,
    activeRequestId: context.request.id,
    pendingVehiclePlate: null,
    pendingAmountCents: null,
    failedCpfAttempts: 0,
    failedMfaAttempts: 0,
    authenticationAttempts: 0,
    authenticatedAt: new Date(),
    expiresAt: sessionExpiry(new Date()),
    metadata: {},
  });
}

export async function rejectPendingRequestByCoordinator(input: {
  requestId: string;
  approverId: string;
  justification: string;
  provider: WhatsappProvider;
}): Promise<DbRequest> {
  const request = await rejectRequest({
    requestId: input.requestId,
    approverId: input.approverId,
    justification: input.justification,
  });
  await notifyWhatsappRequestResolved({
    provider: input.provider,
    requestId: request.id,
  });
  return request;
}
