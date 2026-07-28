import "dotenv/config";
import { processLimitRequest } from "../apps/worker-playwright/dist/processLimitRequest.js";

const requestId = process.argv[2] ?? process.env.REQUEST_ID ?? "";

if (!requestId) {
  console.error("REQUEST_ID is required");
  process.exit(1);
}

process.env.TICKETLOG_PROVIDER_MODE = process.env.TICKETLOG_PROVIDER_MODE ?? "browser";
process.env.TICKETLOG_REAL_EXECUTION = process.env.TICKETLOG_REAL_EXECUTION ?? "true";
process.env.TICKETLOG_HEADLESS = process.env.TICKETLOG_HEADLESS ?? "false";
process.env.TICKETLOG_ALLOW_MANUAL_LOGIN = process.env.TICKETLOG_ALLOW_MANUAL_LOGIN ?? "true";
process.env.TICKETLOG_MANUAL_LOGIN_TIMEOUT_MS = process.env.TICKETLOG_MANUAL_LOGIN_TIMEOUT_MS ?? "900000";
process.env.TICKETLOG_LOGIN_URL = process.env.TICKETLOG_LOGIN_URL ?? "https://plataforma.ticketlog.com.br/home";
process.env.TICKETLOG_HOME_URL = process.env.TICKETLOG_HOME_URL ?? "https://plataforma.ticketlog.com.br/home";
process.env.TICKETLOG_VEHICLE_LIST_URL =
  process.env.TICKETLOG_VEHICLE_LIST_URL ?? "https://plataforma.ticketlog.com.br/register/fleet/vehicle/list";

try {
  await processLimitRequest(requestId, { allowManualStart: true });
  console.log(JSON.stringify({ ok: true, requestId }, null, 2));
  process.exit(0);
} catch (error) {
  console.error("ERR_NAME", error?.name);
  console.error("ERR_CODE", error?.code);
  console.error("ERR_MESSAGE", error?.message);
  console.error("ERR_STACK", error?.stack);
  process.exit(1);
}
