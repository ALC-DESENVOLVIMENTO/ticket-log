import type { TicketLogLimitInput, TicketLogLimitResult, TicketLogProvider } from "./provider.js";

export class OfficialApiTicketLogProvider implements TicketLogProvider {
  async changeLimit(_input: TicketLogLimitInput): Promise<TicketLogLimitResult> {
    throw new Error("TICKETLOG_OFFICIAL_API_NOT_CONFIGURED");
  }

  async readCurrentLimit(): Promise<number | null> {
    throw new Error("TICKETLOG_OFFICIAL_API_NOT_CONFIGURED");
  }

  async releaseEvaOnly(): Promise<void> {
    throw new Error("TICKETLOG_OFFICIAL_API_NOT_CONFIGURED");
  }
}
