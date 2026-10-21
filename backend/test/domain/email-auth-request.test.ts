import assert from "node:assert/strict";
import test from "node:test";
import { EmailAuthRequest } from "../../src/modules/identity/domain/email-auth-request.ts";
import { DomainError } from "../../src/shared/domain/domain-error.ts";
import { Email } from "../../src/shared/domain/value-objects.ts";

const createdAt = new Date("2026-01-01T10:00:00.000Z");

function pending() {
  return EmailAuthRequest.create({
    id: "request-1",
    email: Email.create("User@Example.com"),
    purpose: "registration",
    tokenHash: "token-hash",
    createdAt,
    expiresAt: new Date("2026-01-01T10:15:00.000Z"),
  });
}

test("Email authentication request normalizes email and is consumed once", () => {
  const request = pending();
  request.consume("account-1", new Date("2026-01-01T10:05:00.000Z"));

  const snapshot = request.toSnapshot();
  assert.equal(snapshot.email, "user@example.com");
  assert.equal(snapshot.status, "consumed");
  assert.equal(snapshot.accountId, "account-1");
  assert.throws(
    () => request.consume("account-1", new Date("2026-01-01T10:06:00.000Z")),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_AUTHENTICATION_TOKEN",
  );
});

test("Expired email authentication request cannot be consumed", () => {
  assert.throws(
    () => pending().consume("account-1", new Date("2026-01-01T10:16:00.000Z")),
    (error: unknown) => error instanceof DomainError && error.code === "AUTHENTICATION_TOKEN_EXPIRED",
  );
});
