import { AggregateRoot } from "../../../shared/domain/domain-event.ts";
import { assertDomain } from "../../../shared/domain/domain-error.ts";
import { Email, assertEntityId, assertNonBlank } from "../../../shared/domain/value-objects.ts";

export type AccountDeletionSnapshot = Readonly<{
  id: string; accountId: string; email: string; tokenHash: string;
  createdAt: Date; expiresAt: Date; status: "pending" | "consumed" | "revoked";
}>;

export class AccountDeletionRequest extends AggregateRoot {
  readonly id: string;
  readonly accountId: string;
  readonly email: Email;
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  #status: AccountDeletionSnapshot["status"];

  private constructor(snapshot: AccountDeletionSnapshot) {
    super();
    this.id = assertEntityId(snapshot.id, "deletionRequestId");
    this.accountId = assertEntityId(snapshot.accountId, "accountId");
    this.email = Email.create(snapshot.email);
    this.tokenHash = assertNonBlank(snapshot.tokenHash, "tokenHash", 200);
    this.createdAt = new Date(snapshot.createdAt);
    this.expiresAt = new Date(snapshot.expiresAt);
    this.#status = snapshot.status;
    assertDomain(this.expiresAt > this.createdAt, "INVALID_EXPIRY", "Deletion request expiry is invalid");
  }

  static create(input: Omit<AccountDeletionSnapshot, "status">): AccountDeletionRequest {
    const request = new AccountDeletionRequest({ ...input, status: "pending" });
    request.record({ name: "AccountDeletionRequested", aggregateId: request.id, occurredAt: request.createdAt, payload: {} });
    return request;
  }
  static restore(snapshot: AccountDeletionSnapshot): AccountDeletionRequest { return new AccountDeletionRequest(snapshot); }
  get status(): AccountDeletionSnapshot["status"] { return this.#status; }
  consume(now: Date): void {
    assertDomain(this.#status === "pending", "INVALID_DELETION_TOKEN", "Deletion token is invalid");
    assertDomain(now < this.expiresAt, "DELETION_TOKEN_EXPIRED", "Deletion link has expired");
    this.#status = "consumed";
  }
  toSnapshot(): AccountDeletionSnapshot {
    return { id: this.id, accountId: this.accountId, email: this.email.value, tokenHash: this.tokenHash,
      status: this.#status, createdAt: new Date(this.createdAt), expiresAt: new Date(this.expiresAt) };
  }
}
