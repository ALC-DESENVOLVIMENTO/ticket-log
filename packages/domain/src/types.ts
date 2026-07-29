export type RequestChannel = "whatsapp" | "web" | "admin";

export type UserStatus = "active" | "disabled";

export type RoleKey =
  | "SUPERVISOR"
  | "COORDENADOR"
  | "SOLICITANTE"
  | "APROVADOR"
  | "ADMINISTRADOR";

export type VehicleGroup =
  | "GERAL_DE_RESTRICOES"
  | "VEICULO_DE_PASSEIO"
  | "UTILITARIOS"
  | "VAN"
  | "VUC";

export type RequestState =
  | "RASCUNHO"
  | "AGUARDANDO_AUTENTICACAO"
  | "AGUARDANDO_APROVACAO"
  | "AGUARDANDO_SEGUNDA_APROVACAO"
  | "NA_FILA"
  | "EM_PROCESSAMENTO"
  | "LIMITE_ALTERADO"
  | "EVA_LIBERADA"
  | "CONCLUIDA"
  | "REJEITADA"
  | "EXPIRADA"
  | "CANCELADA"
  | "FALHA_REPROCESSAVEL"
  | "FALHA_MANUAL"
  | "RESULTADO_INDETERMINADO";

export type AutomationStepKey =
  | "OPEN_VEHICLE_LIST"
  | "SEARCH_PLATE"
  | "OPEN_VEHICLE"
  | "UNBLOCK_VEHICLE"
  | "READ_CURRENT_LIMIT"
  | "CHANGE_LIMIT"
  | "EVA_RELEASE"
  | "NOTIFY_REQUESTER";

export type StepStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";

export interface LimitPolicy {
  maxAmount: number;
  doubleApprovalFrom: number;
  windowHours: number;
  maxRequestsPerUserWindow?: number;
  maxRequestsPerPlateWindow?: number;
}

export interface CreateRequestInput {
  requesterId: string;
  channel: RequestChannel;
  vehiclePlate: string;
  vehicleGroup: VehicleGroup;
  requestedAmount: number;
  justification?: string;
}

export interface RequestSummary {
  id: string;
  vehiclePlate: string;
  vehicleGroup: VehicleGroup;
  requestedAmount: number;
  requesterId: string;
  status: RequestState;
  expiresAt: Date;
}
