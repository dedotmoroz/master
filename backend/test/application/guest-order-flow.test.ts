import assert from "node:assert/strict";
import test from "node:test";
import { Account } from "../../src/modules/identity/domain/account.ts";
import type {
  AccountRepository,
  Clock,
  IdGenerator,
  OrderRepository,
  OrderSubmissionRepository,
  SessionIssuer,
  TransactionManager,
  VerificationTokenService,
} from "../../src/modules/marketplace/application/ports/guest-order-ports.ts";
import { ConfirmGuestOrderHandler } from "../../src/modules/marketplace/application/use-cases/confirm-guest-order.ts";
import { SubmitGuestOrderHandler } from "../../src/modules/marketplace/application/use-cases/submit-guest-order.ts";
import type { OrderSubmission } from "../../src/modules/marketplace/domain/order-submission.ts";
import type { Order } from "../../src/modules/marketplace/domain/order.ts";
import { DomainError } from "../../src/shared/domain/domain-error.ts";
import { Email } from "../../src/shared/domain/value-objects.ts";
import type {
  GuestAttachmentClaim,
  GuestAttachmentClaims,
} from "../../src/modules/attachments/application/ports/attachment-ports.ts";
import type { WorkCategorySelectionPolicy } from "../../src/modules/catalog/application/ports/work-category-ports.ts";
import type { RussianLocationSelectionPolicy } from "../../src/modules/geography/application/ports/russian-location-ports.ts";

class FixedClock implements Clock {
  current: Date;

  constructor(current: Date) {
    this.current = current;
  }

  now(): Date {
    return new Date(this.current);
  }
}

class SequenceIds implements IdGenerator {
  #prefix: string;
  #next = 1;

  constructor(prefix: string) {
    this.#prefix = prefix;
  }

  next(): string {
    return `${this.#prefix}-${this.#next++}`;
  }
}

class FakeTokens implements VerificationTokenService {
  issue(subject: string) {
    const raw = `raw-secret-token:${subject}`;
    return { raw, hash: this.hash(raw) };
  }

  hash(raw: string): string {
    return `hashed:${raw}`;
  }
}

class InMemorySubmissions implements OrderSubmissionRepository {
  readonly items = new Map<string, OrderSubmission>();

  async save(submission: OrderSubmission): Promise<void> {
    this.items.set(submission.id, submission);
  }

  async findById(submissionId: string): Promise<OrderSubmission | null> {
    return this.items.get(submissionId) ?? null;
  }

  async findByTokenHash(tokenHash: string): Promise<OrderSubmission | null> {
    return [...this.items.values()].find((item) => item.tokenHash === tokenHash) ?? null;
  }
}

class InMemoryAccounts implements AccountRepository {
  readonly items = new Map<string, Account>();

  async save(account: Account): Promise<void> {
    this.items.set(account.id, account);
  }

  async findById(accountId: string): Promise<Account | null> {
    return this.items.get(accountId) ?? null;
  }

  async findByEmail(email: Email): Promise<Account | null> {
    return [...this.items.values()].find((item) => item.email.equals(email)) ?? null;
  }
}

class InMemoryOrders implements OrderRepository {
  readonly items = new Map<string, Order>();

  async save(order: Order): Promise<void> {
    this.items.set(order.id, order);
  }

  async findById(orderId: string): Promise<Order | null> {
    return this.items.get(orderId) ?? null;
  }
}

class FakeSessions implements SessionIssuer {
  async issue(accountId: string): Promise<string> {
    return `session:${accountId}`;
  }
}

class DirectTransactions implements TransactionManager {
  calls = 0;

  async execute<T>(work: () => Promise<T>): Promise<T> {
    this.calls += 1;
    return work();
  }
}

class FakeGuestAttachments implements GuestAttachmentClaims {
  reserved: Readonly<{ submissionId: string; claims: readonly GuestAttachmentClaim[] }> | null = null;
  assignments: Array<Readonly<{ submissionId: string; accountId: string; attachmentIds: readonly string[] }>> = [];

  async reserveForSubmission(submissionId: string, claims: readonly GuestAttachmentClaim[]): Promise<readonly string[]> {
    this.reserved = { submissionId, claims };
    return claims.map((claim) => claim.attachmentId);
  }

  async assignToAccount(submissionId: string, accountId: string, attachmentIds: readonly string[]): Promise<void> {
    this.assignments.push({ submissionId, accountId, attachmentIds });
  }
}

const allowCategories: WorkCategorySelectionPolicy = {
  assertSelectable: async () => undefined,
};

const allowLocations: RussianLocationSelectionPolicy = {
  assertSelectable: async () => undefined,
};

const command = {
  email: "Customer@Example.com",
  contactName: "Анна",
  categoryId: "category-1",
  locationId: "location-1",
  title: "Построить загородный дом",
  description: "Ищу бригаду для строительства дома по готовому проекту.",
  budgetMinMinor: 5_000_000_00,
  budgetMaxMinor: 7_000_000_00,
  consentVersion: "2026-01",
} as const;

