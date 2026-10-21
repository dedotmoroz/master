import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../../src/shared/domain/domain-error.ts";
import { Money, MoneyRange } from "../../src/shared/domain/value-objects.ts";
import { Bid } from "../../src/modules/marketplace/domain/bid.ts";
import { Order } from "../../src/modules/marketplace/domain/order.ts";
import { Review } from "../../src/modules/reputation/domain/review.ts";

const now = new Date("2026-01-01T10:00:00.000Z");

function makeOrder(id = "order-1", customerId = "customer-1"): Order {
  return Order.createPublished(
    {
      id,
      customerId,
      categoryId: "category-1",
      locationId: "location-1",
      title: "Ремонт ванной",
      description: "Нужен капитальный ремонт ванной комнаты.",
      budget: MoneyRange.create(Money.fromMinor(100_000_00), Money.fromMinor(200_000_00)),
      attachmentIds: [],
      createdAt: now,
    },
    now,
  );
}

function makeBid(
  order: Order,
  overrides: Partial<Parameters<typeof Bid.submit>[0]> = {},
): Bid {
  return Bid.submit({
    id: "bid-1",
    contractorId: "contractor-1",
    message: "Готов выполнить работу, опыт десять лет.",
    price: MoneyRange.create(Money.fromMinor(120_000_00), Money.fromMinor(150_000_00)),
    durationDaysMin: 10,
    durationDaysMax: 14,
    visibility: "public",
    submittedAt: now,
    ...overrides,
  }, order);
}

test("Customer selects a submitted bid and starts the order", () => {
  const order = makeOrder();
  const bid = makeBid(order);

  order.selectBid("customer-1", bid, new Date("2026-01-02T10:00:00.000Z"));

  assert.equal(order.status, "in_progress");
  assert.equal(order.selectedBidId, bid.id);
  assert.equal(order.contractorId, "contractor-1");
  assert.equal(bid.status, "selected");
});

test("A non-owner cannot select a bid", () => {
  const order = makeOrder();
  assert.throws(
    () => order.selectBid("another-user", makeBid(order), now),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_FORBIDDEN",
  );
});

test("A bid from another order cannot be selected", () => {
  const order = makeOrder();
  const anotherOrder = makeOrder("order-2", "customer-2");
  assert.throws(
    () => order.selectBid("customer-1", makeBid(anotherOrder), now),
    (error: unknown) => error instanceof DomainError && error.code === "BID_ORDER_MISMATCH",
  );
});

test("Only a participant can complete an in-progress order", () => {
  const order = makeOrder();
  order.selectBid("customer-1", makeBid(order), now);
  assert.throws(() => order.complete("stranger", now), /Only an order participant/u);

  order.complete("contractor-1", now);
  assert.equal(order.status, "completed");
});

test("Review can be created only between participants of a completed order", () => {
  const order = makeOrder();
  order.selectBid("customer-1", makeBid(order), now);
  order.complete("customer-1", now);

  const review = Review.create({
    id: "review-1",
    order,
    authorId: "customer-1",
    subjectId: "contractor-1",
    score: 5,
    text: "Работа выполнена качественно и в срок.",
    createdAt: now,
  });

  assert.equal(review.status, "published");
  assert.equal(review.score, 5);
});

test("Review is rejected before order completion", () => {
  const order = makeOrder();
  order.selectBid("customer-1", makeBid(order), now);

  assert.throws(
    () =>
      Review.create({
        id: "review-1",
        order,
        authorId: "customer-1",
        subjectId: "contractor-1",
        score: 5,
        text: "Слишком ранний отзыв.",
        createdAt: now,
      }),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_NOT_COMPLETED",
  );
});

test("Bid validates duration range", () => {
  const order = makeOrder();
  assert.throws(
    () => makeBid(order, { durationDaysMin: 14, durationDaysMax: 10 }),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_DURATION_RANGE",
  );
});

test("Customer cannot submit a bid on their own order", () => {
  const order = makeOrder();
  assert.throws(
    () => makeBid(order, { contractorId: "customer-1" }),
    (error: unknown) => error instanceof DomainError && error.code === "SELF_BID",
  );
});

test("A cancelled order does not accept bids", () => {
  const order = makeOrder();
  order.cancel("customer-1", now);
  assert.throws(
    () => makeBid(order),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_NOT_ACCEPTING_BIDS",
  );
});
