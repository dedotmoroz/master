import assert from "node:assert/strict";
import test from "node:test";
import { HmacVerificationTokenService } from "../../src/adapters/out/security/crypto-services.ts";

const secret = "integration-test-secret-with-at-least-32-bytes";

test("verification token is deterministic for an outbox retry", () => {
  const tokens = new HmacVerificationTokenService(secret);

  const first = tokens.issue("submission-1");
  const second = tokens.issue("submission-1");

  assert.deepEqual(second, first);
  assert.equal(tokens.isAuthentic(first.raw), true);
  assert.equal(tokens.hash(first.raw), first.hash);
});

test("verification token rejects a modified signature", () => {
  const tokens = new HmacVerificationTokenService(secret);
  const token = tokens.issue("submission-1");
  const modified = `${token.raw.slice(0, -1)}${token.raw.endsWith("a") ? "b" : "a"}`;

  assert.equal(tokens.isAuthentic(modified), false);
  assert.notEqual(tokens.hash(modified), token.hash);
});
