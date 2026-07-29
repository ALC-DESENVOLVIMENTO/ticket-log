import assert from "node:assert/strict";
import test from "node:test";
import {
  IndeterminateResultError,
  ManualInterventionError,
  ReprocessableAutomationError,
} from "@ticketlog/domain";
import { decideAutomationRetry, isAuthenticationIntervention } from "./retryPolicy.js";

test("retries a transient EVA locator failure while attempts remain", () => {
  const decision = decideAutomationRetry({
    error: new ManualInterventionError("VISIBLE_LOCATOR_NOT_FOUND"),
    stepKey: "EVA_RELEASE",
    attemptNumber: 1,
    maxAttempts: 3,
  });

  assert.deepEqual(decision, {
    errorCode: "VISIBLE_LOCATOR_NOT_FOUND",
    retry: true,
    finalState: null,
  });
});

test("finishes a transient EVA failure after the final attempt", () => {
  const decision = decideAutomationRetry({
    error: new ManualInterventionError("EVA_PANEL_NOT_FOUND"),
    stepKey: "EVA_RELEASE",
    attemptNumber: 3,
    maxAttempts: 3,
  });

  assert.deepEqual(decision, {
    errorCode: "EVA_PANEL_NOT_FOUND",
    retry: false,
    finalState: "FALHA_MANUAL",
  });
});

test("does not retry authentication challenges", () => {
  const error = new ManualInterventionError("TICKETLOG_SESSION_NOT_AUTHENTICATED");
  const decision = decideAutomationRetry({
    error,
    stepKey: "CHANGE_LIMIT",
    attemptNumber: 1,
    maxAttempts: 3,
  });

  assert.equal(isAuthenticationIntervention(error), true);
  assert.equal(decision.retry, false);
  assert.equal(decision.finalState, "FALHA_MANUAL");
});

test("retries ambiguous limit confirmation so readback can reconcile it", () => {
  const decision = decideAutomationRetry({
    error: new ManualInterventionError("CHANGE_LIMIT_CONFIRMATION_NOT_FOUND"),
    stepKey: "CHANGE_LIMIT",
    attemptNumber: 1,
    maxAttempts: 3,
  });

  assert.equal(decision.retry, true);
  assert.equal(decision.finalState, null);
});

test("retries reprocessable errors and stops after the configured limit", () => {
  const retry = decideAutomationRetry({
    error: new ReprocessableAutomationError("SITE_TEMPORARILY_UNAVAILABLE"),
    stepKey: "CHANGE_LIMIT",
    attemptNumber: 2,
    maxAttempts: 3,
  });
  const exhausted = decideAutomationRetry({
    error: new ReprocessableAutomationError("SITE_TEMPORARILY_UNAVAILABLE"),
    stepKey: "CHANGE_LIMIT",
    attemptNumber: 3,
    maxAttempts: 3,
  });

  assert.equal(retry.retry, true);
  assert.equal(exhausted.retry, false);
  assert.equal(exhausted.finalState, "FALHA_MANUAL");
});

test("keeps indeterminate financial results out of automatic retries", () => {
  const decision = decideAutomationRetry({
    error: new IndeterminateResultError("LIMIT_READBACK_DIVERGED"),
    stepKey: "CHANGE_LIMIT",
    attemptNumber: 1,
    maxAttempts: 3,
  });

  assert.equal(decision.retry, false);
  assert.equal(decision.finalState, "RESULTADO_INDETERMINADO");
});
