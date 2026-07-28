import {
  appendAuditEvent,
  getRequest,
  transitionRequest,
  updateLimitResult,
  upsertAutomationStep,
} from "../packages/db/dist/index.js";

const [requestId, previousLimitRaw, newLimitRaw] = process.argv.slice(2);

if (!requestId || !previousLimitRaw || !newLimitRaw) {
  console.error("Uso: node scripts/recover-limit-change.mjs <requestId> <previousLimit> <newLimit>");
  process.exit(1);
}

const previousLimit = Number(previousLimitRaw);
const newLimit = Number(newLimitRaw);

if (!Number.isFinite(previousLimit) || !Number.isFinite(newLimit)) {
  console.error("Os valores previousLimit e newLimit devem ser numericos.");
  process.exit(1);
}

const request = await getRequest(requestId);
if (!request) {
  console.error("REQUEST_NOT_FOUND");
  process.exit(1);
}

if (request.status === "RESULTADO_INDETERMINADO") {
  await transitionRequest(requestId, "FALHA_MANUAL");
}

await updateLimitResult({
  requestId,
  previousLimit,
  newLimit,
  platformResult: "RECOVERED_AFTER_REAL_LIMIT_CHANGE",
});

await upsertAutomationStep({
  requestId,
  stepKey: "CHANGE_LIMIT",
  status: "DONE",
});

await appendAuditEvent({
  requestId,
  eventType: "LIMIT_CHANGE_RECOVERED_MANUALLY",
  payload: {
    previousLimit,
    newLimit,
    note: "Limite confirmado fora do banner de sucesso; request preparado para retomar apenas a EVA.",
  },
});

console.log(
  JSON.stringify(
    {
      ok: true,
      requestId,
      previousLimit,
      newLimit,
      nextExpectedStep: "EVA_RELEASE",
    },
    null,
    2,
  ),
);
