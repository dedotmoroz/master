import { AggregateRoot } from "../../../shared/domain/domain-event.ts";
import { assertDomain } from "../../../shared/domain/domain-error.ts";
import { Money, MoneyRange, assertEntityId, assertNonBlank } from "../../../shared/domain/value-objects.ts";
import type { Bid } from "./bid.ts";

export type OrderStatus = "draft" | "published" | "in_progress" | "completed" | "cancelled";

export type CreateOrder = Readonly<{
  id: string;
  customerId: string;
  categoryId: string;
  locationId: string;
  title: string;
  description: string;
  budget: MoneyRange;
  attachmentIds: readonly string[];
  createdAt: Date;
}>;

export type OrderDetails = Pick<CreateOrder, "categoryId" | "locationId" | "title" | "description" | "budget" | "attachmentIds">;

function normalizeDetails(input: OrderDetails): OrderDetails {
  const attachmentIds = input.attachmentIds.map((id) => assertEntityId(id, "attachmentId"));
  assertDomain(attachmentIds.length <= 10, "TOO_MANY_ATTACHMENTS", "An order supports at most ten attachments");
  assertDomain(new Set(attachmentIds).size === attachmentIds.length, "DUPLICATE_ATTACHMENTS", "Attachment is used more than once");
  return {
    categoryId: assertEntityId(input.categoryId, "categoryId"),
    locationId: assertEntityId(input.locationId, "locationId"),
    title: assertNonBlank(input.title, "title", 160),
    description: assertNonBlank(input.description, "description", 10_000),
    budget: input.budget,
    attachmentIds: Object.freeze(attachmentIds),
  };
}

export type OrderSnapshot = Readonly<{
  id: string;
  customerId: string;
  categoryId: string;
  locationId: string;
  title: string;
  description: string;
  budgetMinMinor: number | null;
  budgetMaxMinor: number | null;
  budgetCurrency: string;
  attachmentIds: readonly string[];
  status: OrderStatus;
  selectedBidId: string | null;
  contractorId: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  completedAt: Date | null;
}>;

export class Order extends AggregateRoot {
  readonly id: string;
  readonly customerId: string;
  #details: OrderDetails;
  readonly createdAt: Date;
  #status: OrderStatus;
  #selectedBidId: string | null = null;
  #contractorId: string | null = null;
  #publishedAt: Date | null = null;
  #completedAt: Date | null = null;

  private constructor(input: CreateOrder, status: OrderStatus) {
    super();
    this.id = assertEntityId(input.id, "orderId");
    this.customerId = assertEntityId(input.customerId, "customerId");
    this.#details = normalizeDetails(input);
    this.createdAt = new Date(input.createdAt);
    this.#status = status;
  }

  static createDraft(input: CreateOrder): Order {
    return new Order(input, "draft");
  }

  static createPublished(input: CreateOrder, occurredAt: Date): Order {
    const order = new Order(input, "published");
    order.#publishedAt = new Date(occurredAt);
    order.record({
      name: "OrderPublished",
      aggregateId: order.id,
      occurredAt,
      payload: { customerId: order.customerId, categoryId: order.categoryId },
    });
    return order;
  }

  static restore(snapshot: OrderSnapshot): Order {
    const order = new Order(
      {
        id: snapshot.id,
        customerId: snapshot.customerId,
        categoryId: snapshot.categoryId,
        locationId: snapshot.locationId,
        title: snapshot.title,
        description: snapshot.description,
        budget: MoneyRange.create(
          snapshot.budgetMinMinor === null
            ? null
            : Money.fromMinor(snapshot.budgetMinMinor, snapshot.budgetCurrency),
          snapshot.budgetMaxMinor === null
            ? null
            : Money.fromMinor(snapshot.budgetMaxMinor, snapshot.budgetCurrency),
        ),
        attachmentIds: snapshot.attachmentIds,
        createdAt: snapshot.createdAt,
      },
      snapshot.status,
    );
    order.#selectedBidId = snapshot.selectedBidId;
    order.#contractorId = snapshot.contractorId;
    order.#publishedAt = snapshot.publishedAt ? new Date(snapshot.publishedAt) : null;
    order.#completedAt = snapshot.completedAt ? new Date(snapshot.completedAt) : null;
    return order;
  }

