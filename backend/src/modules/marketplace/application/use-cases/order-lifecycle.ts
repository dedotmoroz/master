import { assertDomain } from "../../../../shared/domain/domain-error.ts";
import type { Clock, OrderRepository, TransactionManager } from "../ports/guest-order-ports.ts";

export type CompletedOrderView = Readonly<{
  orderId: string;
  status: "completed";
  customerId: string;
  contractorId: string;
  completedAt: Date;
}>;

export class CompleteOrderHandler {
  readonly #orders: OrderRepository;
  readonly #clock: Clock;
  readonly #transactions: TransactionManager;

  constructor(dependencies: Readonly<{
    orders: OrderRepository;
    clock: Clock;
    transactions: TransactionManager;
  }>) {
    this.#orders = dependencies.orders;
    this.#clock = dependencies.clock;
    this.#transactions = dependencies.transactions;
  }

  execute(accountId: string, orderId: string): Promise<CompletedOrderView> {
    return this.#transactions.execute(async () => {
      const order = await this.#orders.findById(orderId, { forUpdate: true });
      assertDomain(
        order !== null && order.isParticipant(accountId),
        "ORDER_NOT_FOUND",
        "Order was not found",
      );
      order.complete(accountId, this.#clock.now());
      await this.#orders.save(order);
      const snapshot = order.toSnapshot();
      assertDomain(
        snapshot.contractorId !== null && snapshot.completedAt !== null,
        "ORDER_NOT_COMPLETABLE",
        "Order completion data is incomplete",
      );
      return {
        orderId: snapshot.id,
        status: "completed",
        customerId: snapshot.customerId,
        contractorId: snapshot.contractorId,
        completedAt: snapshot.completedAt,
      };
    });
  }
}
