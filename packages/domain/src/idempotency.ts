import { createHash } from "node:crypto";
import { normalizePlate } from "./plate.js";

export function buildRequestIdempotencyKey(input: {
  requesterId: string;
  vehiclePlate: string;
  vehicleGroup?: string;
  requestedAmount: number;
  bucket: string;
}): string {
  return createHash("sha256")
    .update(input.requesterId)
    .update("|")
    .update(normalizePlate(input.vehiclePlate))
    .update("|")
    .update(input.vehicleGroup ?? "")
    .update("|")
    .update(input.requestedAmount.toFixed(2))
    .update("|")
    .update(input.bucket)
    .digest("hex");
}