  get categoryId(): string { return this.#details.categoryId; }
  get locationId(): string { return this.#details.locationId; }
  get title(): string { return this.#details.title; }
  get description(): string { return this.#details.description; }
  get budget(): MoneyRange { return this.#details.budget; }
  get attachmentIds(): readonly string[] { return this.#details.attachmentIds; }

  update(actorId: string, details: OrderDetails, occurredAt: Date): void {
    this.assertOwner(actorId);
    assertDomain(this.#status === "draft" || this.#status === "published",
      "ORDER_NOT_EDITABLE", "Only a draft or published order can be edited");
    const next = normalizeDetails(details);
    const comparable = (value: OrderDetails) => JSON.stringify([
      value.categoryId, value.locationId, value.title, value.description,
      value.budget.min?.minor ?? null, value.budget.max?.minor ?? null,
      value.budget.min?.currency ?? value.budget.max?.currency ?? "RUB", value.attachmentIds,
    ]);
    if (comparable(this.#details) === comparable(next)) return;
    this.#details = next;
    this.record({ name: "OrderUpdated", aggregateId: this.id, occurredAt, payload: { customerId: this.customerId } });
  }

  get status(): OrderStatus {
    return this.#status;
  }

  get selectedBidId(): string | null {
    return this.#selectedBidId;
  }

  get contractorId(): string | null {
    return this.#contractorId;
  }

  publish(actorId: string, occurredAt: Date): void {
    this.assertOwner(actorId);
    assertDomain(this.#status === "draft", "ORDER_NOT_PUBLISHABLE", "Only a draft order can be published");
    this.#status = "published";
    this.#publishedAt = new Date(occurredAt);
    this.record({
      name: "OrderPublished",
      aggregateId: this.id,
      occurredAt,
      payload: { customerId: this.customerId, categoryId: this.categoryId },
    });
  }

  selectBid(actorId: string, bid: Bid, occurredAt: Date): void {
    this.assertOwner(actorId);
    assertDomain(this.#status === "published", "ORDER_NOT_ACCEPTING_SELECTION", "Order is not open for bid selection");
    assertDomain(bid.orderId === this.id, "BID_ORDER_MISMATCH", "Bid belongs to another order");
    assertDomain(bid.contractorId !== this.customerId, "SELF_ASSIGNMENT", "Customer cannot be their own contractor");
    bid.select(occurredAt);
    this.#selectedBidId = bid.id;
    this.#contractorId = bid.contractorId;
    this.#status = "in_progress";
    this.record({
      name: "ContractorAssigned",
      aggregateId: this.id,
      occurredAt,
      payload: { bidId: bid.id, contractorId: bid.contractorId },
    });
  }

  complete(actorId: string, occurredAt: Date): void {
    this.assertParticipant(actorId);
    if (this.#status === "completed") return;
    assertDomain(this.#status === "in_progress", "ORDER_NOT_COMPLETABLE", "Only an in-progress order can be completed");
    this.#status = "completed";
    this.#completedAt = new Date(occurredAt);
    this.record({
      name: "OrderCompleted",
      aggregateId: this.id,
      occurredAt,
      payload: { customerId: this.customerId, contractorId: this.#contractorId as string },
    });
  }

  cancel(actorId: string, occurredAt: Date): void {
    this.assertOwner(actorId);
    if (this.#status === "cancelled") return;
    assertDomain(
      this.#status === "draft" || this.#status === "published",
      "ORDER_NOT_CANCELLABLE",
      "An in-progress or completed order cannot be cancelled directly",
    );
    this.#status = "cancelled";
    this.record({
      name: "OrderCancelled",
      aggregateId: this.id,
      occurredAt,
      payload: {},
    });
  }

  isParticipant(accountId: string): boolean {
    return accountId === this.customerId || accountId === this.#contractorId;
  }

  toSnapshot(): OrderSnapshot {
    const currency = this.budget.min?.currency ?? this.budget.max?.currency ?? "RUB";
    return {
      id: this.id,
      customerId: this.customerId,
      categoryId: this.categoryId,
      locationId: this.locationId,
      title: this.title,
      description: this.description,
      budgetMinMinor: this.budget.min?.minor ?? null,
      budgetMaxMinor: this.budget.max?.minor ?? null,
      budgetCurrency: currency,
      attachmentIds: this.attachmentIds,
      status: this.#status,
      selectedBidId: this.#selectedBidId,
      contractorId: this.#contractorId,
      createdAt: new Date(this.createdAt),
      publishedAt: this.#publishedAt ? new Date(this.#publishedAt) : null,
      completedAt: this.#completedAt ? new Date(this.#completedAt) : null,
    };
  }

  private assertOwner(actorId: string): void {
    assertDomain(actorId === this.customerId, "ORDER_FORBIDDEN", "Only the customer can perform this action");
  }

  private assertParticipant(actorId: string): void {
    assertDomain(this.isParticipant(actorId), "ORDER_FORBIDDEN", "Only an order participant can perform this action");
  }
}
