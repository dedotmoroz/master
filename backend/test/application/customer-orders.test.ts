import assert from "node:assert/strict";
import test from "node:test";
import type { CustomerOrderReadRepository } from "../../src/modules/marketplace/application/ports/customer-order-ports.ts";
import type { BidRepository } from "../../src/modules/marketplace/application/ports/bid-ports.ts";
import type {
  Clock,
  OrderRepository,
  TransactionManager,
} from "../../src/modules/marketplace/application/ports/guest-order-ports.ts";
import {
  CancelCustomerOrderHandler,
  GetCustomerOrderHandler,
  ListCustomerOrdersHandler,
  UpdateCustomerOrderHandler,
} from "../../src/modules/marketplace/application/use-cases/customer-orders.ts";
import { Order } from "../../src/modules/marketplace/domain/order.ts";
import { Bid } from "../../src/modules/marketplace/domain/bid.ts";
import { DomainError } from "../../src/shared/domain/domain-error.ts";
import { Money, MoneyRange } from "../../src/shared/domain/value-objects.ts";

class FixedClock implements Clock {
  now(): Date {
    return new Date("2026-01-02T10:00:00.000Z");
  }
}

class DirectTransactions implements TransactionManager {
  async execute<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

class RecordingOrders implements OrderRepository {
  readonly order: Order;
  locked = false;
  saves = 0;

  constructor(order: Order) {
    this.order = order;
  }

  async save(): Promise<void> {
    this.saves += 1;
  }

