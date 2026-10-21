import { AggregateRoot } from "../../../shared/domain/domain-event.ts";
import { assertDomain } from "../../../shared/domain/domain-error.ts";
import { Email, assertEntityId, assertNonBlank } from "../../../shared/domain/value-objects.ts";

export type EmailAuthPurpose = "registration" | "login";
export type EmailAuthRequestStatus = "pending" | "consumed";

export type EmailAuthRequestSnapshot = Readonly<{
  id: string;
  email: string;
  purpose: EmailAuthPurpose;
  tokenHash: string;
  status: EmailAuthRequestStatus;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  accountId: string | null;
}>;

export class EmailAuthRequest extends AggregateRoot {
  readonly id: string;
  readonly email: Email;
  readonly purpose: EmailAuthPurpose;
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  #status: EmailAuthRequestStatus;
  #consumedAt: Date | null;
  #accountId: string | null;

  private constructor(snapshot: EmailAuthRequestSnapshot) {
    super();
    this.id = assertEntityId(snapshot.id, "emailAuthRequestId");
    this.email = Email.create(snapshot.email);
    this.purpose = snapshot.purpose;
    this.tokenHash = assertNonBlank(snapshot.tokenHash, "tokenHash", 200);
    this.createdAt = new Date(snapshot.createdAt);
    this.expiresAt = new Date(snapshot.expiresAt);
    this.#status = snapshot.status;
    this.#consumedAt = snapshot.consumedAt ? new Date(snapshot.consumedAt) : null;
    this.#accountId = snapshot.accountId === null ? null : assertEntityId(snapshot.accountId, "accountId");
    assertDomain(this.expiresAt > this.createdAt, "INVALID_EXPIRY", "Authentication request expiry is invalid");
    assertDomain(
      (this.#status === "pending" && this.#consumedAt === null && this.#accountId === null)
        || (this.#status === "consumed" && this.#consumedAt !== null && this.#accountId !== null),
      "INVALID_AUTH_REQUEST_STATUS",
      "Authentication request status is invalid",
    );
  }

  static create(input: Readonly<{
    id: string;
    email: Email;
    purpose: EmailAuthPurpose;
    tokenHash: string;
    createdAt: Date;
    expiresAt: Date;
  }>): EmailAuthRequest {
    const request = new EmailAuthRequest({
      ...input,
      email: input.email.value,
      status: "pending",
      consumedAt: null,
      accountId: null,
    });
    request.record({
      name: "EmailAuthenticationRequested",
      aggregateId: request.id,
      occurredAt: request.createdAt,
      payload: { purpose: request.purpose },
    });
    return request;
  }

  static restore(snapshot: EmailAuthRequestSnapshot): EmailAuthRequest {
    return new EmailAuthRequest(snapshot);
  }

  get status(): EmailAuthRequestStatus {
    return this.#status;
  }

  get accountId(): string | null {
    return this.#accountId;
  }

  consume(accountId: string, occurredAt: Date): void {
    assertDomain(this.#status === "pending", "INVALID_AUTHENTICATION_TOKEN", "Authentication token is invalid");
    assertDomain(occurredAt <= this.expiresAt, "AUTHENTICATION_TOKEN_EXPIRED", "Authentication token has expired");
    this.#status = "consumed";
    this.#consumedAt = new Date(occurredAt);
    this.#accountId = assertEntityId(accountId, "accountId");
    this.record({
      name: "EmailAuthenticationCompleted",
      aggregateId: this.id,
      occurredAt,
      payload: { accountId: this.#accountId, purpose: this.purpose },
    });
  }

  toSnapshot(): EmailAuthRequestSnapshot {
    return {
      id: this.id,
      email: this.email.value,
      purpose: this.purpose,
      tokenHash: this.tokenHash,
      status: this.#status,
      createdAt: new Date(this.createdAt),
      expiresAt: new Date(this.expiresAt),
      consumedAt: this.#consumedAt ? new Date(this.#consumedAt) : null,
      accountId: this.#accountId,
    };
  }
}
