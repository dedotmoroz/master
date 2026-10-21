import assert from "node:assert/strict";
import test from "node:test";
import type {
  Clock,
  IdGenerator,
  OrderRepository,
  TransactionManager,
} from "../../src/modules/marketplace/application/ports/guest-order-ports.ts";
import { CompleteOrderHandler } from "../../src/modules/marketplace/application/use-cases/order-lifecycle.ts";
import { Order } from "../../src/modules/marketplace/domain/order.ts";
import type {
  ReputationReadRepository,
  ReviewRepository,
} from "../../src/modules/reputation/application/ports/reputation-ports.ts";
import {
  GetContractorProfileHandler,
  GetOrderDealHandler,
  ListContractorsHandler,
  ListContractorReviewsHandler,
  SubmitReviewHandler,
} from "../../src/modules/reputation/application/reputation.ts";
import type { Review } from "../../src/modules/reputation/domain/review.ts";
import { DomainError } from "../../src/shared/domain/domain-error.ts";

const completedAt = new Date("2026-01-04T10:00:00.000Z");

class FixedServices implements Clock, IdGenerator, TransactionManager {
  now(): Date { return new Date(completedAt); }
  next(): string { return "review-1"; }
  execute<T>(work: () => Promise<T>): Promise<T> { return work(); }
}

class MemoryOrders implements OrderRepository {
  locked = false;
  saves = 0;
  readonly order: Order;
  constructor(order: Order) { this.order = order; }
  async save(): Promise<void> { this.saves += 1; }
  async findById(id: string, options: Readonly<{ forUpdate?: boolean }> = {}): Promise<Order | null> {
    this.locked ||= options.forUpdate === true;
    return id === this.order.id ? this.order : null;
  }
}

class MemoryReviews implements ReviewRepository {
  review: Review | null = null;
  async save(review: Review): Promise<void> { this.review = review; }
  async findByOrderAndAuthor(orderId: string, authorId: string): Promise<Review | null> {
    return this.review?.orderId === orderId && this.review.authorId === authorId ? this.review : null;
  }
}

function inProgressOrder(): Order {
  return Order.restore({
    id: "order-1",
    customerId: "customer-1",
    categoryId: "category-1",
    locationId: "location-1",
    title: "Ремонт квартиры",
    description: "Полный ремонт квартиры под ключ.",
    budgetMinMinor: null,
    budgetMaxMinor: null,
    budgetCurrency: "RUB",
    attachmentIds: [],
    status: "in_progress",
    selectedBidId: "bid-1",
    contractorId: "contractor-1",
    createdAt: new Date("2026-01-01T10:00:00.000Z"),
    publishedAt: new Date("2026-01-01T10:05:00.000Z"),
    completedAt: null,
  });
}

test("deal read is participant-only and exposes only the caller's saved review", async () => {
  const services = new FixedServices(); const orders = new MemoryOrders(inProgressOrder()); const reviews = new MemoryReviews();
  const get = new GetOrderDealHandler({ orders, reviews, transactions: services });
  await assert.rejects(get.execute("outsider", "order-1"), error => error instanceof DomainError && error.code === "ORDER_NOT_FOUND");
  await assert.rejects(get.execute("customer-1", "missing"), error => error instanceof DomainError && error.code === "ORDER_NOT_FOUND");
  assert.equal((await get.execute("contractor-1", "order-1")).status, "in_progress");
  await new CompleteOrderHandler({ orders, clock: services, transactions: services }).execute("customer-1", "order-1");
  await new SubmitReviewHandler({ orders, reviews, ids: services, clock: services, transactions: services }).execute({ orderId: "order-1", authorId: "customer-1", score: 5, text: "Хорошая работа" });
  assert.equal((await get.execute("customer-1", "order-1")).ownReview?.score, 5);
  assert.equal((await get.execute("contractor-1", "order-1")).ownReview, null);
  assert.equal(orders.locked, true);
});

test("CompleteOrder locks the aggregate and is idempotent for both participants", async () => {
  const services = new FixedServices();
  const orders = new MemoryOrders(inProgressOrder());
  const handler = new CompleteOrderHandler({ orders, clock: services, transactions: services });

  const first = await handler.execute("contractor-1", "order-1");
  const second = await handler.execute("customer-1", "order-1");

  assert.equal(orders.locked, true);
  assert.equal(first.status, "completed");
  assert.equal(second.completedAt.toISOString(), completedAt.toISOString());
  assert.equal(orders.order.pullEvents().filter((event) => event.name === "OrderCompleted").length, 1);
});

