import { Queue } from "bullmq";
import { getRedis } from "./connection.js";

export interface LimitJobData {
  requestId: string;
}

export const limitQueueName = "ticketlog-limit-requests";

export function getLimitQueue(): Queue<LimitJobData> {
  const configuredAttempts = Number(process.env.LIMIT_JOB_ATTEMPTS ?? 3);
  const configuredRetryDelayMs = Number(process.env.LIMIT_RETRY_DELAY_MS ?? 15_000);
  const attempts = Number.isFinite(configuredAttempts) ? Math.max(1, Math.floor(configuredAttempts)) : 3;
  const retryDelayMs = Number.isFinite(configuredRetryDelayMs)
    ? Math.max(1_000, Math.floor(configuredRetryDelayMs))
    : 15_000;
  return new Queue<LimitJobData>(limitQueueName, {
    connection: getRedis(),
    defaultJobOptions: {
      attempts,
      backoff: { type: "exponential", delay: retryDelayMs },
      removeOnComplete: 500,
      removeOnFail: false,
    },
  });
}

export async function enqueueLimitRequest(requestId: string): Promise<void> {
  const queue = getLimitQueue();
  const existingJob = await queue.getJob(requestId);
  if (existingJob) {
    const state = await existingJob.getState();
    if (["active", "delayed", "waiting", "waiting-children", "paused"].includes(state)) {
      return;
    }

    await existingJob.remove().catch(() => undefined);
  }

  await queue.add(
    "process-limit-request",
    { requestId },
    {
      jobId: requestId,
    },
  );
}
