import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "./client.js";

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function appendAuditEvent(input: {
  client?: PoolClient;
  requestId?: string;
  actorUserId?: string;
  eventType: string;
  payload: unknown;
}): Promise<void> {
  const client = input.client ?? getPool();
  const previous = await client.query<{ event_hash: string }>(
    "select event_hash from audit_events order by created_at desc limit 1",
  );
  const previousHash = previous.rows[0]?.event_hash ?? null;
  const payloadHash = hashJson(input.payload);
  const eventHash = createHash("sha256")
    .update(`${previousHash ?? ""}|${payloadHash}|${input.eventType}|${new Date().toISOString()}`)
    .digest("hex");

  await client.query(
    `insert into audit_events(
      request_id, actor_user_id, event_type, payload_hash, previous_event_hash, event_hash
    ) values ($1, $2, $3, $4, $5, $6)`,
    [input.requestId ?? null, input.actorUserId ?? null, input.eventType, payloadHash, previousHash, eventHash],
  );
}
