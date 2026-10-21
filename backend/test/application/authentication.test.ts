import assert from "node:assert/strict";
import test from "node:test";
import {
  ConfirmEmailAuthenticationHandler,
  EmailAuthenticationRequestedHandler,
  RequestEmailAuthenticationHandler,
} from "../../src/modules/identity/application/authentication.ts";
import type { EmailAuthRequestRepository, SessionManager } from "../../src/modules/identity/application/ports/authentication-ports.ts";
import { Account } from "../../src/modules/identity/domain/account.ts";
import { EmailAuthRequest, type EmailAuthPurpose } from "../../src/modules/identity/domain/email-auth-request.ts";
import type { AccountRepository, Clock, IdGenerator, TransactionManager, VerificationTokenService } from "../../src/modules/marketplace/application/ports/guest-order-ports.ts";
import { DomainError } from "../../src/shared/domain/domain-error.ts";
import { Email } from "../../src/shared/domain/value-objects.ts";
import { RateLimitedAuthenticationRequestAccess } from "../../src/modules/identity/application/authentication-request-access.ts";

class Services implements Clock, IdGenerator, TransactionManager {
  current = new Date("2026-01-01T10:00:00.000Z");
  nextId = 0;
  now(): Date { return new Date(this.current); }
  next(): string { this.nextId += 1; return `id-${this.nextId}`; }
  execute<T>(work: () => Promise<T>): Promise<T> { return work(); }
}

class Tokens implements VerificationTokenService {
  issue(subject: string) { const raw = `token:${subject}`; return { raw, hash: this.hash(raw) }; }
  hash(raw: string): string { return `hash:${raw}`; }
}

class Requests implements EmailAuthRequestRepository {
  readonly items = new Map<string, EmailAuthRequest>();
  async save(request: EmailAuthRequest): Promise<void> { this.items.set(request.id, request); }
  async findById(id: string): Promise<EmailAuthRequest | null> { return this.items.get(id) ?? null; }
  async findByTokenHash(hash: string): Promise<EmailAuthRequest | null> {
    return [...this.items.values()].find((item) => item.tokenHash === hash) ?? null;
  }
  async revokePending(email: Email, purpose: EmailAuthPurpose): Promise<void> {
    for (const [id, request] of this.items) {
      if (request.email.value === email.value && request.purpose === purpose && request.status === "pending") this.items.delete(id);
    }
  }
}

class Accounts implements AccountRepository {
  readonly items = new Map<string, Account>();
  async save(account: Account): Promise<void> { this.items.set(account.id, account); }
  async findById(id: string): Promise<Account | null> { return this.items.get(id) ?? null; }
  async findByEmail(email: Email): Promise<Account | null> {
    return [...this.items.values()].find((account) => account.email.value === email.value) ?? null;
  }
}

class Sessions implements SessionManager {
  issued: string[] = [];
  async issue(accountId: string): Promise<string> { this.issued.push(accountId); return `session:${accountId}`; }
  async revoke(): Promise<void> {}
  async revokeAll(): Promise<void> {}
}

function fixture() {
  const services = new Services();
  const requests = new Requests();
  const accounts = new Accounts();
  const sessions = new Sessions();
  const tokens = new Tokens();
  const request = new RequestEmailAuthenticationHandler({
    requests,
    accounts,
    access: { assertAllowed: async () => undefined },
    tokens,
    ids: services,
    clock: services,
    transactions: services,
  });
  const confirm = new ConfirmEmailAuthenticationHandler({
    requests,
    accounts,
    sessions,
    tokens,
    ids: services,
    clock: services,
    transactions: services,
  });
  return { services, requests, accounts, sessions, tokens, request, confirm };
}

test("Registration creates an account only after the one-time email token is confirmed", async () => {
  const context = fixture();
  await context.request.execute({ email: "New@Example.com", purpose: "registration", clientAddress: "127.0.0.1" });
  assert.equal(context.accounts.items.size, 0);
  const authRequest = [...context.requests.items.values()][0] as EmailAuthRequest;

  const result = await context.confirm.execute(context.tokens.issue(`email-auth:${authRequest.id}`).raw, "registration");
  assert.equal(result.createdAccount, true);
  assert.equal(result.email, "new@example.com");
  assert.equal(result.sessionToken, `session:${result.accountId}`);
  assert.equal(authRequest.status, "consumed");
  await assert.rejects(
    context.confirm.execute(context.tokens.issue(`email-auth:${authRequest.id}`).raw, "registration"),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_AUTHENTICATION_TOKEN",
  );
});

test("Registration of an existing active email becomes a login without duplicating the account", async () => {
  const context = fixture();
  const existing = Account.registerVerified("account-existing", Email.create("user@example.com"), context.services.now());
  context.accounts.items.set(existing.id, existing);
  await context.request.execute({ email: "user@example.com", purpose: "registration", clientAddress: "127.0.0.1" });
  const authRequest = [...context.requests.items.values()][0] as EmailAuthRequest;

  const result = await context.confirm.execute(context.tokens.issue(`email-auth:${authRequest.id}`).raw, "registration");
  assert.equal(result.createdAccount, false);
  assert.equal(result.accountId, existing.id);
  assert.equal(context.accounts.items.size, 1);
});

test("Login request for an unknown email has the same success path but sends no email", async () => {
  const context = fixture();
  await context.request.execute({ email: "unknown@example.com", purpose: "login", clientAddress: "127.0.0.1" });
  assert.equal(context.requests.items.size, 0);
});

test("Outbox handler reconstructs the deterministic email token", async () => {
  const context = fixture();
  await context.request.execute({ email: "mail@example.com", purpose: "registration", clientAddress: "127.0.0.1" });
  const request = [...context.requests.items.values()][0] as EmailAuthRequest;
  const messages: unknown[] = [];
  const handler = new EmailAuthenticationRequestedHandler({
    requests: context.requests,
    tokens: context.tokens,
    email: { sendAuthenticationLink: async (message) => { messages.push(message); } },
  });
  await handler.execute(request.id);
  assert.equal(messages.length, 1);
  assert.equal((messages[0] as { rawToken: string }).rawToken, context.tokens.issue(`email-auth:${request.id}`).raw);
});

test("Authentication requests are rate limited by both client address and normalized email", async () => {
  const calls: Array<{ action: string; clientAddress: string }> = [];
  const policy = new RateLimitedAuthenticationRequestAccess({
    rateLimiter: {
      consume: async (input) => {
        calls.push(input);
        return input.action === "email_auth_email"
          ? { allowed: false, retryAfterSeconds: 60 }
          : { allowed: true, retryAfterSeconds: 0 };
      },
    },
    clock: new Services(),
    ipLimit: 20,
    emailLimit: 5,
    windowSeconds: 900,
  });

  await assert.rejects(
    policy.assertAllowed({ clientAddress: "127.0.0.1", email: Email.create("User@Example.com") }),
    (error: unknown) => error instanceof DomainError
      && error.code === "RATE_LIMIT_EXCEEDED"
      && error.details.retryAfterSeconds === 60,
  );
  assert.deepEqual(calls.map(({ action, clientAddress }) => ({ action, clientAddress })), [
    { action: "email_auth_ip", clientAddress: "127.0.0.1" },
    { action: "email_auth_email", clientAddress: "user@example.com" },
  ]);
});
