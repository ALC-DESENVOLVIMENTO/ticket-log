import type { FastifyInstance } from "fastify";
import { getPool } from "@ticketlog/db";
import { vehicleGroupLabels } from "@ticketlog/domain";
import { config } from "../config.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/healthz", async () => ({ ok: true }));

  app.get("/config/public", async () => ({
    companyName: config.companyName,
    executionMode:
      process.env.APP_EXECUTION_MODE ??
      (process.env.NODE_ENV === "production" ? "operacional" : "simulacao"),
    approvalTtlMinutes: config.approvalTtlMinutes,
    vehicleGroups: Object.entries(config.groupPolicies).map(([key, policy]) => ({
      key,
      label: vehicleGroupLabels[key as keyof typeof vehicleGroupLabels],
      maxAmount: policy.maxAmount,
      requiresSecondApprovalFrom: policy.doubleApprovalFrom,
    })),
  }));

  app.get("/readyz", async () => {
    await getPool().query("select 1");
    return { ok: true };
  });
}
