import assert from "node:assert/strict";
import test from "node:test";
import {
  isEvaFrameCandidate,
  isEvaReleaseConfirmation,
  ticketLogUi,
} from "./uiMap.js";

test("recognizes the EVA frame by its observed HAR host", () => {
  assert.equal(
    isEvaFrameCandidate("https://eva-front.edenred.com.br/", ""),
    true,
  );
});

test("recognizes the EVA frame by its visible greeting", () => {
  assert.equal(
    isEvaFrameCandidate("", "Olá! Sou a EVA, a assistente virtual da Ticket Log."),
    true,
  );
});

test("matches the observed EVA action labels", () => {
  assert.match("Transações ⛽️", ticketLogUi.eva.transactions);
  assert.match(
    "Liberar abastecimento (restrição)",
    ticketLogUi.eva.releaseFuelRestriction,
  );
});

test("recognizes a successful restriction release", () => {
  assert.equal(
    isEvaReleaseConfirmation("A restrição foi liberada com sucesso."),
    true,
  );
});

test("does not treat an unrelated EVA response as success", () => {
  assert.equal(
    isEvaReleaseConfirmation("Não foi possível localizar a placa."),
    false,
  );
});
