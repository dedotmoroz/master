import { AggregateRoot } from "../../../shared/domain/domain-event.ts";
import { assertDomain } from "../../../shared/domain/domain-error.ts";
import { Email, assertEntityId } from "../../../shared/domain/value-objects.ts";

export type AccountCapability = "customer" | "contractor" | "admin";
export type AccountStatus = "active" | "suspended" | "deleted";

export type AccountSnapshot = Readonly<{
  id: string;
  email: string;
  status: AccountStatus;
  capabilities: readonly AccountCapability[];
  createdAt: Date;
}>;

export class Account extends AggregateRoot {
  readonly id: string;
  #email: Email;
  readonly createdAt: Date;
  #status: AccountStatus;
  #capabilities: Set<AccountCapability>;

  private constructor(snapshot: AccountSnapshot) {
    super();
    this.id = assertEntityId(snapshot.id, "accountId");
    this.#email = Email.create(snapshot.email);
    this.createdAt = new Date(snapshot.createdAt);
    this.#status = snapshot.status;
    this.#capabilities = new Set(snapshot.capabilities);
  }

  static registerVerified(id: string, email: Email, occurredAt: Date): Account {
    const account = new Account({
      id,
      email: email.value,
      status: "active",
      capabilities: [],
      createdAt: occurredAt,
    });
    account.record({
      name: "AccountRegistered",
      aggregateId: account.id,
      occurredAt,
      payload: { email: account.email.value },
    });
    return account;
  }

  static restore(snapshot: AccountSnapshot): Account {
    return new Account(snapshot);
  }

  get status(): AccountStatus {
    return this.#status;
  }

  get email(): Email { return this.#email; }

  delete(occurredAt: Date): void {
    assertDomain(this.#status === "active", "ACCOUNT_NOT_ACTIVE", "Account is not active");
    this.#status = "deleted";
    this.#email = Email.create(`deleted-${this.id}@accounts.invalid`);
    this.#capabilities.clear();
    this.record({ name: "AccountDeleted", aggregateId: this.id, occurredAt, payload: {} });
  }

  changeEmail(email: Email, occurredAt: Date): void {
    assertDomain(this.#status === "active", "ACCOUNT_NOT_ACTIVE", "Account is not active");
    assertDomain(!this.#email.equals(email), "EMAIL_UNCHANGED", "New email is the same as current email");
    const previousEmail = this.#email.value;
    this.#email = email;
    this.record({ name: "AccountEmailChanged", aggregateId: this.id, occurredAt,
      payload: { previousEmail, email: email.value } });
  }

  get capabilities(): readonly AccountCapability[] {
    return [...this.#capabilities];
  }

  hasCapability(capability: AccountCapability): boolean {
    return this.#capabilities.has(capability);
  }

  grantCapability(capability: AccountCapability, occurredAt: Date): void {
    assertDomain(this.#status === "active", "ACCOUNT_NOT_ACTIVE", "Capabilities require an active account");
    if (this.#capabilities.has(capability)) return;

    this.#capabilities.add(capability);
    this.record({
      name: "AccountCapabilityGranted",
      aggregateId: this.id,
      occurredAt,
      payload: { capability },
    });
  }

  suspend(occurredAt: Date): void {
    assertDomain(this.#status === "active", "ACCOUNT_NOT_ACTIVE", "Only an active account can be suspended");
    this.#status = "suspended";
    this.record({
      name: "AccountSuspended",
      aggregateId: this.id,
      occurredAt,
      payload: {},
    });
  }

  toSnapshot(): AccountSnapshot {
    return {
      id: this.id,
      email: this.email.value,
      status: this.#status,
      capabilities: this.capabilities,
      createdAt: new Date(this.createdAt),
    };
  }
}
