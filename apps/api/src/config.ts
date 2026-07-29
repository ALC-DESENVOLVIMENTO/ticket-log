import "dotenv/config";
import { buildGroupPoliciesFromEnv } from "@ticketlog/domain";

export const config = {
  companyName: process.env.COMPANY_NAME ?? "ALC & Pereira Filho Transportes",
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 3333),
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
  whatsappProvider: process.env.WHATSAPP_PROVIDER ?? "meta-cloud",
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET,
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
  whatsappApiBaseUrl: process.env.WHATSAPP_API_BASE_URL,
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  approvalTtlMinutes: Number(process.env.APPROVAL_TOKEN_TTL_MINUTES ?? 30),
  whatsappSessionExpiryMinutes: Number(process.env.WHATSAPP_SESSION_EXPIRY_MINUTES ?? process.env.TEMPO_EXPIRACAO_SESSAO ?? 15),
  whatsappMaxAuthAttempts: Number(process.env.WHATSAPP_MAX_AUTH_ATTEMPTS ?? process.env.LIMITE_TENTATIVAS_AUTENTICACAO ?? 5),
  whatsappTemporaryBlockMinutes: Number(process.env.WHATSAPP_TEMP_BLOCK_MINUTES ?? 30),
  groupPolicies: buildGroupPoliciesFromEnv(process.env),
};
