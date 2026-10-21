import { assertDomain } from "../../../../shared/domain/domain-error.ts";
import { Money, MoneyRange } from "../../../../shared/domain/value-objects.ts";
import { Bid, type BidVisibility } from "../../domain/bid.ts";
import type {
  BidRepository,
  MarketplaceReadRepository,
  Page,
  PublicOrderListItem,
  PublicOrderSearch,
  PublicOrderSort,
  PublicOrderView,
  BidListItem,
} from "../ports/bid-ports.ts";
import type {
  AccountRepository,
  Clock,
  IdGenerator,
  OrderRepository,
  TransactionManager,
} from "../ports/guest-order-ports.ts";

export type SubmitBidCommand = Readonly<{
  orderId: string;
  contractorId: string;
  message: string;
  priceMinMinor: number | null;
  priceMaxMinor: number | null;
  durationDaysMin: number | null;
  durationDaysMax: number | null;
  visibility: BidVisibility;
}>;

export type BidView = Readonly<{
  id: string;
  orderId: string;
  contractorId: string;
  message: string;
  price: Readonly<{
    minMinor: number | null;
    maxMinor: number | null;
    currency: string;
  }>;
  durationDaysMin: number | null;
  durationDaysMax: number | null;
  visibility: BidVisibility;
  status: string;
  submittedAt: Date;
  decidedAt: Date | null;
}>;

function bidView(bid: Bid): BidView {
  const snapshot = bid.toSnapshot();
  return {
    id: snapshot.id,
    orderId: snapshot.orderId,
    contractorId: snapshot.contractorId,
    message: snapshot.message,
    price: {
      minMinor: snapshot.priceMinMinor,
      maxMinor: snapshot.priceMaxMinor,
      currency: snapshot.priceCurrency,
    },
    durationDaysMin: snapshot.durationDaysMin,
    durationDaysMax: snapshot.durationDaysMax,
    visibility: snapshot.visibility,
    status: snapshot.status,
    submittedAt: snapshot.submittedAt,
    decidedAt: snapshot.decidedAt,
  };
}

export class ListPublicOrdersHandler {
  readonly #reads: MarketplaceReadRepository;

  constructor(reads: MarketplaceReadRepository) {
    this.#reads = reads;
  }

  execute(input: Readonly<{
    query?: string;
    categoryId?: string;
    regionId?: string;
    locationId?: string;
    budgetMinMinor?: number;
    budgetMaxMinor?: number;
    sort?: PublicOrderSort;
    limit: number;
    offset: number;
  }>): Promise<Page<PublicOrderListItem>> {
    const query = input.query?.trim();
    assertDomain(
      query === undefined || query.length >= 2,
      "SEARCH_QUERY_TOO_SHORT",
      "Search query must contain at least two characters",
    );
    assertDomain(
      input.budgetMinMinor === undefined || (Number.isSafeInteger(input.budgetMinMinor) && input.budgetMinMinor >= 0),
      "INVALID_BUDGET_FILTER",
      "Minimum budget filter is invalid",
    );
    assertDomain(
      input.budgetMaxMinor === undefined || (Number.isSafeInteger(input.budgetMaxMinor) && input.budgetMaxMinor >= 0),
      "INVALID_BUDGET_FILTER",
      "Maximum budget filter is invalid",
    );
    assertDomain(
      input.budgetMinMinor === undefined
        || input.budgetMaxMinor === undefined
        || input.budgetMinMinor <= input.budgetMaxMinor,
      "INVALID_BUDGET_FILTER",
      "Minimum budget filter cannot exceed maximum budget filter",
    );
    assertDomain(
      Number.isSafeInteger(input.limit) && input.limit >= 1 && input.limit <= 100
        && Number.isSafeInteger(input.offset) && input.offset >= 0,
      "INVALID_PAGINATION",
      "Pagination is invalid",
    );
    const search: PublicOrderSearch = {
      sort: input.sort ?? (query ? "relevance" : "newest"),
      limit: input.limit,
      offset: input.offset,
      ...(query ? { query } : {}),
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(input.regionId ? { regionId: input.regionId } : {}),
      ...(input.locationId ? { locationId: input.locationId } : {}),
      ...(input.budgetMinMinor !== undefined ? { budgetMinMinor: input.budgetMinMinor } : {}),
      ...(input.budgetMaxMinor !== undefined ? { budgetMaxMinor: input.budgetMaxMinor } : {}),
    };
    return this.#reads.listPublishedOrders(search);
  }
}

export class GetPublicOrderHandler {
  readonly #reads: MarketplaceReadRepository;

  constructor(reads: MarketplaceReadRepository) {
    this.#reads = reads;
  }

  async execute(orderId: string): Promise<PublicOrderView> {
    const order = await this.#reads.findPublishedOrder(orderId);
    assertDomain(order !== null, "ORDER_NOT_FOUND", "Order was not found");
    return order;
  }
}

export class SubmitBidHandler {
  readonly #orders: OrderRepository;
  readonly #bids: BidRepository;
  readonly #accounts: AccountRepository;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;
  readonly #transactions: TransactionManager;

  constructor(dependencies: Readonly<{
    orders: OrderRepository;
    bids: BidRepository;
    accounts: AccountRepository;
    ids: IdGenerator;
    clock: Clock;
    transactions: TransactionManager;
  }>) {
    this.#orders = dependencies.orders;
    this.#bids = dependencies.bids;
    this.#accounts = dependencies.accounts;
    this.#ids = dependencies.ids;
    this.#clock = dependencies.clock;
    this.#transactions = dependencies.transactions;
  }