test("CompleteOrder hides an order from a non-participant", async () => {
  const services = new FixedServices();
  const handler = new CompleteOrderHandler({
    orders: new MemoryOrders(inProgressOrder()),
    clock: services,
    transactions: services,
  });

  await assert.rejects(
    handler.execute("stranger", "order-1"),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_NOT_FOUND",
  );
});

test("SubmitReview derives the other participant and prevents duplicates", async () => {
  const services = new FixedServices();
  const order = inProgressOrder();
  order.complete("customer-1", completedAt);
  order.pullEvents();
  const reviews = new MemoryReviews();
  const handler = new SubmitReviewHandler({
    orders: new MemoryOrders(order),
    reviews,
    ids: services,
    clock: services,
    transactions: services,
  });

  const review = await handler.execute({
    orderId: "order-1",
    authorId: "customer-1",
    score: 5,
    text: "Работа выполнена качественно и в срок.",
  });

  assert.equal(review.subjectId, "contractor-1");
  await assert.rejects(
    handler.execute({
      orderId: "order-1",
      authorId: "customer-1",
      score: 4,
      text: "Повторный отзыв к тому же заказу.",
    }),
    (error: unknown) => error instanceof DomainError && error.code === "REVIEW_ALREADY_EXISTS",
  );
});

test("SubmitReview rejects reviews before completion", async () => {
  const services = new FixedServices();
  const handler = new SubmitReviewHandler({
    orders: new MemoryOrders(inProgressOrder()),
    reviews: new MemoryReviews(),
    ids: services,
    clock: services,
    transactions: services,
  });

  await assert.rejects(
    handler.execute({
      orderId: "order-1",
      authorId: "customer-1",
      score: 5,
      text: "Заказ пока ещё не завершён.",
    }),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_NOT_COMPLETED",
  );
});

test("Public reputation handlers expose the profile and paginated reviews", async () => {
  const reads: ReputationReadRepository = {
    listContractors: async (search) => ({ items: [], total: 0, limit: search.limit, offset: search.offset }),
    findContractorProfile: async (id) => id === "contractor-1" ? {
      id,
      displayName: "Бригада Мастер",
      bio: "Строим дома под ключ.",
      avatarAttachmentId: null,
      specializationIds: ["category-1"],
      specializations: [{ id: "category-1", name: "Строительство домов" }],
      serviceLocationIds: ["location-1"],
      serviceLocations: [{
        id: "location-1",
        name: "Москва",
        kind: "locality",
        regionId: "region-1",
        regionName: "Москва",
      }],
      portfolio: [],
      memberSince: new Date("2026-01-01T10:00:00.000Z"),
      ratingAverage: 4.5,
      reviewCount: 2,
      completedOrderCount: 3,
    } : null,
    listPublishedReviews: async (_id, pagination) => ({ items: [], total: 0, ...pagination }),
  };

  const profile = await new GetContractorProfileHandler(reads).execute("contractor-1");
  const page = await new ListContractorReviewsHandler(reads).execute(
    "contractor-1",
    { limit: 10, offset: 20 },
  );

  assert.equal(profile.ratingAverage, 4.5);
  assert.deepEqual(page, { items: [], total: 0, limit: 10, offset: 20 });
  await assert.rejects(
    new GetContractorProfileHandler(reads).execute("missing"),
    (error: unknown) => error instanceof DomainError && error.code === "CONTRACTOR_NOT_FOUND",
  );
});

test("contractor search normalizes filters and validates rating", async () => {
  let received: Parameters<ReputationReadRepository["listContractors"]>[0] | null = null;
  const reads: ReputationReadRepository = {
    listContractors: async (search) => {
      received = search;
      return { items: [], total: 0, limit: search.limit, offset: search.offset };
    },
    findContractorProfile: async () => null,
    listPublishedReviews: async (_id, pagination) => ({ items: [], total: 0, ...pagination }),
  };
  const handler = new ListContractorsHandler(reads);

  await handler.execute({
    query: "  строительство домов  ",
    specializationId: "house-building",
    regionId: "ru-region-43",
    minRating: 4,
    limit: 10,
    offset: 0,
  });
  assert.deepEqual(received, {
    query: "строительство домов",
    specializationId: "house-building",
    regionId: "ru-region-43",
    minRating: 4,
    sort: "relevance",
    limit: 10,
    offset: 0,
  });
  assert.throws(
    () => handler.execute({ minRating: 6, limit: 10, offset: 0 }),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_RATING_FILTER",
  );
});
