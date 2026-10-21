import type {
  OutboxMessage,
  OutboxRepository,
} from "../../../modules/notifications/application/process-outbox.ts";
import type { PgDatabase } from "./database.ts";

type OutboxRow = {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
  attempts: number;
};

export class PgOutboxRepository implements OutboxRepository {
  readonly #database: PgDatabase;

  constructor(database: PgDatabase) {
    this.#database = database;
  }

  async claimBatch(workerId: string, limit: number): Promise<readonly OutboxMessage[]> {
    return this.#database.transaction(async () => {
      const result = await this.#database.query<OutboxRow>(
        `WITH next_events AS (
           SELECT id
           FROM outbox_events
           WHERE processed_at IS NULL
             AND available_at <= now()
             AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes')
           ORDER BY occurred_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE outbox_events e
         SET locked_at = now(), locked_by = $2, attempts = attempts + 1
         FROM next_events n
         WHERE e.id = n.id
         RETURNING e.id, e.event_type, e.aggregate_type, e.aggregate_id,
                   e.payload, e.occurred_at, e.attempts`,
        [limit, workerId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        payload: row.payload,
        occurredAt: row.occurred_at,
        attempts: row.attempts,
      }));
    });
  }

  async markProcessed(messageId: string): Promise<void> {
    await this.#database.query(
      `UPDATE outbox_events
       SET processed_at = now(), locked_at = NULL, locked_by = NULL, last_error = NULL
       WHERE id = $1`,
      [messageId],
    );
  }

  async markFailed(messageId: string, error: string, retryAt: Date): Promise<void> {
    await this.#database.query(
      `UPDATE outbox_events
       SET available_at = $2, locked_at = NULL, locked_by = NULL, last_error = left($3, 2000)
       WHERE id = $1`,
      [messageId, retryAt, error],
    );
  }
}
