import { AggregateRoot } from "../../../shared/domain/domain-event.ts";
import { assertDomain } from "../../../shared/domain/domain-error.ts";
import {
  Email,
  Money,
  MoneyRange,
  assertEntityId,
  assertNonBlank,
} from "../../../shared/domain/value-objects.ts";

export type OrderSubmissionStatus = "pending_email" | "confirmed" | "expired";

export type OrderDraftData = Readonly<{
  categoryId: string;
  locationId: string;
  title: string;
  description: string;
  budget: MoneyRange;
  temporaryAttachmentIds: readonly string[];
}>;

export type CreateOrderSubmission = Readonly<{
  id: string;
  email: Email;
  contactName: string;
  draft: OrderDraftData;
  consentVersion: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
}>;

export type OrderSubmissionSnapshot = Readonly<{
  id: string;
  email: string;
  contactName: string;
  categoryId: string;
  locationId: string;
  title: string;
  description: string;
  budgetMinMinor: number | null;
  budgetMaxMinor: number | null;
  budgetCurrency: string;
  temporaryAttachmentIds: readonly string[];
  consentVersion: string;
  tokenHash: string;
  status: OrderSubmissionStatus;
  createdAt: Date;
  expiresAt: Date;
  confirmedAt: Date | null;
  accountId: string | null;
  orderId: string | null;
}>;

export class OrderSubmission extends AggregateRoot {
  readonly id: string;
  readonly email: Email;
  readonly contactName: string;
  readonly draft: OrderDraftData;
  readonly consentVersion: string;
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  #status: OrderSubmissionStatus = "pending_email";
  #confirmedAt: Date | null = null;
  #accountId: string | null = null;
  #orderId: string | null = null;

  private constructor(input: CreateOrderSubmission) {
    super();
    this.id = assertEntityId(input.id, "submissionId");
    this.email = input.email;
    this.contactName = assertNonBlank(input.contactName, "contactName", 120);
    this.consentVersion = assertNonBlank(input.consentVersion, "consentVersion", 100);
    this.tokenHash = assertNonBlank(input.tokenHash, "tokenHash", 200);
    this.createdAt = new Date(input.createdAt);
    this.expiresAt = new Date(input.expiresAt);

    assertDomain(this.expiresAt > this.createdAt, "INVALID_EXPIRY", "Submission expiry must be after creation");
    assertEntityId(input.draft.categoryId, "categoryId");
    assertEntityId(input.draft.locationId, "locationId");
    const title = assertNonBlank(input.draft.title, "title", 160);
    const description = assertNonBlank(input.draft.description, "description", 10_000);
    const temporaryAttachmentIds = input.draft.temporaryAttachmentIds.map((id) =>
      assertEntityId(id, "temporaryAttachmentId"),
    );
    assertDomain(
      new Set(temporaryAttachmentIds).size === temporaryAttachmentIds.length,
      "DUPLICATE_ATTACHMENT",
      "Submission contains duplicate attachments",
    );
    assertDomain(temporaryAttachmentIds.length <= 10, "TOO_MANY_ATTACHMENTS", "At most 10 attachments are allowed");

    this.draft = Object.freeze({
      ...input.draft,
      title,
      description,
      temporaryAttachmentIds: Object.freeze(temporaryAttachmentIds),
    });
  }

  static create(input: CreateOrderSubmission): OrderSubmission {
    const submission = new OrderSubmission(input);
    submission.record({
      name: "GuestOrderSubmitted",
      aggregateId: submission.id,
      occurredAt: input.createdAt,
      payload: { email: submission.email.value },
    });
    return submission;
  }

  static restore(snapshot: OrderSubmissionSnapshot): OrderSubmission {
    const submission = new OrderSubmission({
      id: snapshot.id,
      email: Email.create(snapshot.email),
      contactName: snapshot.contactName,
      draft: {
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
        temporaryAttachmentIds: snapshot.temporaryAttachmentIds,
      },
      consentVersion: snapshot.consentVersion,
      tokenHash: snapshot.tokenHash,
      createdAt: snapshot.createdAt,
      expiresAt: snapshot.expiresAt,
    });
    submission.#status = snapshot.status;
    submission.#confirmedAt = snapshot.confirmedAt ? new Date(snapshot.confirmedAt) : null;
    submission.#accountId = snapshot.accountId;
    submission.#orderId = snapshot.orderId;
    return submission;
  }

  get status(): OrderSubmissionStatus {
    return this.#status;
  }

  get confirmedAt(): Date | null {
    return this.#confirmedAt ? new Date(this.#confirmedAt) : null;
  }

  get accountId(): string | null {
    return this.#accountId;
  }

  get orderId(): string | null {
    return this.#orderId;
  }

  isExpired(at: Date): boolean {
    return at >= this.expiresAt;
  }

  confirm(accountId: string, orderId: string, occurredAt: Date): void {
    if (this.#status === "confirmed") {
      assertDomain(
        this.#accountId === accountId && this.#orderId === orderId,
        "SUBMISSION_ALREADY_CONFIRMED",
        "Submission has already been confirmed for another order",
      );
      return;
    }

    assertDomain(this.#status === "pending_email", "SUBMISSION_NOT_PENDING", "Submission is not pending confirmation");
    assertDomain(!this.isExpired(occurredAt), "SUBMISSION_EXPIRED", "Confirmation link has expired");
    this.#accountId = assertEntityId(accountId, "accountId");
    this.#orderId = assertEntityId(orderId, "orderId");
    this.#confirmedAt = new Date(occurredAt);
    this.#status = "confirmed";
    this.record({
      name: "GuestOrderConfirmed",
      aggregateId: this.id,
      occurredAt,
      payload: { accountId, orderId },
    });
  }

  expire(occurredAt: Date): void {
    if (this.#status !== "pending_email") return;
    assertDomain(this.isExpired(occurredAt), "SUBMISSION_NOT_EXPIRED", "Submission has not reached its expiry time");
    this.#status = "expired";
    this.record({
      name: "GuestOrderExpired",
      aggregateId: this.id,
      occurredAt,
      payload: {},
    });
  }

  toSnapshot(): OrderSubmissionSnapshot {
    const currency = this.draft.budget.min?.currency ?? this.draft.budget.max?.currency ?? "RUB";
    return {
      id: this.id,
      email: this.email.value,
      contactName: this.contactName,
      categoryId: this.draft.categoryId,
      locationId: this.draft.locationId,
      title: this.draft.title,
      description: this.draft.description,
      budgetMinMinor: this.draft.budget.min?.minor ?? null,
      budgetMaxMinor: this.draft.budget.max?.minor ?? null,
      budgetCurrency: currency,
      temporaryAttachmentIds: this.draft.temporaryAttachmentIds,
      consentVersion: this.consentVersion,
      tokenHash: this.tokenHash,
      status: this.#status,
      createdAt: new Date(this.createdAt),
      expiresAt: new Date(this.expiresAt),
      confirmedAt: this.confirmedAt,
      accountId: this.#accountId,
      orderId: this.#orderId,
    };
  }
}
