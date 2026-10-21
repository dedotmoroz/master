import assert from "node:assert/strict";
import test from "node:test";
import { EmailChangeRequest } from "../../src/modules/identity/domain/email-change-request.ts";
import { Account } from "../../src/modules/identity/domain/account.ts";
import { Email } from "../../src/shared/domain/value-objects.ts";
import { DomainError } from "../../src/shared/domain/domain-error.ts";

const now = new Date("2026-10-16T10:00:00Z");
const input = {
  id: "change-1", accountId: "account-1", previousEmail: "old@example.com", newEmail: "New@Example.com",
  tokenHash: "hash-only", createdAt: now, expiresAt: new Date(now.getTime() + 900_000),
};

test("email change request normalizes the address and is consumed once", () => {
  const request = EmailChangeRequest.create(input);
  assert.equal(request.newEmail.value, "new@example.com");
  assert.equal(request.pullEvents()[0]?.name, "EmailChangeRequested");
  request.consume(now);
  assert.equal(request.status, "consumed");
  assert.throws(() => request.consume(now),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_EMAIL_CHANGE_TOKEN");
});

test("expired and revoked email change links cannot be consumed", () => {
  const request = EmailChangeRequest.create(input);
  assert.throws(() => request.consume(input.expiresAt),
    (error: unknown) => error instanceof DomainError && error.code === "EMAIL_CHANGE_EXPIRED");
  const revoked = EmailChangeRequest.restore({ ...request.toSnapshot(), status: "revoked" });
  assert.throws(() => revoked.consume(now),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_EMAIL_CHANGE_TOKEN");
});

test("account email change preserves identity and emits notice to the previous email", () => {
  const account = Account.registerVerified("account-1", Email.create(input.previousEmail), now);
  account.pullEvents();
  account.changeEmail(Email.create(input.newEmail), now);
  assert.equal(account.id, "account-1");
  assert.equal(account.email.value, "new@example.com");
  assert.deepEqual(account.pullEvents()[0]?.payload, { previousEmail: "old@example.com", email: "new@example.com" });
  assert.throws(() => account.changeEmail(Email.create(input.newEmail), now),
    (error: unknown) => error instanceof DomainError && error.code === "EMAIL_UNCHANGED");
});
