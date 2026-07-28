import { hostname } from "node:os";
import {
  ensureOperationalRuntimeSchema,
  upsertOperationalRuntime,
} from "@ticketlog/db";
import {
  hasStorageStateFile,
  hasUserDataDirState,
  type TicketLogOperationalEvent,
} from "@ticketlog/ticketlog";

const workerInstanceId =
  process.env.RAILWAY_REPLICA_ID ??
  process.env.RAILWAY_DEPLOYMENT_ID ??
  `${hostname()}:${process.pid}`;

interface RuntimeState {
  workerStatus: string;
  sessionStatus: string;
  currentRequestId: string | null;
  currentStep: string | null;
  currentUrl: string | null;
  challengeType: string | null;
  statusMessage: string | null;
}

const state: RuntimeState = {
  workerStatus: "STARTING",
  sessionStatus: "UNKNOWN",
  currentRequestId: null,
  currentStep: null,
  currentUrl: null,
  challengeType: null,
  statusMessage: "Inicializando worker",
};

function stationUrl(): string | null {
  if (process.env.TICKETLOG_OPERATOR_URL) return process.env.TICKETLOG_OPERATOR_URL;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/vnc.html`;
  }
  return null;
}

export async function initializeOperationalRuntime(): Promise<void> {
  await ensureOperationalRuntimeSchema();
  await updateOperationalRuntime({
    workerStatus: "IDLE",
    statusMessage: "Worker disponivel",
  });
}

export async function updateOperationalRuntime(patch: Partial<RuntimeState>): Promise<void> {
  Object.assign(state, patch);
  await upsertOperationalRuntime({
    workerInstanceId,
    workerStatus: state.workerStatus,
    sessionStatus: state.sessionStatus,
    providerMode: process.env.TICKETLOG_PROVIDER_MODE ?? "simulation",
    realExecutionEnabled: process.env.TICKETLOG_REAL_EXECUTION === "true",
    headless: process.env.TICKETLOG_HEADLESS !== "false",
    stationEnabled: process.env.TICKETLOG_STATION_MODE === "true",
    stationUrl: stationUrl(),
    storageStatePresent: await hasStorageStateFile(),
    persistentProfilePresent: await hasUserDataDirState(),
    currentRequestId: state.currentRequestId,
    currentStep: state.currentStep,
    currentUrl: state.currentUrl,
    challengeType: state.challengeType,
    statusMessage: state.statusMessage,
  });
}

export async function handleTicketLogOperationalEvent(event: TicketLogOperationalEvent): Promise<void> {
  await updateOperationalRuntime({
    workerStatus: event.status === "AUTH_REQUIRED" ? "WAITING_OPERATOR" : "BUSY",
    sessionStatus: event.status,
    currentUrl: event.currentUrl ?? state.currentUrl,
    challengeType: event.challengeType ?? null,
    statusMessage: event.message ?? state.statusMessage,
  });
}

export function startOperationalHeartbeat(): NodeJS.Timeout {
  return setInterval(() => {
    updateOperationalRuntime({}).catch((error) => {
      console.error({ error }, "operational runtime heartbeat failed");
    });
  }, 15_000);
}
