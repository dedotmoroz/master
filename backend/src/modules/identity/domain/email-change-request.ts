import { AggregateRoot } from "../../../shared/domain/domain-event.ts";
import { assertDomain } from "../../../shared/domain/domain-error.ts";
import { Email, assertEntityId, assertNonBlank } from "../../../shared/domain/value-objects.ts";

export type EmailChangeSnapshot = Readonly<{
  id: string; accountId: string; previousEmail: string; newEmail: string;
  tokenHash: string; createdAt: Date; expiresAt: Date;
  status: "pending" | "consumed" | "revoked";
}>;

export class EmailChangeRequest extends AggregateRoot {
  readonly id: string;
  readonly accountId: string;
  readonly previousEmail: Email;
  readonly newEmail: Email;
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  #status: EmailChangeSnapshot["status"];

  private constructor(snapshot: EmailChangeSnapshot) {
    super();
    this.id = assertEntityId(snapshot.id, "emailChangeId");
    this.accountId = assertEntityId(snapshot.accountId, "accountId");
    this.previousEmail = Email.create(snapshot.previousEmail);
    this.newEmail = Email.create(snapshot.newEmail);
    this.tokenHash = assertNonBlank(snapshot.tokenHash, "tokenHash", 200);
    this.createdAt = new Date(snapshot.createdAt);
    this.expiresAt = new Date(snapshot.expiresAt);
    this.#status = snapshot.status;
    assertDomain(this.expiresAt > this.createdAt, "INVALID_EXPIRY", "Email change expiry is invalid");
    assertDomain(!this.previousEmail.equals(this.newEmail), "EMAIL_UNCHANGED", "New email is the same as current email");
  }

  static create(input: Omit<EmailChangeSnapshot, "status">): EmailChangeRequest {
    const request = new EmailChangeRequest({ ...input, status: "pending" });
    request.record({ name: "EmailChangeRequested", aggregateId: request.id,
      occurredAt: request.createdAt, payload: {} });
    return request;
  }

  static restore(snapshot: EmailChangeSnapshot): EmailChangeRequest { return new EmailChangeRequest(snapshot); }
  get status(): EmailChangeSnapshot["status"] { return this.#status; }

  consume(occurredAt: Date): void {
    assertDomain(this.#status === "pending", "INVALID_EMAIL_CHANGE_TOKEN", "Email change token is invalid");
    assertDomain(occurredAt < this.expiresAt, "EMAIL_CHANGE_EXPIRED", "Email change link has expired");
    this.#status = "consumed";
  }

  toSnapshot(): EmailChangeSnapshot {
    return { id: this.id, accountId: this.accountId, previousEmail: this.previousEmail.value,
      newEmail: this.newEmail.value, tokenHash: this.tokenHash, createdAt: new Date(this.createdAt),
      expiresAt: new Date(this.expiresAt), status: this.#status };
  }
}
