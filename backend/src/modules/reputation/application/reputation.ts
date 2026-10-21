import { assertDomain } from "../../../shared/domain/domain-error.ts";
import type {
  Clock,
  IdGenerator,
  OrderRepository,
  TransactionManager,
} from "../../marketplace/application/ports/guest-order-ports.ts";
import { Review } from "../domain/review.ts";
import type {
  PublicContractorProfile,
  PublicContractorPage,
  PublicContractorSearch,
  PublicContractorSort,
  PublicReviewPage,
  ReputationReadRepository,
  ReviewRepository,
} from "./ports/reputation-ports.ts";

export type SubmitReviewCommand = Readonly<{
  orderId: string;
  authorId: string;
  score: number;
  text: string;
}>;

export type ReviewView = Readonly<{
  id: string;
  orderId: string;
  authorId: string;
  subjectId: string;
  score: number;
  text: string;
  status: string;
  createdAt: Date;
}>;

function reviewView(review: Review): ReviewView {
  return review.toSnapshot();
}

export type OrderDealView = Readonly<{
  orderId: string; title: string; status: string; customerId: string; contractorId: string | null;
  selectedBidId: string | null; completedAt: Date | null; ownReview: ReviewView | null;
}>;

export class GetOrderDealHandler {
  readonly #d: Readonly<{ orders: OrderRepository; reviews: ReviewRepository; transactions: TransactionManager }>;
  constructor(dependencies: Readonly<{ orders: OrderRepository; reviews: ReviewRepository; transactions: TransactionManager }>) { this.#d = dependencies; }
  execute(accountId: string, orderId: string): Promise<OrderDealView> {
    return this.#d.transactions.execute(async () => {
      const order = await this.#d.orders.findById(orderId, { forUpdate: true });
      assertDomain(order !== null && order.isParticipant(accountId), "ORDER_NOT_FOUND", "Order was not found");
      const ownReview = await this.#d.reviews.findByOrderAndAuthor(order.id, accountId);
      const snapshot = order.toSnapshot();
      return { orderId: order.id, title: snapshot.title, status: order.status, customerId: order.customerId,
        contractorId: snapshot.contractorId, selectedBidId: snapshot.selectedBidId, completedAt: snapshot.completedAt,
        ownReview: ownReview ? reviewView(ownReview) : null };
    });
  }
}

export class SubmitReviewHandler {
  readonly #orders: OrderRepository;
  readonly #reviews: ReviewRepository;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;
  readonly #transactions: TransactionManager;

  constructor(dependencies: Readonly<{
    orders: OrderRepository;
    reviews: ReviewRepository;
    ids: IdGenerator;
    clock: Clock;
    transactions: TransactionManager;
  }>) {
    this.#orders = dependencies.orders;
    this.#reviews = dependencies.reviews;
    this.#ids = dependencies.ids;
    this.#clock = dependencies.clock;
    this.#transactions = dependencies.transactions;
  }

  execute(command: SubmitReviewCommand): Promise<ReviewView> {
    return this.#transactions.execute(async () => {
      const order = await this.#orders.findById(command.orderId, { forUpdate: true });
      assertDomain(
        order !== null && order.isParticipant(command.authorId),
        "ORDER_NOT_FOUND",
        "Order was not found",
      );
      assertDomain(order.status === "completed", "ORDER_NOT_COMPLETED", "Reviews require a completed order");

      const existing = await this.#reviews.findByOrderAndAuthor(order.id, command.authorId);
      assertDomain(existing === null, "REVIEW_ALREADY_EXISTS", "A review for this order already exists");

      const subjectId = command.authorId === order.customerId ? order.contractorId : order.customerId;
      assertDomain(subjectId !== null, "ORDER_NOT_COMPLETED", "Completed order has no contractor");
      const review = Review.create({
        id: this.#ids.next(),
        order,
        authorId: command.authorId,
        subjectId,
        score: command.score,
        text: command.text,
        createdAt: this.#clock.now(),
      });
      await this.#reviews.save(review);
      return reviewView(review);
    });
  }
}

export class GetContractorProfileHandler {
  readonly #reads: ReputationReadRepository;

  constructor(reads: ReputationReadRepository) {
    this.#reads = reads;
  }

  async execute(contractorId: string): Promise<PublicContractorProfile> {
    const profile = await this.#reads.findContractorProfile(contractorId);
    assertDomain(profile !== null, "CONTRACTOR_NOT_FOUND", "Contractor was not found");
    return profile;
  }
}

export class ListContractorsHandler {
  readonly #reads: ReputationReadRepository;

  constructor(reads: ReputationReadRepository) {
    this.#reads = reads;
  }

  execute(input: Readonly<{
    query?: string;
    specializationId?: string;
    regionId?: string;
    locationId?: string;
    minRating?: number;
    sort?: PublicContractorSort;
    limit: number;
    offset: number;
  }>): Promise<PublicContractorPage> {
    const query = input.query?.trim();
    assertDomain(
      query === undefined || query.length >= 2,
      "SEARCH_QUERY_TOO_SHORT",
      "Search query must contain at least two characters",
    );
    assertDomain(
      input.minRating === undefined
        || (Number.isFinite(input.minRating) && input.minRating >= 1 && input.minRating <= 5),
      "INVALID_RATING_FILTER",
      "Minimum rating must be between 1 and 5",
    );
    assertDomain(
      Number.isSafeInteger(input.limit) && input.limit >= 1 && input.limit <= 100
        && Number.isSafeInteger(input.offset) && input.offset >= 0,
      "INVALID_PAGINATION",
      "Pagination is invalid",
    );
    const search: PublicContractorSearch = {
      sort: input.sort ?? (query ? "relevance" : "rating"),
      limit: input.limit,
      offset: input.offset,
      ...(query ? { query } : {}),
      ...(input.specializationId ? { specializationId: input.specializationId } : {}),
      ...(input.regionId ? { regionId: input.regionId } : {}),
      ...(input.locationId ? { locationId: input.locationId } : {}),
      ...(input.minRating !== undefined ? { minRating: input.minRating } : {}),
    };
    return this.#reads.listContractors(search);
  }
}

export class ListContractorReviewsHandler {
  readonly #reads: ReputationReadRepository;

  constructor(reads: ReputationReadRepository) {
    this.#reads = reads;
  }

  async execute(
    contractorId: string,
    pagination: Readonly<{ limit: number; offset: number }>,
  ): Promise<PublicReviewPage> {
    const profile = await this.#reads.findContractorProfile(contractorId);
    assertDomain(profile !== null, "CONTRACTOR_NOT_FOUND", "Contractor was not found");
    return this.#reads.listPublishedReviews(contractorId, pagination);
  }
}
