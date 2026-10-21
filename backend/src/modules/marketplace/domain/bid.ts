import { AggregateRoot } from "../../../shared/domain/domain-event.ts";
import { assertDomain } from "../../../shared/domain/domain-error.ts";
import { Money, MoneyRange, assertEntityId, assertNonBlank } from "../../../shared/domain/value-objects.ts";
import type { Order } from "./order.ts";

export type BidStatus = "submitted" | "selected" | "rejected" | "withdrawn" | "cancelled";
export type BidVisibility = "public" | "private";

export type SubmitBid = Readonly<{
  id: string;
  contractorId: string;
  message: string;
  price: MoneyRange;
  durationDaysMin: number | null;
  durationDaysMax: number | null;
  visibility: BidVisibility;
  submittedAt: Date;
}>;

export type BidSnapshot = Readonly<{
  id: string;
  orderId: string;
  contractorId: string;
  message: string;
  priceMinMinor: number | null;
  priceMaxMinor: number | null;
  priceCurrency: string;
  durationDaysMin: number | null;
  durationDaysMax: number | null;
  visibility: BidVisibility;
  status: BidStatus;
  submittedAt: Date;
  decidedAt: Date | null;
}>;

export class Bid extends AggregateRoot {
  readonly id: string;
  readonly orderId: string;
  readonly contractorId: string;
  readonly message: string;
  readonly price: MoneyRange;
  readonly durationDaysMin: number | null;
  readonly durationDaysMax: number | null;
  readonly visibility: BidVisibility;
  readonly submittedAt: Date;
  #status: BidStatus = "submitted";
  #decidedAt: Date | null = null;

  private constructor(input: SubmitBid, orderId: string) {
    super();
    this.id = assertEntityId(input.id, "bidId");
    this.orderId = assertEntityId(orderId, "orderId");
    this.contractorId = assertEntityId(input.contractorId, "contractorId");
    this.message = assertNonBlank(input.message, "message", 5_000);
    this.price = input.price;
    this.visibility = input.visibility;
    this.submittedAt = new Date(input.submittedAt);
    this.durationDaysMin = input.durationDaysMin;
    this.durationDaysMax = input.durationDaysMax;

    for (const duration of [input.durationDaysMin, input.durationDaysMax]) {
      assertDomain(
        duration === null || (Number.isSafeInteger(duration) && duration > 0),
        "INVALID_DURATION",
        "Duration must be a positive whole number of days",
      );
    }
    if (input.durationDaysMin !== null && input.durationDaysMax !== null) {
      assertDomain(
        input.durationDaysMin <= input.durationDaysMax,
        "INVALID_DURATION_RANGE",
        "Minimum duration exceeds maximum duration",
      );
    }
  }

  static submit(input: SubmitBid, order: Order): Bid {
    assertDomain(order.status === "published", "ORDER_NOT_ACCEPTING_BIDS", "Only a published order accepts bids");
    assertDomain(input.contractorId !== order.customerId, "SELF_BID", "Customer cannot bid on their own order");
    const bid = new Bid(input, order.id);
    bid.record({
      name: "BidSubmitted",
      aggregateId: bid.id,
      occurredAt: input.submittedAt,
      payload: { orderId: bid.orderId, contractorId: bid.contractorId },
    });
    return bid;
  }

  static restore(snapshot: BidSnapshot): Bid {
    const bid = new Bid(
      {
        id: snapshot.id,
        contractorId: snapshot.contractorId,
        message: snapshot.message,
        price: MoneyRange.create(
          snapshot.priceMinMinor === null
            ? null
            : Money.fromMinor(snapshot.priceMinMinor, snapshot.priceCurrency),
          snapshot.priceMaxMinor === null
            ? null
            : Money.fromMinor(snapshot.priceMaxMinor, snapshot.priceCurrency),
        ),
        durationDaysMin: snapshot.durationDaysMin,
        durationDaysMax: snapshot.durationDaysMax,
        visibility: snapshot.visibility,
        submittedAt: snapshot.submittedAt,
      },
      snapshot.orderId,
    );
    bid.#status = snapshot.status;
    bid.#decidedAt = snapshot.decidedAt ? new Date(snapshot.decidedAt) : null;
    return bid;
  }

  get status(): BidStatus {
    return this.#status;
  }

  get decidedAt(): Date | null {
    return this.#decidedAt ? new Date(this.#decidedAt) : null;
  }

  select(occurredAt: Date): void {
    assertDomain(this.#status === "submitted", "BID_NOT_SELECTABLE", "Only a submitted bid can be selected");
    this.#status = "selected";
    this.#decidedAt = new Date(occurredAt);
    this.record({
      name: "BidSelected",
      aggregateId: this.id,
      occurredAt,
      payload: { orderId: this.orderId, contractorId: this.contractorId },
    });
  }

  reject(occurredAt: Date): void {
    if (this.#status === "rejected") return;
    assertDomain(this.#status === "submitted", "BID_NOT_REJECTABLE", "Only a submitted bid can be rejected");
    this.#status = "rejected";
    this.#decidedAt = new Date(occurredAt);
    this.record({
      name: "BidRejected",
      aggregateId: this.id,
      occurredAt,
      payload: { orderId: this.orderId },
    });
  }

  withdraw(actorId: string, occurredAt: Date): void {
    assertDomain(actorId === this.contractorId, "BID_FORBIDDEN", "Only the contractor can withdraw this bid");
    if (this.#status === "withdrawn") return;
    assertDomain(this.#status === "submitted", "BID_NOT_WITHDRAWABLE", "Only a submitted bid can be withdrawn");
    this.#status = "withdrawn";
    this.#decidedAt = new Date(occurredAt);
    this.record({
      name: "BidWithdrawn",
      aggregateId: this.id,
      occurredAt,
      payload: { orderId: this.orderId },
    });
  }

  cancelForOrder(occurredAt: Date): void {
    if (this.#status === "cancelled") return;
    assertDomain(this.#status === "submitted", "BID_NOT_CANCELLABLE", "Only a submitted bid can be cancelled");
    this.#status = "cancelled";
    this.#decidedAt = new Date(occurredAt);
    this.record({
      name: "BidCancelled",
      aggregateId: this.id,
      occurredAt,
      payload: { orderId: this.orderId },
    });
  }

  toSnapshot(): BidSnapshot {
    const currency = this.price.min?.currency ?? this.price.max?.currency ?? "RUB";
    return {
      id: this.id,
      orderId: this.orderId,
      contractorId: this.contractorId,
      message: this.message,
      priceMinMinor: this.price.min?.minor ?? null,
      priceMaxMinor: this.price.max?.minor ?? null,
      priceCurrency: currency,
      durationDaysMin: this.durationDaysMin,
      durationDaysMax: this.durationDaysMax,
      visibility: this.visibility,
      status: this.#status,
      submittedAt: new Date(this.submittedAt),
      decidedAt: this.decidedAt,
    };
  }
}
