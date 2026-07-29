import { verify } from "otplib";

export function verifyTotpCode(input: { token: string; secret: string }): boolean {
  const token = String(input.token ?? "").replace(/\D/g, "");
  if (token.length !== 6) return false;

  try {
    const result = verify({
      token,
      secret: input.secret,
    });
    return Boolean(result);
  } catch {
    return false;
  }
}
