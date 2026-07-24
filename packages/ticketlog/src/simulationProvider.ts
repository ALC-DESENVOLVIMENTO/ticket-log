import type { TicketLogLimitInput, TicketLogLimitResult, TicketLogProvider } from "./provider.js";

export class SimulationTicketLogProvider implements TicketLogProvider {
  async changeLimit(input: TicketLogLimitInput): Promise<TicketLogLimitResult> {
    const previousLimit = 1000;
    return {
      previousLimit,
      addedAmount: input.requestedAmount,
      newLimit: previousLimit + input.requestedAmount,
      platformResult: "SIMULATION_ONLY_LIMIT_CHANGED",
    };
  }

  async releaseEvaOnly(): Promise<void> {
    return;
  }
}