  execute(command: SubmitBidCommand): Promise<BidView> {
    return this.#transactions.execute(async () => {
      const order = await this.#orders.findById(command.orderId, { forUpdate: true });
      assertDomain(order !== null, "ORDER_NOT_FOUND", "Order was not found");
      const account = await this.#accounts.findById(command.contractorId, { forUpdate: true });
      assertDomain(account !== null && account.status === "active", "ACCOUNT_NOT_ACTIVE", "Account is not active");
      const existing = await this.#bids.findActiveByOrderAndContractor(order.id, account.id);
      assertDomain(existing === null, "BID_ALREADY_EXISTS", "An active bid already exists for this order");

      const now = this.#clock.now();
      const bid = Bid.submit(
        {
          id: this.#ids.next(),
          contractorId: account.id,
          message: command.message,
          price: MoneyRange.create(
            command.priceMinMinor === null ? null : Money.fromMinor(command.priceMinMinor),
            command.priceMaxMinor === null ? null : Money.fromMinor(command.priceMaxMinor),
          ),
          durationDaysMin: command.durationDaysMin,
          durationDaysMax: command.durationDaysMax,
          visibility: command.visibility,
          submittedAt: now,
        },
        order,
      );
      account.grantCapability("contractor", now);
      await this.#accounts.save(account);
      await this.#bids.save(bid);
      return bidView(bid);
    });
  }
}

export class WithdrawBidHandler {
  readonly #bids: BidRepository;
  readonly #clock: Clock;
  readonly #transactions: TransactionManager;

  constructor(dependencies: Readonly<{
    bids: BidRepository;
    clock: Clock;
    transactions: TransactionManager;
  }>) {
    this.#bids = dependencies.bids;
    this.#clock = dependencies.clock;
    this.#transactions = dependencies.transactions;
  }

  execute(contractorId: string, bidId: string): Promise<BidView> {
    return this.#transactions.execute(async () => {
      const bid = await this.#bids.findById(bidId, { forUpdate: true });
      assertDomain(
        bid !== null && bid.contractorId === contractorId,
        "BID_NOT_FOUND",
        "Bid was not found",
      );
      bid.withdraw(contractorId, this.#clock.now());
      await this.#bids.save(bid);
      return bidView(bid);
    });
  }
}

export class ListContractorBidsHandler {
  readonly #reads: MarketplaceReadRepository;

  constructor(reads: MarketplaceReadRepository) {
    this.#reads = reads;
  }

  execute(
    contractorId: string,
    pagination: Readonly<{ limit: number; offset: number }>,
  ): Promise<Page<BidListItem>> {
    return this.#reads.listContractorBids(contractorId, pagination);
  }
}

export class ListOrderBidsHandler {
  readonly #orders: OrderRepository;
  readonly #reads: MarketplaceReadRepository;

  constructor(orders: OrderRepository, reads: MarketplaceReadRepository) {
    this.#orders = orders;
    this.#reads = reads;
  }

  async execute(
    customerId: string,
    orderId: string,
    pagination: Readonly<{ limit: number; offset: number }>,
  ): Promise<Page<BidListItem>> {
    const order = await this.#orders.findById(orderId);
    assertDomain(
      order !== null && order.customerId === customerId,
      "ORDER_NOT_FOUND",
      "Order was not found",
    );
    return this.#reads.listOrderBids(orderId, pagination);
  }
}

export type SelectBidResult = Readonly<{
  orderId: string;
  bidId: string;
  contractorId: string;
  orderStatus: "in_progress";
}>;

export class SelectBidHandler {
  readonly #orders: OrderRepository;
  readonly #bids: BidRepository;
  readonly #accounts: AccountRepository;
  readonly #clock: Clock;
  readonly #transactions: TransactionManager;

  constructor(dependencies: Readonly<{
    orders: OrderRepository;
    bids: BidRepository;
    accounts: AccountRepository;
    clock: Clock;
    transactions: TransactionManager;
  }>) {
    this.#orders = dependencies.orders;
    this.#bids = dependencies.bids;
    this.#accounts = dependencies.accounts;
    this.#clock = dependencies.clock;
    this.#transactions = dependencies.transactions;
  }

  execute(customerId: string, orderId: string, bidId: string): Promise<SelectBidResult> {
    return this.#transactions.execute(async () => {
      const order = await this.#orders.findById(orderId, { forUpdate: true });
      assertDomain(
        order !== null && order.customerId === customerId,
        "ORDER_NOT_FOUND",
        "Order was not found",
      );

      if (order.status === "in_progress" && order.selectedBidId === bidId) {
        const selected = await this.#bids.findById(bidId);
        assertDomain(selected !== null, "BID_NOT_FOUND", "Bid was not found");
        return {
          orderId: order.id,
          bidId: selected.id,
          contractorId: selected.contractorId,
          orderStatus: "in_progress",
        };
      }

      const submitted = await this.#bids.findSubmittedByOrder(order.id, { forUpdate: true });
      const selected = submitted.find((bid) => bid.id === bidId);
      assertDomain(selected !== undefined, "BID_NOT_FOUND", "Bid was not found");
      for (const id of [customerId, selected.contractorId].sort()) {
        const account = await this.#accounts.findById(id, { forUpdate: true });
        assertDomain(account !== null && account.status === "active", "ACCOUNT_NOT_ACTIVE", "Order participants must be active");
      }
      const now = this.#clock.now();
      order.selectBid(customerId, selected, now);
      for (const bid of submitted) {
        if (bid.id !== selected.id) bid.reject(now);
        await this.#bids.save(bid);
      }
      await this.#orders.save(order);
      return {
        orderId: order.id,
        bidId: selected.id,
        contractorId: selected.contractorId,
        orderStatus: "in_progress",
      };
    });
  }
}
