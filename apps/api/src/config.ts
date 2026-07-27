import "dotenv/config";
import { buildGroupPoliciesFromEnv } from "@ticketlog/domain";

export const config = {
  companyName: process.env.COMPANY_NAME ?? "ALC & Pereira Filho Transportes",
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 3333),
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET,
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
  approvalTtlMinutes: Number(process.env.APPROVAL_TOKEN_TTL_MINUTES ?? 30),
  groupPolicies: buildGroupPoliciesFromEnv(process.env),
};