function createFixture() {
  const clock = new FixedClock(new Date("2026-01-01T10:00:00.000Z"));
  const submissions = new InMemorySubmissions();
  const accounts = new InMemoryAccounts();
  const orders = new InMemoryOrders();
  const tokens = new FakeTokens();
  const transactions = new DirectTransactions();
  const guestAttachments = new FakeGuestAttachments();
  const submit = new SubmitGuestOrderHandler({
    submissions,
    tokens,
    ids: new SequenceIds("submission"),
    clock,
    transactions,
    guestAttachments,
    categories: allowCategories,
    locations: allowLocations,
  });
  const confirm = new ConfirmGuestOrderHandler({
    submissions,
    accounts,
    orders,
    sessions: new FakeSessions(),
    tokens,
    accountIds: new SequenceIds("account"),
    orderIds: new SequenceIds("order"),
    clock,
    transactions,
    guestAttachments,
  });
  return { clock, submissions, accounts, orders, tokens, transactions, guestAttachments, submit, confirm };
}

test("SubmitGuestOrder stores only the deterministic token hash", async () => {
  const fixture = createFixture();
  const result = await fixture.submit.execute(command);
  const submission = fixture.submissions.items.get(result.submissionId);

  assert.ok(submission);
  assert.equal(submission.email.value, "customer@example.com");
  assert.equal(submission.tokenHash, "hashed:raw-secret-token:submission-1");
  assert.equal(result.expiresAt.toISOString(), "2026-01-02T10:00:00.000Z");
});

test("ConfirmGuestOrder creates an account and publishes the order atomically", async () => {
  const fixture = createFixture();
  await fixture.submit.execute(command);

  const result = await fixture.confirm.execute("raw-secret-token:submission-1");
  const account = fixture.accounts.items.get(result.accountId);
  const order = fixture.orders.items.get(result.orderId);

  assert.equal(result.reusedAccount, false);
  assert.equal(result.alreadyConfirmed, false);
  assert.equal(result.sessionToken, `session:${result.accountId}`);
  assert.equal(account?.hasCapability("customer"), true);
  assert.equal(order?.status, "published");
  assert.equal(order?.customerId, result.accountId);
  assert.equal(fixture.transactions.calls, 2);
});

test("Guest attachment claims are reserved for the submission and assigned to the confirmed account", async () => {
  const fixture = createFixture();
  await fixture.submit.execute({
    ...command,
    temporaryAttachments: [{ attachmentId: "attachment-1", claimToken: "claim-1" }],
  });
  const result = await fixture.confirm.execute("raw-secret-token:submission-1");

  assert.deepEqual(fixture.guestAttachments.reserved, {
    submissionId: "submission-1",
    claims: [{ attachmentId: "attachment-1", claimToken: "claim-1" }],
  });
  assert.deepEqual(fixture.orders.items.get(result.orderId)?.attachmentIds, ["attachment-1"]);
  assert.deepEqual(fixture.guestAttachments.assignments[0], {
    submissionId: "submission-1",
    accountId: result.accountId,
    attachmentIds: ["attachment-1"],
  });
});

test("ConfirmGuestOrder reuses an existing account without creating another one", async () => {
  const fixture = createFixture();
  const existing = Account.registerVerified(
    "existing-account",
    Email.create(command.email),
    fixture.clock.now(),
  );
  await fixture.accounts.save(existing);
  await fixture.submit.execute(command);

  const result = await fixture.confirm.execute("raw-secret-token:submission-1");

  assert.equal(result.accountId, "existing-account");
  assert.equal(result.reusedAccount, true);
  assert.equal(fixture.accounts.items.size, 1);
  assert.equal(existing.hasCapability("customer"), true);
});

test("ConfirmGuestOrder is idempotent for repeated link visits", async () => {
  const fixture = createFixture();
  await fixture.submit.execute(command);
  const first = await fixture.confirm.execute("raw-secret-token:submission-1");
  const second = await fixture.confirm.execute("raw-secret-token:submission-1");

  assert.equal(second.orderId, first.orderId);
  assert.equal(second.accountId, first.accountId);
  assert.equal(second.alreadyConfirmed, true);
  assert.equal(fixture.orders.items.size, 1);
});

test("ConfirmGuestOrder rejects an expired confirmation link", async () => {
  const fixture = createFixture();
  await fixture.submit.execute(command);
  fixture.clock.current = new Date("2026-01-02T10:00:00.000Z");

  await assert.rejects(
    fixture.confirm.execute("raw-secret-token:submission-1"),
    (error: unknown) => error instanceof DomainError && error.code === "SUBMISSION_EXPIRED",
  );
  assert.equal(fixture.orders.items.size, 0);
});

test("ConfirmGuestOrder does not reveal whether an unknown token ever existed", async () => {
  const fixture = createFixture();
  await assert.rejects(
    fixture.confirm.execute("unknown-token"),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_CONFIRMATION_TOKEN",
  );
});
