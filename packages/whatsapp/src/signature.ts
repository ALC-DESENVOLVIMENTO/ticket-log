import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyMetaWebhookSignature(input: {
  rawBody: Buffer;
  signatureHeader?: string;
  appSecret: string;
}): boolean {
  if (!input.signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", input.appSecret).update(input.rawBody).digest("hex");
  const received = input.signatureHeader.slice("sha256=".length);

  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
