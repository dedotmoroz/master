import { assertDomain } from "../../../../shared/domain/domain-error.ts";
import { Money, MoneyRange } from "../../../../shared/domain/value-objects.ts";
import type { AttachmentUsagePolicy } from "../../../attachments/application/ports/attachment-ports.ts";
import type { WorkCategorySelectionPolicy } from "../../../catalog/application/ports/work-category-ports.ts";
import type { RussianLocationSelectionPolicy } from "../../../geography/application/ports/russian-location-ports.ts";
import type { BidRepository } from "../ports/bid-ports.ts";
import type { Clock, OrderRepository, TransactionManager } from "../ports/guest-order-ports.ts";
import type {
  CustomerOrderPage,
  CustomerOrderReadRepository,
} from "../ports/customer-order-ports.ts";

export type CustomerOrderView = Readonly<{
  id: string;
  customerId: string;
  categoryId: string;
  locationId: string;
  title: string;
  description: string;
  budget: Readonly<{
    minMinor: number | null;
    maxMinor: number | null;
    currency: string;
  }>;
  attachmentIds: readonly string[];
  status: string;
  selectedBidId: string | null;
  contractorId: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  completedAt: Date | null;
}>;

function orderView(order: NonNullable<Awaited<ReturnType<OrderRepository["findById"]>>>): CustomerOrderView {
  const snapshot = order.toSnapshot();
  return {
    id: snapshot.id,
    customerId: snapshot.customerId,
    categoryId: snapshot.categoryId,
    locationId: snapshot.locationId,
    title: snapshot.title,
    description: snapshot.description,
    budget: {
      minMinor: snapshot.budgetMinMinor,
      maxMinor: snapshot.budgetMaxMinor,
      currency: snapshot.budgetCurrency,
    },
    attachmentIds: snapshot.attachmentIds,
    status: snapshot.status,
    selectedBidId: snapshot.selectedBidId,
    contractorId: snapshot.contractorId,
    createdAt: snapshot.createdAt,
    publishedAt: snapshot.publishedAt,
    completedAt: snapshot.completedAt,
  };
}

export class ListCustomerOrdersHandler {
  readonly #orders: CustomerOrderReadRepository;

  constructor(orders: CustomerOrderReadRepository) {
    this.#orders = orders;
  }

  execute(
    accountId: string,
    pagination: Readonly<{ limit: number; offset: number }>,
  ): Promise<CustomerOrderPage> {
    return this.#orders.listByCustomer(accountId, pagination);
  }
}

export class GetCustomerOrderHandler {
  readonly #orders: OrderRepository;

  constructor(orders: OrderRepository) {
    this.#orders = orders;
  }

  async execute(accountId: string, orderId: string): Promise<CustomerOrderView> {
    const order = await this.#orders.findById(orderId);
    assertDomain(
      order !== null && order.customerId === accountId,
      "ORDER_NOT_FOUND",
      "Order was not found",
    );
    return orderView(order);
  }
}

export class CancelCustomerOrderHandler {
  readonly #orders: OrderRepository;
  readonly #bids: BidRepository;
  readonly #clock: Clock;
  readonly #transactions: TransactionManager;

  constructor(dependencies: Readonly<{
    orders: OrderRepository;
    bids: BidRepository;
    clock: Clock;
    transactions: TransactionManager;
  }>) {
    this.#orders = dependencies.orders;
    this.#bids = dependencies.bids;
    this.#clock = dependencies.clock;
    this.#transactions = dependencies.transactions;
  }

  execute(accountId: string, orderId: string): Promise<CustomerOrderView> {
    return this.#transactions.execute(async () => {
      const order = await this.#orders.findById(orderId, { forUpdate: true });
      assertDomain(
        order !== null && order.customerId === accountId,
        "ORDER_NOT_FOUND",
        "Order was not found",
      );
      const now = this.#clock.now();
      order.cancel(accountId, now);
      const submittedBids = await this.#bids.findSubmittedByOrder(order.id, { forUpdate: true });
      for (const bid of submittedBids) {
        bid.cancelForOrder(now);
        await this.#bids.save(bid);
      }
      await this.#orders.save(order);
      return orderView(order);
    });
  }
}

export type UpdateCustomerOrderCommand = Readonly<{
  accountId: string;
  orderId: string;
  categoryId: string;
  locationId: string;
  title: string;
  description: string;
  budgetMinMinor: number | null;
  budgetMaxMinor: number | null;
  attachmentIds: readonly string[];
}>;

type UpdateCustomerOrderDependencies = Readonly<{
  orders: OrderRepository;
  categories: WorkCategorySelectionPolicy;
  locations: RussianLocationSelectionPolicy;
  attachments: AttachmentUsagePolicy;
  clock: Clock;
  transactions: TransactionManager;
}>;

export class UpdateCustomerOrderHandler {
  readonly #dependencies: UpdateCustomerOrderDependencies;
  constructor(dependencies: UpdateCustomerOrderDependencies) { this.#dependencies = dependencies; }

  execute(command: UpdateCustomerOrderCommand): Promise<CustomerOrderView> {
    return this.#dependencies.transactions.execute(async () => {
      const order = await this.#dependencies.orders.findById(command.orderId, { forUpdate: true });
      assertDomain(order !== null && order.customerId === command.accountId, "ORDER_NOT_FOUND", "Order was not found");
      assertDomain(order.status === "draft" || order.status === "published", "ORDER_NOT_EDITABLE", "Order can no longer be edited");
      await this.#dependencies.categories.assertSelectable([command.categoryId]);
      await this.#dependencies.locations.assertSelectable([command.locationId]);
      await this.#dependencies.attachments.assertUsable(command.accountId, command.attachmentIds, "order");
      order.update(command.accountId, {
        categoryId: command.categoryId, locationId: command.locationId,
        title: command.title, description: command.description,
        budget: MoneyRange.create(
          command.budgetMinMinor === null ? null : Money.fromMinor(command.budgetMinMinor),
          command.budgetMaxMinor === null ? null : Money.fromMinor(command.budgetMaxMinor),
        ),
        attachmentIds: command.attachmentIds,
      }, this.#dependencies.clock.now());
      await this.#dependencies.orders.save(order);
      return orderView(order);
    });
  }
}
