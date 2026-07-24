import { Redis } from "ioredis";

let redis: Redis | undefined;

export function getRedis(): Redis {
  if (!redis) {
    if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required");
    redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return redis;
}
