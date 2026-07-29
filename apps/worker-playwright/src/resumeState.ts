import type { RequestState } from "@ticketlog/domain";

export function needsLimitChangedTransition(initialStatus: RequestState): boolean {
  return initialStatus !== "LIMITE_ALTERADO";
}
