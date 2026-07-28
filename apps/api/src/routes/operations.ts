import { access } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { getAuthenticatedUser } from "../auth.js";

async function pathExists(pathValue?: string): Promise<boolean> {
  if (!pathValue) return false;
  try {
    await access(pathValue);
    return true;
  } catch {
    return false;
  }
}

export async function operationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/operations/ticketlog/session", async (request) => {
    await getAuthenticatedUser(request);

    const providerMode = process.env.TICKETLOG_PROVIDER_MODE ?? "simulation";
    const sessionStoragePath = process.env.TICKETLOG_SESSION_STORAGE_PATH;
    const userDataDir = process.env.TICKETLOG_USER_DATA_DIR;
    const allowManualLogin = process.env.TICKETLOG_ALLOW_MANUAL_LOGIN === "true";

    return {
      providerMode,
      realExecutionEnabled: process.env.TICKETLOG_REAL_EXECUTION === "true",
      allowManualLogin,
      manualLoginMode: allowManualLogin ? "semiassistido" : "automatico",
      headless: process.env.TICKETLOG_HEADLESS !== "false",
      sessionStorageConfigured: Boolean(sessionStoragePath),
      sessionStoragePresent: await pathExists(sessionStoragePath),
      userDataDirConfigured: Boolean(userDataDir),
      userDataDirPresent: await pathExists(userDataDir),
      canEmbedTicketLog: false,
      embedBlockedReason: "A Ticket Log pode bloquear iframe/embedded view por politicas de seguranca do proprio dominio.",
      operatorGuidance:
        "Quando a Edenred exigir captcha, SMS, OTP ou trusted device, um operador autorizado conclui a etapa manualmente e a automacao retoma o fluxo.",
    };
  });
}
