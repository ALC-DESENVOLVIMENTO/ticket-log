import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

function appKey(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY ?? process.env.APP_SIGNING_SECRET ?? "development-only-key";
  if (/^[A-Za-z0-9+/=]{43,}$/.test(raw)) {
    try {
      const decoded = Buffer.from(raw, "base64");
      if (decoded.length >= 32) return decoded.subarray(0, 32);
    } catch {
      // Fall back to derived key.
    }
  }
  return createHash("sha256").update(raw).digest();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash?: string | null): Promise<boolean> {
  if (!storedHash) return false;
  const [scheme, salt, expected] = storedHash.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = (await scryptAsync(password, salt, 64)) as Buffer;
  const expectedBuffer = Buffer.from(expected, "base64url");
  if (actual.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actual, expectedBuffer);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function encryptText(value: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", appKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

export function decryptText(value: Buffer): string {
  const iv = value.subarray(0, 12);
  const tag = value.subarray(12, 28);
  const encrypted = value.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", appKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
