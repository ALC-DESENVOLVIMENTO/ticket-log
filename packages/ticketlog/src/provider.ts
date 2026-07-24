export interface TicketLogLimitInput {
  requestId: string;
  vehiclePlate: string;
  requestedAmount: number;
}

export interface TicketLogLimitResult {
  previousLimit: number | null;
  addedAmount: number;
  newLimit: number | null;
  platformResult: string;
}

export interface TicketLogProvider {
  changeLimit(input: TicketLogLimitInput): Promise<TicketLogLimitResult>;
  releaseEvaOnly(input: Pick<TicketLogLimitInput, "requestId" | "vehiclePlate">): Promise<void>;
}
