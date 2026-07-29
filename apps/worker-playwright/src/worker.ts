import "dotenv/config";
import { Worker } from "bullmq";
import pino from "pino";
import { getRedis, limitQueueName, type LimitJobData } from "@ticketlog/queue";
import { closeBrowserStation, hydrateStorageStateFromEnv, initializeBrowserStation } from "@ticketlog/ticketlog";
import { processLimitRequest } from "./processLimitRequest.js";
import {
  initializeOperationalRuntime,
  startOperationalHeartbeat,
  updateOperationalRuntime,
} from "./operationalRuntime.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

await hydrateStorageStateFromEnv()
  .then((status: "written" | "skipped" | "missing_path") => {
    logger.info({ status }, "ticketlog session bootstrap checked");
    return status;
  })
  .catch((error: unknown) => {
    logger.error(
      {
        errorName: error instanceof Error ? error.name : "UNKNOWN_ERROR",
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      },
      "ticketlog session bootstrap failed",
    );
    throw error;
  });

await initializeOperationalRuntime();
await initializeBrowserStation()
  .then(() => updateOperationalRuntime({
    sessionStatus: process.env.TICKETLOG_STATION_MODE === "true" ? "STATION_READY" : "UNKNOWN",
    statusMessage: process.env.TICKETLOG_STATION_MODE === "true" ? "Estacao operacional pronta" : "Worker disponivel",
  }))
  .catch(async (error: unknown) => {
    await updateOperationalRuntime({
      workerStatus: "DEGRADED",
      sessionStatus: "STATION_FAILED",
      statusMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  });
const heartbeat = startOperationalHeartbeat();

const worker = new Worker<LimitJobData>(
  limitQueueName,
  async (job) => {
    const attemptNumber = job.attemptsMade + 1;
    const maxAttempts = Number(job.opts.attempts ?? 1);
    logger.info(
      { jobId: job.id, requestId: job.data.requestId, attemptNumber, maxAttempts },
      "processing limit request",
    );
    try {
      await processLimitRequest(job.data.requestId, { attemptNumber, maxAttempts });
    } catch (error) {
      logger.error(
        {
          jobId: job.id,
          requestId: job.data.requestId,
          errorName: error instanceof Error ? error.name : "UNKNOWN_ERROR",
          errorMessage: error instanceof Error ? error.message : String(error),
          errorCode: typeof error === "object" && error && "code" in error ? (error as any).code : undefined,
          errorStack: error instanceof Error ? error.stack : undefined,
        },
        "processing limit request failed inside worker",
      );
      throw error;
    }
  },
  {
    connection: getRedis(),
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1),
    lockDuration: 15 * 60_000,
  },
);

worker.on("completed", (job) => {
  logger.info({ jobId: job.id, requestId: job.data.requestId }, "job completed");
});

worker.on("failed", (job, error) => {
  logger.error(
    {
      jobId: job?.id,
      requestId: job?.data.requestId,
      errorName: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCode: typeof error === "object" && error && "code" in error ? (error as any).code : undefined,
      errorStack: error instanceof Error ? error.stack : undefined,
    },
    "job failed",
  );
});

process.on("SIGTERM", async () => {
  logger.info("shutting down worker");
  clearInterval(heartbeat);
  await updateOperationalRuntime({ workerStatus: "STOPPING", statusMessage: "Worker encerrando" }).catch(() => undefined);
  await worker.close();
  await closeBrowserStation().catch(() => undefined);
  process.exit(0);
});
