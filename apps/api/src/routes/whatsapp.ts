import type { FastifyInstance } from "fastify";
import {
  createWhatsappProvider,
  extractMetaMessages,
  verifyMetaWebhookSignature,
} from "@ticketlog/whatsapp";
import { recordWhatsappMessage } from "@ticketlog/db";
import { config } from "../config.js";
import { WhatsappFlowService } from "../services/whatsappFlow.js";

const provider = createWhatsappProvider({
  apiBaseUrl: config.whatsappApiBaseUrl,
  phoneNumberId: config.whatsappPhoneNumberId,
  accessToken: config.whatsappAccessToken,
});

const flow = new WhatsappFlowService(provider);

export async function whatsappRoutes(app: FastifyInstance): Promise<void> {
  app.get("/webhooks/whatsapp", async (request, reply) => {
    const query = request.query as Record<string, string>;
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
      if (!valid) {
        return reply.code(401).send({ error: "INVALID_SIGNATURE" });
      }
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
      if (!isNew) {
        continue;
      }

      await flow.handleInboundMessage(message);
    }

    return { ok: true };
  });
}
