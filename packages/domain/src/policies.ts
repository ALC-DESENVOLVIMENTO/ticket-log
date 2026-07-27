import { assertPositiveAmount } from "./money.js";
import type { LimitPolicy } from "./types.js";

export interface PolicyDecision {
  allowed: boolean;
  requiresSecondApproval: boolean;
  reason?: string;
}

export function evaluateLimitPolicy(amount: number, policy: LimitPolicy): PolicyDecision {
  assertPositiveAmount(amount);

  if (amount > policy.maxAmount) {
    return {
      allowed: false,
      requiresSecondApproval: false,
      reason: "AMOUNT_ABOVE_MAX_POLICY",
    };
  }

  const secondApprovalEnabled = Number(policy.doubleApprovalFrom) > 0;

  return {
    allowed: true,
    requiresSecondApproval: secondApprovalEnabled && amount >= policy.doubleApprovalFrom,
  };
}
