import { verifySync } from "otplib";

export function verifyTotpCode(input: { token: string; secret: string }): boolean {
  const token = String(input.token ?? "").replace(/\D/g, "");
  if (token.length !== 6) return false;

  try {
    const result = verifySync({
      token,
      secret: input.secret,
    });
    return Boolean(result.valid);
  } catch {
    return false;
  }
}
