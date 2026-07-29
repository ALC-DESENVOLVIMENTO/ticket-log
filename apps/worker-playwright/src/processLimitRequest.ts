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
  listAutomationSteps,
  transitionRequest,
  updateLimitResult,
  updatePreviousLimit,
  upsertAutomationStep,
} from "@ticketlog/db";
import { acquireLock } from "@ticketlog/queue";
import { createTicketLogProvider } from "@ticketlog/ticketlog";
import {
  handleTicketLogOperationalEvent,
  updateOperationalRuntime,
} from "./operationalRuntime.js";
import { needsLimitChangedTransition } from "./resumeState.js";
import {
  notifyWhatsappResolvedRequest,
  notifyWhatsappRetryScheduled,
} from "./whatsappNotifier.js";
import {
  decideAutomationRetry,
  isAuthenticationIntervention,
  type AutomationStepKey,
} from "./retryPolicy.js";

interface ProcessLimitRequestOptions {
  allowManualStart?: boolean;
  attemptNumber?: number;
  maxAttempts?: number;
}

export async function processLimitRequest(requestId: string, options: ProcessLimitRequestOptions = {}): Promise<void> {
  const attemptNumber = Math.max(1, options.attemptNumber ?? 1);
  const maxAttempts = Math.max(attemptNumber, options.maxAttempts ?? 1);
  console.info({ requestId, attemptNumber, maxAttempts }, "processLimitRequest:start");
  const request = await getRequest(requestId);
  if (!request) throw new Error("REQUEST_NOT_FOUND");

  const allowedStatuses = options.allowManualStart
    ? ["NA_FILA", "FALHA_REPROCESSAVEL", "FALHA_MANUAL", "LIMITE_ALTERADO"]
    : ["NA_FILA", "FALHA_REPROCESSAVEL", "LIMITE_ALTERADO"];

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
    await updateOperationalRuntime({
      workerStatus: "BUSY",
      currentRequestId: requestId,
      currentStep: currentStep,
      challengeType: null,
      statusMessage: "Iniciando solicitacao",
    });
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
    if (request.status !== "LIMITE_ALTERADO") {
      await transitionRequest(requestId, "EM_PROCESSAMENTO");
      console.info({ requestId, status: "EM_PROCESSAMENTO" }, "processLimitRequest:state-transition");
    } else {
      currentStep = "EVA_RELEASE";
      await updateOperationalRuntime({ currentStep, statusMessage: "Retomando liberacao pela EVA" });
      console.info({ requestId, status: "LIMITE_ALTERADO" }, "processLimitRequest:resume-from-limit-changed");
    }
    const provider = createTicketLogProvider({
      onOperationalEvent: handleTicketLogOperationalEvent,
      onPreviousLimitRead: ({ requestId: readRequestId, previousLimit }) =>
        updatePreviousLimit(readRequestId, previousLimit),
    });

    const previousLimit = request.previous_limit === null ? null : Number(request.previous_limit);
    const previousSteps = await listAutomationSteps(requestId);
    const ambiguousLimitChange = previousSteps.some(
      (step) =>
        step.step_key === "CHANGE_LIMIT" &&
        step.status === "FAILED" &&
        step.error_code === "CHANGE_LIMIT_CONFIRMATION_NOT_FOUND",
    );

    if (ambiguousLimitChange && previousLimit !== null) {
      const currentLimit = await provider.readCurrentLimit({
        requestId,
        vehiclePlate: request.vehicle_plate,
      });
      const expectedLimit = Number((previousLimit + Number(request.requested_amount)).toFixed(2));
      const matchesExpected = currentLimit !== null && Math.abs(currentLimit - expectedLimit) < 0.01;
      const matchesPrevious = currentLimit !== null && Math.abs(currentLimit - previousLimit) < 0.01;

      if (matchesExpected) {
        await updateLimitResult({
          requestId,
          previousLimit,
          newLimit: currentLimit,
          platformResult: "LIMIT_VERIFIED_BY_READBACK_AFTER_AMBIGUOUS_CONFIRMATION",
        });
        await upsertAutomationStep({ requestId, stepKey: "CHANGE_LIMIT", status: "DONE" });
        await appendAuditEvent({
          requestId,
          eventType: "AMBIGUOUS_LIMIT_CHANGE_RECOVERED",
          payload: { previousLimit, currentLimit, expectedLimit },
        });
      } else if (!matchesPrevious) {
        throw new IndeterminateResultError(
          `LIMIT_READBACK_DIVERGED:previous=${previousLimit}:expected=${expectedLimit}:current=${currentLimit ?? "null"}`,
        );
      } else {
        await appendAuditEvent({
          requestId,
          eventType: "AMBIGUOUS_LIMIT_CHANGE_NOT_APPLIED",
          payload: { previousLimit, currentLimit, expectedLimit },
        });
      }
    }

    const limitAlreadyChanged = await hasCompletedStep(requestId, "CHANGE_LIMIT");
    if (limitAlreadyChanged) {
      currentStep = "EVA_RELEASE";
      await updateOperationalRuntime({ currentStep, statusMessage: "Retomando pela EVA" });
      console.info({ requestId }, "processLimitRequest:change-limit-already-done");
      if (needsLimitChangedTransition(request.status)) {
        await transitionRequest(requestId, "LIMITE_ALTERADO");
      }
      await upsertAutomationStep({ requestId, stepKey: "EVA_RELEASE", status: "RUNNING" });
      await provider.releaseEvaOnly({ requestId, vehiclePlate: request.vehicle_plate });
      await upsertAutomationStep({ requestId, stepKey: "EVA_RELEASE", status: "DONE" });
      await transitionRequest(requestId, "EVA_LIBERADA");
      await transitionRequest(requestId, "CONCLUIDA");
      await notifyWhatsappResolvedRequest(requestId);
      await updateOperationalRuntime({
        workerStatus: "IDLE",
        sessionStatus: "SESSION_READY",
        currentRequestId: null,
        currentStep: null,
        currentUrl: null,
        challengeType: null,
        statusMessage: "Solicitacao concluida",
      });
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
    await updateOperationalRuntime({ currentStep, statusMessage: "Limite alterado; iniciando EVA" });
    await upsertAutomationStep({ requestId, stepKey: "EVA_RELEASE", status: "RUNNING" });
    console.info({ requestId }, "processLimitRequest:eva-running");
    await provider.releaseEvaOnly({ requestId, vehiclePlate: request.vehicle_plate });
    await upsertAutomationStep({ requestId, stepKey: "EVA_RELEASE", status: "DONE" });
    await transitionRequest(requestId, "EVA_LIBERADA");
    await transitionRequest(requestId, "CONCLUIDA");
    await notifyWhatsappResolvedRequest(requestId);
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
    await updateOperationalRuntime({
      workerStatus: "IDLE",
      sessionStatus: "SESSION_READY",
      currentRequestId: null,
      currentStep: null,
      currentUrl: null,
      challengeType: null,
      statusMessage: "Solicitacao concluida",
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
    const changeLimitCompleted = await hasCompletedStep(requestId, "CHANGE_LIMIT").catch(() => false);
    const shouldRetry = await classifyFailure({
      requestId,
      error,
      stepKey: currentStep,
      changeLimitCompleted,
      attemptNumber,
      maxAttempts,
    });
    if (shouldRetry) {
      await notifyWhatsappRetryScheduled(requestId, currentStep).catch(() => undefined);
    }
    if (!shouldRetry) {
      await notifyWhatsappResolvedRequest(requestId).catch(() => undefined);
    }
    const authenticationRequired = isAuthenticationIntervention(error);
    await updateOperationalRuntime({
      workerStatus: authenticationRequired ? "WAITING_OPERATOR" : shouldRetry ? "RETRYING" : "IDLE",
      sessionStatus: authenticationRequired ? "AUTH_REQUIRED" : "ERROR",
      currentRequestId: requestId,
      currentStep,
      challengeType: authenticationRequired && error instanceof ManualInterventionError ? error.code : null,
      statusMessage: shouldRetry
        ? `Falha temporaria; nova tentativa automatica ${attemptNumber + 1}/${maxAttempts}`
        : error instanceof Error
          ? error.message
          : String(error),
    });
    if (shouldRetry) throw error;
  } finally {
    await lock.release();
  }
}

async function classifyFailure(input: {
  requestId: string,
  error: unknown,
  stepKey: AutomationStepKey,
  changeLimitCompleted: boolean,
  attemptNumber: number,
  maxAttempts: number,
}): Promise<boolean> {
  const decision = decideAutomationRetry(input);
  const keepLimitChangedState = input.stepKey === "EVA_RELEASE" && input.changeLimitCompleted;

  await upsertAutomationStep({
    requestId: input.requestId,
    stepKey: input.stepKey,
    status: "FAILED",
    errorCode: decision.errorCode,
  });
  await appendAuditEvent({
    requestId: input.requestId,
    eventType: decision.retry ? "AUTOMATION_RETRY_SCHEDULED" : "AUTOMATION_RETRY_EXHAUSTED",
    payload: {
      stepKey: input.stepKey,
      errorCode: decision.errorCode,
      attemptNumber: input.attemptNumber,
      maxAttempts: input.maxAttempts,
      changeLimitCompleted: input.changeLimitCompleted,
    },
  });

  if (decision.retry) {
    if (!keepLimitChangedState) {
      await transitionRequest(input.requestId, "FALHA_REPROCESSAVEL").catch(() => undefined);
    }
    return true;
  }

  if (decision.finalState) {
    await transitionRequest(input.requestId, decision.finalState).catch(() => undefined);
  }
  return false;
}
