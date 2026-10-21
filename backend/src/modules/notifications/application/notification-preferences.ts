import { assertDomain } from "../../../shared/domain/domain-error.ts";
import type { AccountRepository, TransactionManager } from "../../marketplace/application/ports/guest-order-ports.ts";
import { NotificationPreferences, type NotificationPreferencesSnapshot, type NotificationPreferencesInput } from "../domain/notification-preferences.ts";

export interface NotificationPreferencesRepository {
  findByAccountId(accountId: string): Promise<NotificationPreferences>;
  save(accountId: string, preferences: NotificationPreferences): Promise<void>;
}

type Dependencies = Readonly<{
  accounts: AccountRepository;
  preferences: NotificationPreferencesRepository;
  transactions: TransactionManager;
}>;

export class GetNotificationPreferencesHandler {
  readonly #d: Pick<Dependencies, "accounts" | "preferences">;
  constructor(dependencies: Pick<Dependencies, "accounts" | "preferences">) { this.#d = dependencies; }

  async execute(accountId: string): Promise<NotificationPreferencesSnapshot> {
    const account = await this.#d.accounts.findById(accountId);
    assertDomain(account !== null && account.status === "active", "ACCOUNT_NOT_ACTIVE", "Account is not active");
    return (await this.#d.preferences.findByAccountId(accountId)).toSnapshot();
  }
}

export class UpdateNotificationPreferencesHandler {
  readonly #d: Dependencies;
  constructor(dependencies: Dependencies) { this.#d = dependencies; }

  execute(accountId: string, snapshot: NotificationPreferencesInput): Promise<NotificationPreferencesSnapshot> {
    NotificationPreferences.restore(snapshot);
    return this.#d.transactions.execute(async () => {
      const account = await this.#d.accounts.findById(accountId, { forUpdate: true });
      assertDomain(account !== null && account.status === "active", "ACCOUNT_NOT_ACTIVE", "Account is not active");
      const messageReceived = snapshot.email.messageReceived ?? (await this.#d.preferences.findByAccountId(accountId)).toSnapshot().email.messageReceived;
      const preferences = NotificationPreferences.restore({ email: { ...snapshot.email, messageReceived } });
      await this.#d.preferences.save(accountId, preferences);
      return preferences.toSnapshot();
    });
  }
}
