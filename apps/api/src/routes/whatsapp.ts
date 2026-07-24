import type { FastifyInstance } from "fastify";
import {
  buildRequestIdempotencyKey,
  evaluateLimitPolicy,
  isValidBrazilianPlate,
  normalizePlate,
  parseMoney,
  type VehicleGroup,
} from "@ticketlog/domain";
import {
  createApprovalToken,
  createRequest,
  findUserByPhone,
  recordWhatsappMessage,
} from "@ticketlog/db";
import { extractMetaMessages, verifyMetaWebhookSignature } from "@ticketlog/whatsapp";
import { config } from "../config.js";

function extractPlateAndAmount(text: string): { plate?: string; amount?: number } {
  const plate = text.match(/[A-Za-z]{3}[-\s]?[0-9][A-Za-z0-9][0-9]{2}/)?.[0];
  const money = text.match(/(?:R\$\s*)?\d{1,6}(?:[.,]\d{2})?/)?.[0];
  return {
    plate: plate ? normalizePlate(plate) : undefined,
    amount: money ? parseMoney(money) : undefined,
  };
}

export async function whatsappRoutes(app: FastifyInstance): Promise<void> {
  app.get("/webhooks/whatsapp", async (request, reply) => {
    const query = request.query as any;
    if (query["hub.verify_token"] !== config.whatsappVerifyToken) {
      return reply.code(403).send("invalid verify token");
    }
    return reply.send(query["hub.challenge"]);
  });

  app.post("/webhooks/whatsapp", async (request, reply) => {
    const rawBody = (request as any).rawBody as Buffer;
    const signature = request.headers["x-hub-signature-256"];

    if (config.whatsappAppSecret) {
      const valid = verifyMetaWebhookSignature({
        rawBody,
        signatureHeader: Array.isArray(signature) ? signature[0] : signature,
        appSecret: config.whatsappAppSecret,
      });
      if (!valid) return reply.code(401).send({ error: "INVALID_SIGNATURE" });
    }

    const messages = extractMetaMessages(request.body);

    for (const message of messages) {
      const isNew = await recordWhatsappMessage({
        providerMessageId: message.providerMessageId,
        phoneE164: message.phoneE164,
        direction: "in",
        body: message.text,
        payload: request.body,
      });
      if (!isNew) continue;

      const user = await findUserByPhone(message.phoneE164);
      if (!user) {
        await recordWhatsappMessage({
          phoneE164: message.phoneE164,
          direction: "out",
          body: "MSG_USUARIO_NAO_AUTORIZADO",
        });
        continue;
      }

      const parsed = extractPlateAndAmount(message.text);
      if (!parsed.plate || !isValidBrazilianPlate(parsed.plate) || !parsed.amount) {
        await recordWhatsappMessage({
          phoneE164: message.phoneE164,
          direction: "out",
          body: "MSG_SOLICITAR_PLACA_E_VALOR",
        });
        continue;
      }

      const vehicleGroup: VehicleGroup = "GERAL_DE_RESTRICOES";
      const policy = evaluateLimitPolicy(parsed.amount, config.groupPolicies[vehicleGroup]);
      if (!policy.allowed) {
        await recordWhatsappMessage({
          phoneE164: message.phoneE164,
          direction: "out",
          body: "MSG_VALOR_ACIMA_DA_POLITICA",
        });
        continue;
      }

      const expiresAt = new Date(Date.now() + config.approvalTtlMinutes * 60_000);
      const created = await createRequest({
        idempotencyKey: buildRequestIdempotencyKey({
          requesterId: user.id,
          vehiclePlate: parsed.plate,
          vehicleGroup,
          requestedAmount: parsed.amount,
          bucket: new Date().toISOString().slice(0, 13),
        }),
        vehiclePlate: parsed.plate,
        vehicleGroup,
        requestedAmount: parsed.amount,
        requesterId: user.id,
        channel: "whatsapp",
        status: "AGUARDANDO_AUTENTICACAO",
        expiresAt,
      });
      const token = await createApprovalToken(created.id, user.id, expiresAt);
      const approvalUrl = `${config.appBaseUrl}/approval/${token}`;

      await recordWhatsappMessage({
        phoneE164: message.phoneE164,
        direction: "out",
        requestId: created.id,
        body: `MSG_LINK_APROVACAO:${approvalUrl}`,
      });
    }

    return { ok: true };
  });
}
