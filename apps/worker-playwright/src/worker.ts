import "dotenv/config";
import { Worker } from "bullmq";
import pino from "pino";
import { getRedis, limitQueueName, type LimitJobData } from "@ticketlog/queue";
import { processLimitRequest } from "./processLimitRequest.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const worker = new Worker<LimitJobData>(
  limitQueueName,
  async (job) => {
    logger.info({ jobId: job.id, requestId: job.data.requestId }, "processing limit request");
    await processLimitRequest(job.data.requestId);
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
  logger.error({ jobId: job?.id, requestId: job?.data.requestId, error }, "job failed");
});

process.on("SIGTERM", async () => {
  logger.info("shutting down worker");
  await worker.close();
  process.exit(0);
});
