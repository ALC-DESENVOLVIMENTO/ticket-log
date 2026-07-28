import {
  IndeterminateResultError,
  ManualInterventionError,
  ReprocessableAutomationError,
  normalizePlate,
} from "@ticketlog/domain";
import {
  appendAuditEvent,
  getRequest,
  hasCompletedStep,
  transitionRequest,
  updateLimitResult,
  upsertAutomationStep,
} from "@ticketlog/db";
import { acquireLock } from "@ticketlog/queue";
import { createTicketLogProvider } from "@ticketlog/ticketlog";

type AutomationStepKey = "CHANGE_LIMIT" | "EVA_RELEASE";

interface ProcessLimitRequestOptions {
  allowManualStart?: boolean;
}

export async function processLimitRequest(requestId: string, options: ProcessLimitRequestOptions = {}): Promise<void> {
  console.info({ requestId }, "processLimitRequest:start");
  const request = await getRequest(requestId);
  if (!request) throw new Error("REQUEST_NOT_FOUND");

  const allowedStatuses = options.allowManualStart
    ? ["NA_FILA", "FALHA_REPROCESSAVEL", "FALHA_MANUAL"]
    : ["NA_FILA", "FALHA_REPROCESSAVEL"];

  if (!allowedStatuses.includes(request.status)) {
    await appendAuditEvent({
      requestId,
      eventType: "JOB_IGNORED_INVALID_STATE",
      payload: { status: request.status },
    });
    return;
  }

  const lock = await acquireLock(`plate:${normalizePlate(request.vehicle_plate)}`, 15 * 60_000);
  if (!lock.acquired) {
    throw new ReprocessableAutomationError("PLATE_ALREADY_LOCKED");
  }

  let currentStep: AutomationStepKey = "CHANGE_LIMIT";

  try {
    if (request.status === "FALHA_REPROCESSAVEL") {
      await transitionRequest(requestId, "NA_FILA");
    }
    if (request.status === "FALHA_MANUAL" && options.allowManualStart) {
      await appendAuditEvent({
        requestId,
        eventType: "MANUAL_PROCESSING_STARTED",
        payload: { previousStatus: request.status },
      });
      await transitionRequest(requestId, "NA_FILA");
    }
    await transitionRequest(requestId, "EM_PROCESSAMENTO");
    console.info({ requestId, status: "EM_PROCESSAMENTO" }, "processLimitRequest:state-transition");
    const provider = createTicketLogProvider();

    const limitAlreadyChanged = await hasCompletedStep(requestId, "CHANGE_LIMIT");
    if (limitAlreadyChanged) {
      currentStep = "EVA_RELEASE";
      console.info({ requestId }, "processLimitRequest:change-limit-already-done");
      await transitionRequest(requestId, "LIMITE_ALTERADO");
      await upsertAutomationStep({ requestId, stepKey: "EVA_RELEASE", status: "RUNNING" });
      await provider.releaseEvaOnly({ requestId, vehiclePlate: request.vehicle_plate });
      await upsertAutomationStep({ requestId, stepKey: "EVA_RELEASE", status: "DONE" });
      await transitionRequest(requestId, "EVA_LIBERADA");
      await transitionRequest(requestId, "CONCLUIDA");
      return;
    }

    await upsertAutomationStep({ requestId, stepKey: "CHANGE_LIMIT", status: "RUNNING" });
    console.info({ requestId, plate: request.vehicle_plate, amount: Number(request.requested_amount) }, "processLimitRequest:change-limit-running");
    const result = await provider.changeLimit({
      requestId,
      vehiclePlate: request.vehicle_plate,
      requestedAmount: Number(request.requested_amount),
    });

    await updateLimitResult({
      requestId,
      previousLimit: result.previousLimit,
      newLimit: result.newLimit,
      platformResult: result.platformResult,
    });

    await upsertAutomationStep({ requestId, stepKey: "CHANGE_LIMIT", status: "DONE" });
    await transitionRequest(requestId, "LIMITE_ALTERADO");
    console.info({ requestId }, "processLimitRequest:change-limit-done");

    currentStep = "EVA_RELEASE";
    await upsertAutomationStep({ requestId, stepKey: "EVA_RELEASE", status: "RUNNING" });
    console.info({ requestId }, "processLimitRequest:eva-running");
    await provider.releaseEvaOnly({ requestId, vehiclePlate: request.vehicle_plate });
    await upsertAutomationStep({ requestId, stepKey: "EVA_RELEASE", status: "DONE" });
    await transitionRequest(requestId, "EVA_LIBERADA");
    await transitionRequest(requestId, "CONCLUIDA");
    console.info({ requestId }, "processLimitRequest:completed");

    await appendAuditEvent({
      requestId,
      eventType: "AUTOMATION_COMPLETED",
      payload: {
        previousLimit: result.previousLimit,
        addedAmount: result.addedAmount,
        newLimit: result.newLimit,
      },
    });
  } catch (error) {
    console.error(
      {
        requestId,
        stepKey: currentStep,
        errorName: error instanceof Error ? error.name : "UNKNOWN_ERROR",
        errorMessage: error instanceof Error ? error.message : String(error),
        errorCode: typeof error === "object" && error && "code" in error ? (error as any).code : undefined,
        errorStack: error instanceof Error ? error.stack : undefined,
      },
      "processLimitRequest:error",
    );
    const shouldRetry = await classifyFailure(requestId, error, currentStep);
    if (shouldRetry) throw error;
  } finally {
    await lock.release();
  }
}

async function classifyFailure(requestId: string, error: unknown, stepKey: AutomationStepKey): Promise<boolean> {
  if (error instanceof ManualInterventionError) {
    await upsertAutomationStep({ requestId, stepKey, status: "FAILED", errorCode: error.code });
    await transitionRequest(requestId, "FALHA_MANUAL").catch(() => undefined);
    return false;
  }

  if (error instanceof IndeterminateResultError) {
    await upsertAutomationStep({ requestId, stepKey, status: "FAILED", errorCode: error.message });
    await transitionRequest(requestId, "RESULTADO_INDETERMINADO").catch(() => undefined);
    return false;
  }

  if (error instanceof ReprocessableAutomationError) {
    await upsertAutomationStep({ requestId, stepKey, status: "FAILED", errorCode: error.code });
    await transitionRequest(requestId, "FALHA_REPROCESSAVEL").catch(() => undefined);
    return true;
  }

  const unexpectedErrorCode =
    error instanceof Error && error.message
      ? `UNEXPECTED_ERROR:${error.message.slice(0, 180)}`
      : "UNEXPECTED_ERROR";
  await upsertAutomationStep({ requestId, stepKey, status: "FAILED", errorCode: unexpectedErrorCode });
  await transitionRequest(requestId, "FALHA_REPROCESSAVEL").catch(() => undefined);
  return true;
}
