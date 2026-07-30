import assert from "node:assert/strict";
import test from "node:test";
import { generateSecret, generateSync } from "otplib";
import { verifyTotpCode } from "./mfa.js";

test("verifyTotpCode accepts only the current valid TOTP token", () => {
  const secret = generateSecret();
  const token = generateSync({ secret });

  assert.equal(verifyTotpCode({ token, secret }), true);
  assert.equal(verifyTotpCode({ token: "123456", secret }), false);
  assert.equal(verifyTotpCode({ token: "12345", secret }), false);
  assert.equal(verifyTotpCode({ token: "abcdef", secret }), false);
});
