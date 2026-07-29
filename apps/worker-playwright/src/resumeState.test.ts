import assert from "node:assert/strict";
import test from "node:test";
import { needsLimitChangedTransition } from "./resumeState.js";

test("does not repeat LIMITE_ALTERADO when resuming EVA", () => {
  assert.equal(needsLimitChangedTransition("LIMITE_ALTERADO"), false);
});

test("restores LIMITE_ALTERADO when resuming from another recoverable state", () => {
  assert.equal(needsLimitChangedTransition("FALHA_REPROCESSAVEL"), true);
});
