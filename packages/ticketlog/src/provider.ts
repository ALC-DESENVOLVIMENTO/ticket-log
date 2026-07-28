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

export type TicketLogOperationalStatus =
  | "SESSION_CHECKING"
  | "SESSION_READY"
  | "AUTH_REQUIRED"
  | "AUTOMATING"
  | "IDLE";

export interface TicketLogOperationalEvent {
  status: TicketLogOperationalStatus;
  currentUrl?: string;
  challengeType?: string;
  message?: string;
}

export interface TicketLogProviderHooks {
  onOperationalEvent?(event: TicketLogOperationalEvent): Promise<void> | void;
}

export interface TicketLogProvider {
  changeLimit(input: TicketLogLimitInput): Promise<TicketLogLimitResult>;
  releaseEvaOnly(input: Pick<TicketLogLimitInput, "requestId" | "vehiclePlate">): Promise<void>;
}
