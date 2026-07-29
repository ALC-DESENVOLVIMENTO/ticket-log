import {
  IndeterminateResultError,
  ManualInterventionError,
  ReprocessableAutomationError,
} from "@ticketlog/domain";

export type AutomationStepKey = "CHANGE_LIMIT" | "EVA_RELEASE";

export interface AutomationRetryDecision {
  errorCode: string;
  retry: boolean;
  finalState: "FALHA_MANUAL" | "RESULTADO_INDETERMINADO" | null;
}

const authenticationInterventionCodes = new Set([
  "BROWSER_CLOSED_DURING_MANUAL_LOGIN",
  "MANUAL_LOGIN_NOT_CONFIRMED",
  "TICKETLOG_CREDENTIALS_REQUIRED_FOR_LOGIN",
  "TICKETLOG_SESSION_NOT_AUTHENTICATED",
  "UNEXPECTED_CAPTCHA_OR_MFA",
]);

const transientUiCodes = new Set([
  "CHANGE_LIMIT_CONFIRMATION_NOT_FOUND",
  "EVA_BUTTON_NOT_CLICKABLE",
  "EVA_BUTTON_NOT_FOUND",
  "EVA_PANEL_NOT_FOUND",
  "EVA_RELEASE_CONFIRMATION_NOT_FOUND",
  "VISIBLE_LOCATOR_NOT_FOUND",
]);

export function isAuthenticationIntervention(error: unknown): boolean {
  return error instanceof ManualInterventionError && authenticationInterventionCodes.has(error.code);
}

export function decideAutomationRetry(input: {
  error: unknown;
  stepKey: AutomationStepKey;
  attemptNumber: number;
  maxAttempts: number;
}): AutomationRetryDecision {
  const attemptsRemain = input.attemptNumber < input.maxAttempts;

  if (input.error instanceof IndeterminateResultError) {
    return {
      errorCode: input.error.message,
      retry: false,
      finalState: "RESULTADO_INDETERMINADO",
    };
  }

  if (input.error instanceof ManualInterventionError) {
    const transientEvaFailure =
      input.stepKey === "EVA_RELEASE" &&
      (transientUiCodes.has(input.error.code) || input.error.code.startsWith("EVA_"));
    const transientChangeFailure =
      input.stepKey === "CHANGE_LIMIT" &&
      (transientUiCodes.has(input.error.code) ||
        input.error.code.startsWith("CHANGE_LIMIT_CLICK_DID_NOT_OPEN_FORM"));
    const canRetry = !isAuthenticationIntervention(input.error) && (transientEvaFailure || transientChangeFailure);

    return {
      errorCode: input.error.code,
      retry: canRetry && attemptsRemain,
      finalState: canRetry && attemptsRemain ? null : "FALHA_MANUAL",
    };
  }

  if (input.error instanceof ReprocessableAutomationError) {
    return {
      errorCode: input.error.code,
      retry: attemptsRemain,
      finalState: attemptsRemain ? null : "FALHA_MANUAL",
    };
  }

  const errorCode =
    input.error instanceof Error && input.error.message
      ? `UNEXPECTED_ERROR:${input.error.message.slice(0, 180)}`
      : "UNEXPECTED_ERROR";
  return {
    errorCode,
    retry: attemptsRemain,
    finalState: attemptsRemain ? null : "FALHA_MANUAL",
  };
}
