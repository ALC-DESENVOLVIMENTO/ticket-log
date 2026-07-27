import "dotenv/config";
import { Worker } from "bullmq";
import pino from "pino";
import { getRedis, limitQueueName, type LimitJobData } from "@ticketlog/queue";
import { hydrateStorageStateFromEnv } from "@ticketlog/ticketlog";
import { processLimitRequest } from "./processLimitRequest.js";

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

const worker = new Worker<LimitJobData>(
  limitQueueName,
  async (job) => {
    logger.info({ jobId: job.id, requestId: job.data.requestId }, "processing limit request");
    try {
      await processLimitRequest(job.data.requestId);
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
  await worker.close();
  process.exit(0);
});