  async findById(
    orderId: string,
    options: Readonly<{ forUpdate?: boolean }> = {},
  ): Promise<Order | null> {
    this.locked ||= options.forUpdate === true;
    return orderId === this.order.id ? this.order : null;
  }
}

class EmptyBids implements BidRepository {
  async save(_bid: Bid): Promise<void> {}
  async findById(): Promise<Bid | null> { return null; }
  async findActiveByOrderAndContractor(): Promise<Bid | null> { return null; }
  async findSubmittedByOrder(): Promise<readonly Bid[]> { return []; }
}

function publishedOrder(): Order {
  return Order.createPublished(
    {
      id: "order-1",
      customerId: "customer-1",
      categoryId: "house-building",
      locationId: "moscow-region",
      title: "Построить дом",
      description: "Подробное описание строительства дома.",
      budget: MoneyRange.create(Money.fromMinor(100_000), Money.fromMinor(200_000)),
      attachmentIds: [],
      createdAt: new Date("2026-01-01T10:00:00.000Z"),
    },
    new Date("2026-01-01T10:05:00.000Z"),
  );
}

test("ListCustomerOrders scopes the query to the authenticated account", async () => {
  let received: unknown;
  const repository: CustomerOrderReadRepository = {
    listByCustomer: async (customerId, pagination) => {
      received = { customerId, ...pagination };
      return { items: [], total: 0, ...pagination };
    },
  };

  const page = await new ListCustomerOrdersHandler(repository).execute(
    "customer-1",
    { limit: 20, offset: 40 },
  );

  assert.deepEqual(received, { customerId: "customer-1", limit: 20, offset: 40 });
  assert.equal(page.total, 0);
});

test("GetCustomerOrder hides orders belonging to another customer", async () => {
  const repository = new RecordingOrders(publishedOrder());
  const handler = new GetCustomerOrderHandler(repository);

  await assert.rejects(
    handler.execute("another-customer", "order-1"),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_NOT_FOUND",
  );
});

test("CancelCustomerOrder locks and cancels a published order idempotently", async () => {
  const order = publishedOrder();
  order.pullEvents();
  const repository = new RecordingOrders(order);
  const handler = new CancelCustomerOrderHandler({
    orders: repository,
    bids: new EmptyBids(),
    clock: new FixedClock(),
    transactions: new DirectTransactions(),
  });

  const first = await handler.execute("customer-1", "order-1");
  const firstEvents = order.pullEvents();
  const second = await handler.execute("customer-1", "order-1");

  assert.equal(repository.locked, true);
  assert.equal(first.status, "cancelled");
  assert.equal(second.status, "cancelled");
  assert.equal(firstEvents.filter((event) => event.name === "OrderCancelled").length, 1);
  assert.equal(order.pullEvents().length, 0);
});

test("CancelCustomerOrder rejects an in-progress order", async () => {
  const order = Order.restore({
    ...publishedOrder().toSnapshot(),
    status: "in_progress",
    selectedBidId: "bid-1",
    contractorId: "contractor-1",
  });
  const handler = new CancelCustomerOrderHandler({
    orders: new RecordingOrders(order),
    bids: new EmptyBids(),
    clock: new FixedClock(),
    transactions: new DirectTransactions(),
  });

  await assert.rejects(
    handler.execute("customer-1", "order-1"),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_NOT_CANCELLABLE",
  );
});

test("CancelCustomerOrder cancels all submitted bids in the same operation", async () => {
  const order = publishedOrder();
  const bid = Bid.submit({
    id: "bid-1",
    contractorId: "contractor-1",
    message: "Готов выполнить этот заказ.",
    price: MoneyRange.unspecified(),
    durationDaysMin: null,
    durationDaysMax: null,
    visibility: "public",
    submittedAt: new Date("2026-01-01T11:00:00.000Z"),
  }, order);
  const bids: BidRepository = {
    save: async () => undefined,
    findById: async () => bid,
    findActiveByOrderAndContractor: async () => bid,
    findSubmittedByOrder: async () => [bid],
  };
  const handler = new CancelCustomerOrderHandler({
    orders: new RecordingOrders(order),
    bids,
    clock: new FixedClock(),
    transactions: new DirectTransactions(),
  });

  await handler.execute("customer-1", "order-1");

  assert.equal(order.status, "cancelled");
  assert.equal(bid.status, "cancelled");
});

test("order editing validates all details before mutation, is idempotent, and preserves publication time", () => {
  const order = publishedOrder();
  const before = order.toSnapshot();
  order.pullEvents();
  const details = {
    categoryId: "foundation", locationId: "ru-region-43", title: "Новый заголовок",
    description: "Новые условия строительства.", budget: MoneyRange.unspecified(), attachmentIds: ["photo-1"],
  };
  assert.throws(() => order.update("customer-1", { ...details, title: " " }, new FixedClock().now()));
  assert.deepEqual(order.toSnapshot(), before);
  assert.throws(() => order.update("stranger", details, new FixedClock().now()),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_FORBIDDEN");
  order.update("customer-1", details, new FixedClock().now());
  order.update("customer-1", details, new FixedClock().now());
  assert.equal(order.pullEvents().filter((event) => event.name === "OrderUpdated").length, 1);
  assert.equal(order.title, details.title);
  assert.deepEqual(order.toSnapshot().publishedAt, before.publishedAt);
  assert.equal(order.status, "published");
});

test("order editing is forbidden for assigned, completed and cancelled orders", () => {
  for (const status of ["in_progress", "completed", "cancelled"] as const) {
    const order = Order.restore({ ...publishedOrder().toSnapshot(), status });
    assert.throws(() => order.update("customer-1", {
      categoryId: order.categoryId, locationId: order.locationId, title: "Изменение",
      description: order.description, budget: order.budget, attachmentIds: [],
    }, new FixedClock().now()),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_NOT_EDITABLE");
  }
});

test("UpdateCustomerOrder locks the order, checks selections and attachment ownership, and hides foreign orders", async () => {
  const orders = new RecordingOrders(publishedOrder());
  const checks: unknown[] = [];
  const handler = new UpdateCustomerOrderHandler({
    orders, clock: new FixedClock(), transactions: new DirectTransactions(),
    categories: { assertSelectable: async (ids) => { checks.push(ids); } },
    locations: { assertSelectable: async (ids) => { checks.push(ids); } },
    attachments: { assertUsable: async (...args) => { checks.push(args); } },
  });
  const command = {
    accountId: "customer-1", orderId: "order-1", categoryId: "foundation", locationId: "ru-region-43",
    title: "Фундамент дома", description: "Нужен монолитный фундамент.",
    budgetMinMinor: 500_000, budgetMaxMinor: 700_000, attachmentIds: ["photo-1"],
  };
  await assert.rejects(handler.execute({ ...command, accountId: "stranger" }),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_NOT_FOUND");
  assert.equal(checks.length, 0);
  const updated = await handler.execute(command);
  assert.equal(orders.locked, true);
  assert.equal(orders.saves, 1);
  assert.equal(updated.budget.minMinor, 500_000);
  assert.deepEqual(checks, [["foundation"], ["ru-region-43"], ["customer-1", ["photo-1"], "order"]]);
});
