import { randomUUID } from "node:crypto";
import type { Notification, NotificationKind, NotificationPage, NotificationRepository } from "../../../modules/notifications/application/notifications.ts";
import type { PgDatabase } from "./database.ts";

type NotificationRow = {
  id: string; account_id: string; source_event_id: string; kind: NotificationKind;
  order_id: string; bid_id: string | null; title: string; text: string; created_at: Date;
  read_at: Date | null; emailed_at: Date | null; email_skipped_at: Date | null;
};

function restore(row: NotificationRow): Notification {
  return {
    id: row.id, accountId: row.account_id, sourceEventId: row.source_event_id,
    kind: row.kind, orderId: row.order_id, bidId: row.bid_id, title: row.title, text: row.text,
    createdAt: row.created_at, readAt: row.read_at, emailedAt: row.emailed_at, emailSkippedAt: row.email_skipped_at,
  };
}

export class PgNotificationRepository implements NotificationRepository {
  readonly database: PgDatabase;
  constructor(database: PgDatabase) { this.database = database; }

  async save(notification: Notification): Promise<void> {
    this.database.requireTransaction("Saving a notification and enqueueing email");
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO notifications
         (id, account_id, source_event_id, kind, order_id, title, text, created_at, bid_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (source_event_id, account_id) DO NOTHING RETURNING id`,
      [notification.id, notification.accountId, notification.sourceEventId, notification.kind,
        notification.orderId, notification.title, notification.text, notification.createdAt, notification.bidId ?? null],
    );
    if (result.rowCount === 0) return;
    await this.database.query(
      `INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload, occurred_at)
       VALUES ($1, 'NotificationEmailRequested', 'Notification', $2, '{}'::jsonb, $3)`,
      [randomUUID(), notification.id, notification.createdAt],
    );
  }

  async findById(id: string): Promise<Notification | null> {
    const result = await this.database.query<NotificationRow>("SELECT * FROM notifications WHERE id = $1", [id]);
    return result.rows[0] ? restore(result.rows[0]) : null;
  }

  async list(accountId: string, pagination: Readonly<{ limit: number; offset: number }>): Promise<NotificationPage> {
    const [items, count] = await Promise.all([
      this.database.query<NotificationRow>(
        `SELECT * FROM notifications WHERE account_id = $1
         ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
        [accountId, pagination.limit, pagination.offset],
      ),
      this.database.query<{ total: string; unread_count: string }>(
        `SELECT count(*) AS total, count(*) FILTER (WHERE read_at IS NULL) AS unread_count
         FROM notifications WHERE account_id = $1`, [accountId],
      ),
    ]);
    return {
      items: items.rows.map(restore), total: Number(count.rows[0]?.total ?? 0),
      unreadCount: Number(count.rows[0]?.unread_count ?? 0), ...pagination,
    };
  }

  async markRead(accountId: string, id: string, occurredAt: Date): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE notifications SET read_at = COALESCE(read_at, $3)
       WHERE id = $1 AND account_id = $2`, [id, accountId, occurredAt],
    );
    return result.rowCount === 1;
  }

  async markEmailed(id: string, occurredAt: Date): Promise<void> {
    await this.database.query(
      "UPDATE notifications SET emailed_at = COALESCE(emailed_at, $2) WHERE id = $1 AND email_skipped_at IS NULL", [id, occurredAt],
    );
  }

  async markEmailSkipped(id: string, occurredAt: Date): Promise<void> {
    await this.database.query(
      "UPDATE notifications SET email_skipped_at = COALESCE(email_skipped_at, $2) WHERE id = $1 AND emailed_at IS NULL", [id, occurredAt],
    );
  }
}
