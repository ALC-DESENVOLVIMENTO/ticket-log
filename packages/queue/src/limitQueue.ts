import { Queue } from "bullmq";
import { getRedis } from "./connection.js";

export interface LimitJobData {
  requestId: string;
}

export const limitQueueName = "ticketlog-limit-requests";

export function getLimitQueue(): Queue<LimitJobData> {
  return new Queue<LimitJobData>(limitQueueName, {
    connection: getRedis(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: 500,
      removeOnFail: false,
    },
  });
}

export async function enqueueLimitRequest(requestId: string): Promise<void> {
  await getLimitQueue().add(
    "process-limit-request",
    { requestId },
    {
      jobId: requestId,
    },
  );
}
