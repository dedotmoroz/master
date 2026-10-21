import { AggregateRoot } from "../../../shared/domain/domain-event.ts";
import { assertDomain } from "../../../shared/domain/domain-error.ts";
import { assertEntityId, assertNonBlank } from "../../../shared/domain/value-objects.ts";
import type { Order } from "../../marketplace/domain/order.ts";

export type ReviewStatus = "published" | "hidden" | "disputed";

export type CreateReview = Readonly<{
  id: string;
  order: Order;
  authorId: string;
  subjectId: string;
  score: number;
  text: string;
  createdAt: Date;
}>;

export type ReviewSnapshot = Readonly<{
  id: string;
  orderId: string;
  authorId: string;
  subjectId: string;
  score: number;
  text: string;
  status: ReviewStatus;
  createdAt: Date;
}>;

export class Review extends AggregateRoot {
  readonly id: string;
  readonly orderId: string;
  readonly authorId: string;
  readonly subjectId: string;
  readonly score: number;
  readonly text: string;
  readonly createdAt: Date;
  #status: ReviewStatus = "published";

  private constructor(snapshot: ReviewSnapshot) {
    super();
    this.id = assertEntityId(snapshot.id, "reviewId");
    this.orderId = assertEntityId(snapshot.orderId, "orderId");
    this.authorId = assertEntityId(snapshot.authorId, "authorId");
    this.subjectId = assertEntityId(snapshot.subjectId, "subjectId");
    this.score = snapshot.score;
    this.text = assertNonBlank(snapshot.text, "text", 5_000);
    this.createdAt = new Date(snapshot.createdAt);
    this.#status = snapshot.status;
  }

  static create(input: CreateReview): Review {
    assertDomain(input.order.status === "completed", "ORDER_NOT_COMPLETED", "Reviews require a completed order");
    assertDomain(input.authorId !== input.subjectId, "SELF_REVIEW", "A user cannot review themselves");
    assertDomain(input.order.isParticipant(input.authorId), "REVIEW_AUTHOR_FORBIDDEN", "Review author did not participate in the order");
    assertDomain(input.order.isParticipant(input.subjectId), "REVIEW_SUBJECT_FORBIDDEN", "Review subject did not participate in the order");
    assertDomain(Number.isInteger(input.score) && input.score >= 1 && input.score <= 5, "INVALID_REVIEW_SCORE", "Review score must be from 1 to 5");

    const review = new Review({
      id: input.id,
      orderId: input.order.id,
      authorId: input.authorId,
      subjectId: input.subjectId,
      score: input.score,
      text: input.text,
      status: "published",
      createdAt: input.createdAt,
    });
    review.record({
      name: "ReviewSubmitted",
      aggregateId: review.id,
      occurredAt: input.createdAt,
      payload: {
        orderId: review.orderId,
        authorId: review.authorId,
        subjectId: review.subjectId,
        score: review.score,
      },
    });
    return review;
  }

  static restore(snapshot: ReviewSnapshot): Review {
    return new Review(snapshot);
  }

  get status(): ReviewStatus {
    return this.#status;
  }

  hide(occurredAt: Date): void {
    if (this.#status === "hidden") return;
    this.#status = "hidden";
    this.record({
      name: "ReviewHidden",
      aggregateId: this.id,
      occurredAt,
      payload: {},
    });
  }

  dispute(occurredAt: Date): void {
    assertDomain(this.#status === "published", "REVIEW_NOT_DISPUTABLE", "Only a published review can be disputed");
    this.#status = "disputed";
    this.record({
      name: "ReviewDisputed",
      aggregateId: this.id,
      occurredAt,
      payload: {},
    });
  }

  toSnapshot(): ReviewSnapshot {
    return {
      id: this.id,
      orderId: this.orderId,
      authorId: this.authorId,
      subjectId: this.subjectId,
      score: this.score,
      text: this.text,
      status: this.#status,
      createdAt: new Date(this.createdAt),
    };
  }
}
