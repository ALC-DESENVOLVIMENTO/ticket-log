import { randomUUID } from "node:crypto";
import { getRedis } from "./connection.js";

export interface LockHandle {
  acquired: boolean;
  release(): Promise<void>;
}

export async function acquireLock(key: string, ttlMs: number): Promise<LockHandle> {
  const redis = getRedis();
  const token = randomUUID();
  const lockKey = `lock:${key}`;
  const result = await redis.set(lockKey, token, "PX", ttlMs, "NX");

  return {
    acquired: result === "OK",
    async release() {
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await redis.eval(script, 1, lockKey, token);
    },
  };
}
