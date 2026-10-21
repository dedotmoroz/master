import assert from "node:assert/strict";
import test from "node:test";
import { Account } from "../../src/modules/identity/domain/account.ts";
import { AccountDeletionRequest } from "../../src/modules/identity/domain/account-deletion-request.ts";
import { Email } from "../../src/shared/domain/value-objects.ts";
import { DomainError } from "../../src/shared/domain/domain-error.ts";

const now = new Date("2026-10-16T10:00:00Z");
const input = { id: "request-1", accountId: "account-1", email: "Owner@Example.com", tokenHash: "hashed-token",
  createdAt: now, expiresAt: new Date(now.getTime() + 900_000) };

test("account deletion removes the email and capabilities while preserving identity", () => {
  const account = Account.registerVerified("account-1", Email.create(input.email), now);
  account.grantCapability("contractor", now);
  account.pullEvents();
  account.delete(now);
  assert.equal(account.id, "account-1");
  assert.equal(account.status, "deleted");
  assert.equal(account.email.value, "deleted-account-1@accounts.invalid");
  assert.deepEqual(account.capabilities, []);
  assert.equal(account.pullEvents()[0]?.name, "AccountDeleted");
  assert.throws(() => account.changeEmail(Email.create(input.email), now),
    (error: unknown) => error instanceof DomainError && error.code === "ACCOUNT_NOT_ACTIVE");
});

test("deletion links are single-use and reject expired or revoked requests", () => {
  const request = AccountDeletionRequest.create(input);
  assert.equal(request.email.value, "owner@example.com");
  assert.equal(request.pullEvents()[0]?.name, "AccountDeletionRequested");
  assert.throws(() => request.consume(input.expiresAt),
    (error: unknown) => error instanceof DomainError && error.code === "DELETION_TOKEN_EXPIRED");
  request.consume(now);
  assert.throws(() => request.consume(now),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_DELETION_TOKEN");
  const revoked = AccountDeletionRequest.restore({ ...request.toSnapshot(), status: "revoked" });
  assert.throws(() => revoked.consume(now));
});
