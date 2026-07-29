import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { verifyMetaWebhookSignature } from "@ticketlog/whatsapp";
import { WhatsappFlowService, type WhatsappFlowDependencies } from "./whatsappFlow.js";

test("verifyMetaWebhookSignature accepts valid signature", () => {
  const payload = Buffer.from(JSON.stringify({ ok: true }));
  const secret = "app-secret";
  const signature = createHmac("sha256", secret).update(payload).digest("hex");

  const valid = verifyMetaWebhookSignature({
    rawBody: payload,
    signatureHeader: `sha256=${signature}`,
    appSecret: secret,
  });

  assert.equal(valid, true);
});

test("expired session forces CPF reauthentication", async () => {
  const sentMessages: string[] = [];
  const provider = {
    async sendTextMessage(message: { body: string }) {
      sentMessages.push(message.body);
      return { providerMessageId: "out-1" };
    },
  };

  const deps: WhatsappFlowDependencies = {
    appendMaskedAuditEvent: async () => undefined,
    createRequest: async () => ({}) as any,
    findRequestNotification: async () => null,
    getActiveRequestByPlate: async () => null,
    getPrimaryAuthorizedPhoneByUserId: async () => null,
    getRequest: async () => null,
    getRequestNotificationContext: async () => null,
    getLatestWhatsappRequestByRequester: async () => null,
    getUserContext: async () => null,
    getVehicleByPlate: async () => null,
    getWhatsappSessionByPhone: async () =>
      ({
        id: "session-expired",
        phone_e164: "+5511999999999",
        state: "AUTENTICADO",
        authenticated_user_id: "user-1",
        active_request_id: null,
        pending_vehicle_plate: null,
        pending_amount_cents: null,
        cpf_hash: null,
        cpf_last4: "8909",
        failed_cpf_attempts: 0,
        failed_mfa_attempts: 0,
        authentication_attempts: 0,
        locked_until: null,
        authenticated_at: new Date(Date.now() - 60_000),
        expires_at: new Date(Date.now() - 1_000),
        last_message_id: null,
        last_interaction_at: new Date(Date.now() - 60_000),
        metadata: {},
        created_at: new Date(Date.now() - 60_000),
        updated_at: new Date(Date.now() - 60_000),
      }) as any,
    hasAuthorizedPhoneForUser: async () => false,
    isAuthorizedPhoneForUser: async () => true,
    listCoordinatorsByScope: async () => [],
    markRequestNotification: async () => ({}) as any,
    recordWhatsappAuthAttempt: async () => undefined,
    recordWhatsappMessage: async () => true,
    transitionRequest: async () => ({}) as any,
    upsertWhatsappSession: async () => ({}) as any,
    findUserByCpf: async () => null,
    rejectRequest: async () => ({}) as any,
    enqueueLimitRequest: async () => undefined,
    decryptText: () => "",
    verifyTotpCode: () => false,
  };

  const service = new WhatsappFlowService(provider as any, deps);
  await service.handleInboundMessage({
    providerMessageId: "msg-expired",
    phoneE164: "+5511999999999",
    text: "oi",
  });

  assert.match(sentMessages[0], /sessao expirou/i);
});
