import assert from "node:assert/strict";
import test from "node:test";
import { Account } from "../../src/modules/identity/domain/account.ts";
import type { BidRepository } from "../../src/modules/marketplace/application/ports/bid-ports.ts";
import type {
  AccountRepository,
  Clock,
  IdGenerator,
  OrderRepository,
  TransactionManager,
} from "../../src/modules/marketplace/application/ports/guest-order-ports.ts";
import {
  SelectBidHandler,
  SubmitBidHandler,
  WithdrawBidHandler,
} from "../../src/modules/marketplace/application/use-cases/marketplace-bids.ts";
import { Bid } from "../../src/modules/marketplace/domain/bid.ts";
import { Order } from "../../src/modules/marketplace/domain/order.ts";
import { DomainError } from "../../src/shared/domain/domain-error.ts";
import { Email, Money, MoneyRange } from "../../src/shared/domain/value-objects.ts";

const now = new Date("2026-01-02T10:00:00.000Z");

class FixedClock implements Clock {
  now(): Date { return new Date(now); }
}

class FixedId implements IdGenerator {
  next(): string { return "bid-new"; }
}

class DirectTransactions implements TransactionManager {
  async execute<T>(work: () => Promise<T>): Promise<T> { return work(); }
}

class MemoryAccounts implements AccountRepository {
  readonly items = new Map<string, Account>();
  async save(account: Account): Promise<void> { this.items.set(account.id, account); }
  async findById(accountId: string): Promise<Account | null> { return this.items.get(accountId) ?? null; }
  async findByEmail(email: Email): Promise<Account | null> {
    return [...this.items.values()].find((account) => account.email.equals(email)) ?? null;
  }
}

class MemoryOrders implements OrderRepository {
  readonly items = new Map<string, Order>();
  async save(order: Order): Promise<void> { this.items.set(order.id, order); }
  async findById(orderId: string): Promise<Order | null> { return this.items.get(orderId) ?? null; }
}

class MemoryBids implements BidRepository {
  readonly items = new Map<string, Bid>();
  async save(bid: Bid): Promise<void> { this.items.set(bid.id, bid); }
  async findById(bidId: string): Promise<Bid | null> { return this.items.get(bidId) ?? null; }
  async findActiveByOrderAndContractor(orderId: string, contractorId: string): Promise<Bid | null> {
    return [...this.items.values()].find((bid) =>
      bid.orderId === orderId
      && bid.contractorId === contractorId
      && (bid.status === "submitted" || bid.status === "selected")) ?? null;
  }
  async findSubmittedByOrder(orderId: string): Promise<readonly Bid[]> {
    return [...this.items.values()].filter((bid) => bid.orderId === orderId && bid.status === "submitted");
  }
}

function createOrder(): Order {
  return Order.createPublished({
    id: "order-1",
    customerId: "customer-1",
    categoryId: "category-1",
    locationId: "location-1",
    title: "Ремонт квартиры",
    description: "Нужен полный ремонт двухкомнатной квартиры.",
    budget: MoneyRange.create(Money.fromMinor(100_000), Money.fromMinor(200_000)),
    attachmentIds: [],
    createdAt: now,
  }, now);
}

function bidCommand(contractorId = "contractor-1") {
  return {
    orderId: "order-1",
    contractorId,
    message: "Готов выполнить работу качественно и в срок.",
    priceMinMinor: 120_000,
    priceMaxMinor: 150_000,
    durationDaysMin: 10,
    durationDaysMax: 14,
    visibility: "public" as const,
  };
}

function fixture() {
  const accounts = new MemoryAccounts();
  const orders = new MemoryOrders();
  const bids = new MemoryBids();
  const customer = Account.registerVerified("customer-1", Email.create("customer@example.com"), now);
  const contractor = Account.registerVerified("contractor-1", Email.create("contractor@example.com"), now);
  accounts.items.set(customer.id, customer);
  accounts.items.set(contractor.id, contractor);
  orders.items.set("order-1", createOrder());
  const dependencies = {
    orders,
    bids,
    accounts,
    ids: new FixedId(),
    clock: new FixedClock(),
    transactions: new DirectTransactions(),
  };
  return { ...dependencies, submit: new SubmitBidHandler(dependencies) };
}

test("SubmitBid creates a bid and grants contractor capability", async () => {
  const context = fixture();

  const result = await context.submit.execute(bidCommand());

  assert.equal(result.status, "submitted");
  assert.equal(context.accounts.items.get("contractor-1")?.hasCapability("contractor"), true);
  assert.equal(context.bids.items.size, 1);
});

test("SubmitBid prevents duplicate active bid for the same order", async () => {
  const context = fixture();
  await context.submit.execute(bidCommand());

  await assert.rejects(
    context.submit.execute(bidCommand()),
    (error: unknown) => error instanceof DomainError && error.code === "BID_ALREADY_EXISTS",
  );
});

test("WithdrawBid hides another contractor's bid", async () => {
  const context = fixture();
  await context.submit.execute(bidCommand());
  const handler = new WithdrawBidHandler(context);

  await assert.rejects(
    handler.execute("another-contractor", "bid-new"),
    (error: unknown) => error instanceof DomainError && error.code === "BID_NOT_FOUND",
  );
  const withdrawn = await handler.execute("contractor-1", "bid-new");
  assert.equal(withdrawn.status, "withdrawn");
});

test("SelectBid starts the order, selects one bid, and rejects the rest", async () => {
  const context = fixture();
  const order = context.orders.items.get("order-1") as Order;
  const selected = Bid.submit({
    id: "bid-1",
    contractorId: "contractor-1",
    message: "Первое предложение подрядчика.",
    price: MoneyRange.unspecified(),
    durationDaysMin: null,
    durationDaysMax: null,
    visibility: "private",
    submittedAt: now,
  }, order);
  const rejected = Bid.submit({
    id: "bid-2",
    contractorId: "contractor-2",
    message: "Второе предложение подрядчика.",
    price: MoneyRange.unspecified(),
    durationDaysMin: null,
    durationDaysMax: null,
    visibility: "public",
    submittedAt: now,
  }, order);
  context.bids.items.set(selected.id, selected);
  context.bids.items.set(rejected.id, rejected);
  const handler = new SelectBidHandler(context);

  const result = await handler.execute("customer-1", "order-1", "bid-1");
  const repeated = await handler.execute("customer-1", "order-1", "bid-1");

  assert.equal(result.orderStatus, "in_progress");
  assert.equal(repeated.bidId, "bid-1");
  assert.equal(order.status, "in_progress");
  assert.equal(selected.status, "selected");
  assert.equal(rejected.status, "rejected");
});
