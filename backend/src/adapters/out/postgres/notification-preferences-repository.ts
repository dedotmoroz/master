import type { NotificationPreferencesRepository } from "../../../modules/notifications/application/notification-preferences.ts";
import { NotificationPreferences } from "../../../modules/notifications/domain/notification-preferences.ts";
import type { PgDatabase } from "./database.ts";

export class PgNotificationPreferencesRepository implements NotificationPreferencesRepository {
  readonly #database: PgDatabase;
  constructor(database: PgDatabase) { this.#database = database; }

  async findByAccountId(accountId: string): Promise<NotificationPreferences> {
    const result = await this.#database.query<{
      email_bid_submitted: boolean; email_bid_selected: boolean; email_order_completed: boolean; email_message_received: boolean;
    }>("SELECT * FROM notification_preferences WHERE account_id = $1", [accountId]);
    const row = result.rows[0];
    return row ? NotificationPreferences.restore({ email: {
      bidSubmitted: row.email_bid_submitted, bidSelected: row.email_bid_selected,
      orderCompleted: row.email_order_completed,
      messageReceived: row.email_message_received,
    } }) : NotificationPreferences.defaults();
  }

  async save(accountId: string, preferences: NotificationPreferences): Promise<void> {
    this.#database.requireTransaction("Saving notification preferences");
    const { email } = preferences.toSnapshot();
    await this.#database.query(`INSERT INTO notification_preferences
      (account_id, email_bid_submitted, email_bid_selected, email_order_completed, email_message_received)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT (account_id) DO UPDATE SET
        email_bid_submitted = EXCLUDED.email_bid_submitted,
        email_bid_selected = EXCLUDED.email_bid_selected,
        email_order_completed = EXCLUDED.email_order_completed,
        email_message_received = EXCLUDED.email_message_received, updated_at = now()`,
    [accountId, email.bidSubmitted, email.bidSelected, email.orderCompleted, email.messageReceived]);
  }
}
