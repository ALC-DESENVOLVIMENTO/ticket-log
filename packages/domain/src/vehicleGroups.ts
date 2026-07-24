import type { LimitPolicy, VehicleGroup } from "./types.js";

export const vehicleGroups: VehicleGroup[] = [
  "GERAL_DE_RESTRICOES",
  "VEICULO_DE_PASSEIO",
  "UTILITARIOS",
  "VAN",
  "VUC",
];

export const vehicleGroupLabels: Record<VehicleGroup, string> = {
  GERAL_DE_RESTRICOES: "Geral de restricoes",
  VEICULO_DE_PASSEIO: "Veiculo de passeio",
  UTILITARIOS: "Utilitarios",
  VAN: "Van",
  VUC: "Vuc",
};

export function isVehicleGroup(value: string): value is VehicleGroup {
  return vehicleGroups.includes(value as VehicleGroup);
}

export function buildGroupPoliciesFromEnv(env: Record<string, string | undefined>): Record<VehicleGroup, LimitPolicy> {
  const doubleApprovalFrom = Number(env.LIMIT_DOUBLE_APPROVAL_FROM ?? 0);
  const windowHours = Number(env.LIMIT_WINDOW_HOURS ?? 24);

  return {
    GERAL_DE_RESTRICOES: {
      maxAmount: Number(env.LIMIT_GROUP_GERAL_DE_RESTRICOES ?? 2000),
      doubleApprovalFrom,
      windowHours,
    },
    VEICULO_DE_PASSEIO: {
      maxAmount: Number(env.LIMIT_GROUP_VEICULO_DE_PASSEIO ?? 70),
      doubleApprovalFrom,
      windowHours,
    },
    UTILITARIOS: {
      maxAmount: Number(env.LIMIT_GROUP_UTILITARIOS ?? 90),
      doubleApprovalFrom,
      windowHours,
    },
    VAN: {
      maxAmount: Number(env.LIMIT_GROUP_VAN ?? 100),
      doubleApprovalFrom,
      windowHours,
    },
    VUC: {
      maxAmount: Number(env.LIMIT_GROUP_VUC ?? 150),
      doubleApprovalFrom,
      windowHours,
    },
  };
}
