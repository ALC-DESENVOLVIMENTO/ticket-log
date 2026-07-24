import type { RequestState } from "./types.js";

const transitions: Record<RequestState, RequestState[]> = {
  RASCUNHO: ["AGUARDANDO_AUTENTICACAO", "CANCELADA"],
  AGUARDANDO_AUTENTICACAO: ["AGUARDANDO_APROVACAO", "EXPIRADA", "CANCELADA"],
  AGUARDANDO_APROVACAO: [
    "AGUARDANDO_SEGUNDA_APROVACAO",
    "NA_FILA",
    "REJEITADA",
    "EXPIRADA",
    "CANCELADA",
  ],
  AGUARDANDO_SEGUNDA_APROVACAO: ["NA_FILA", "REJEITADA", "EXPIRADA", "CANCELADA"],
  NA_FILA: ["EM_PROCESSAMENTO", "CANCELADA", "FALHA_REPROCESSAVEL"],
  EM_PROCESSAMENTO: [
    "LIMITE_ALTERADO",
    "FALHA_REPROCESSAVEL",
    "FALHA_MANUAL",
    "RESULTADO_INDETERMINADO",
  ],
  LIMITE_ALTERADO: ["EVA_LIBERADA", "FALHA_REPROCESSAVEL", "FALHA_MANUAL", "RESULTADO_INDETERMINADO"],
  EVA_LIBERADA: ["CONCLUIDA", "FALHA_REPROCESSAVEL"],
  CONCLUIDA: [],
  REJEITADA: [],
  EXPIRADA: [],
  CANCELADA: [],
  FALHA_REPROCESSAVEL: ["NA_FILA", "FALHA_MANUAL", "CANCELADA"],
  FALHA_MANUAL: ["NA_FILA", "CANCELADA"],
  RESULTADO_INDETERMINADO: ["FALHA_MANUAL"],
};

export function canTransition(from: RequestState, to: RequestState): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(from: RequestState, to: RequestState): void {
  if (!canTransition(from, to)) {
    throw new Error(`INVALID_STATE_TRANSITION:${from}->${to}`);
  }
}

export function allowedTransitions(from: RequestState): RequestState[] {
  return transitions[from];
}
