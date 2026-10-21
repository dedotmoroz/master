import { AccountDeletionRequest, type AccountDeletionSnapshot } from "../../../modules/identity/domain/account-deletion-request.ts";
import type { AccountDeletionRepository, AccountErasure, AccountErasureCleanup } from "../../../modules/identity/application/account-deletion.ts";
import type { PgDatabase } from "./database.ts";
import { persistEvents } from "./repositories.ts";

type Row = { id: string; account_id: string; email: string; token_hash: string;
  status: AccountDeletionSnapshot["status"]; created_at: Date; expires_at: Date };
function restore(row: Row): AccountDeletionRequest {
  return AccountDeletionRequest.restore({ id: row.id, accountId: row.account_id, email: row.email,
    tokenHash: row.token_hash, status: row.status, createdAt: row.created_at, expiresAt: row.expires_at });
}

export class PgAccountDeletionRepository implements AccountDeletionRepository {
  readonly #db: PgDatabase;
  constructor(database: PgDatabase) { this.#db = database; }
  async save(request: AccountDeletionRequest): Promise<void> {
    this.#db.requireTransaction("Saving account deletion request");
    const s = request.toSnapshot();
    await this.#db.query(`INSERT INTO account_deletion_requests
      (id, account_id, email, token_hash, status, created_at, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
    [s.id, s.accountId, s.email, s.tokenHash, s.status, s.createdAt, s.expiresAt]);
    await persistEvents(this.#db, "AccountDeletionRequest", request);
  }
  async revokePending(accountId: string): Promise<void> {
    await this.#db.query("UPDATE account_deletion_requests SET status = 'revoked' WHERE account_id = $1 AND status = 'pending'", [accountId]);
  }
  async findById(id: string): Promise<AccountDeletionRequest | null> {
    const r = await this.#db.query<Row>("SELECT * FROM account_deletion_requests WHERE id = $1", [id]);
    return r.rows[0] ? restore(r.rows[0]) : null;
  }
  async findByTokenHash(hash: string, options: Readonly<{ forUpdate?: boolean }> = {}): Promise<AccountDeletionRequest | null> {
    if (options.forUpdate) this.#db.requireTransaction("Locking deletion request");
    const r = await this.#db.query<Row>(`SELECT * FROM account_deletion_requests WHERE token_hash = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [hash]);
    return r.rows[0] ? restore(r.rows[0]) : null;
  }
}

export class PgAccountErasure implements AccountErasure, AccountErasureCleanup {
  readonly #db: PgDatabase;
  constructor(database: PgDatabase) { this.#db = database; }

  async hasOngoingOrders(accountId: string): Promise<boolean> {
    const r = await this.#db.query<{ found: boolean }>(`SELECT EXISTS (
      SELECT 1 FROM orders WHERE status = 'in_progress' AND (customer_id = $1 OR contractor_id = $1)
    ) AS found`, [accountId]);
    return r.rows[0]!.found;
  }

  async erasePersonalData(accountId: string, previousEmail: string, anonymousEmail: string, occurredAt: Date): Promise<void> {
    this.#db.requireTransaction("Erasing account personal data");
    await this.#db.query("DELETE FROM contractor_profiles WHERE account_id = $1", [accountId]);
    await this.#db.query("UPDATE legacy_import_entities SET metadata = '{}'::jsonb WHERE account_id = $1", [accountId]);
    await this.#db.query("DELETE FROM legacy_profile_reviews WHERE author_id = $1 OR subject_id = $1", [accountId]);
    await this.#db.query("DELETE FROM legacy_bid_versions WHERE contractor_id = $1", [accountId]);
    await this.#db.query(`DELETE FROM legacy_bid_messages WHERE author_id=$1 OR order_id IN (SELECT id FROM orders WHERE customer_id=$1)
      OR bid_id IN (SELECT id FROM bids WHERE contractor_id=$1)`, [accountId]);
    await this.#db.query(`DELETE FROM bid_messages WHERE author_id=$1 OR bid_id IN
      (SELECT b.id FROM bids b JOIN orders o ON o.id=b.order_id WHERE b.contractor_id=$1 OR o.customer_id=$1)`, [accountId]);
    await this.#db.query(`UPDATE outbox_events SET payload='{}'::jsonb, processed_at=COALESCE(processed_at,now())
      WHERE aggregate_type='Notification' AND aggregate_id IN
        (SELECT n.id FROM notifications n LEFT JOIN bids b ON b.id=n.bid_id JOIN orders o ON o.id=n.order_id
         WHERE n.kind='message_received' AND (b.contractor_id=$1 OR o.customer_id=$1))`, [accountId]);
    await this.#db.query(`DELETE FROM notifications n USING bids b,orders o WHERE n.bid_id=b.id AND b.order_id=o.id
      AND n.kind='message_received' AND (b.contractor_id=$1 OR o.customer_id=$1)`, [accountId]);
    await this.#db.query("DELETE FROM notifications WHERE account_id = $1", [accountId]);
    await this.#db.query("DELETE FROM notification_preferences WHERE account_id = $1", [accountId]);
    await this.#db.query("DELETE FROM email_auth_requests WHERE account_id = $1", [accountId]);
    await this.#db.query("DELETE FROM email_change_requests WHERE account_id = $1", [accountId]);
    await this.#db.query("UPDATE account_deletion_requests SET email = $2 WHERE account_id = $1", [accountId, anonymousEmail]);
    await this.#db.query(`UPDATE outbox_events SET payload = '{}'::jsonb, processed_at = COALESCE(processed_at, now())
      WHERE aggregate_type = 'Account' AND aggregate_id = $1 AND event_type <> 'AccountDeleted'`, [accountId]);
    await this.#db.query(`UPDATE order_submissions SET email = $2, contact_name = 'Удалённый пользователь',
      temporary_attachment_ids = '[]'::jsonb,
      token_hash = md5(id::text) || md5(id::text || $1::text),
      status = CASE WHEN status = 'pending_email' THEN 'expired' ELSE status END
      WHERE account_id = $1 OR (account_id IS NULL AND email = $3 AND created_at <= $4)`,
    [accountId, anonymousEmail, previousEmail, occurredAt]);
    await this.#db.query(`UPDATE attachments SET status = 'cleanup_pending', original_file_name = 'deleted-file', updated_at = now()
      WHERE owner_id = $1`, [accountId]);
    await this.#db.query(`INSERT INTO account_erasure_jobs (account_id, deleted_at)
      VALUES ($1,$2)`, [accountId, occurredAt]);
  }

  async eraseHistory(accountId: string): Promise<void> {
    await this.#db.transaction(async () => {
      const jobs = await this.#db.query<{ history_erased: boolean }>(
        "SELECT * FROM account_erasure_jobs WHERE account_id = $1 FOR UPDATE", [accountId]);
      const job = jobs.rows[0];
      if (!job || job.history_erased) return;
      await this.#db.query(`UPDATE orders SET status = 'cancelled', updated_at = now()
        WHERE customer_id = $1 AND status IN ('draft','published')`, [accountId]);
      await this.#db.query(`UPDATE bids SET status = 'cancelled', decided_at = now(), updated_at = now()
        WHERE status = 'submitted' AND (contractor_id = $1 OR order_id IN (SELECT id FROM orders WHERE customer_id = $1 AND status = 'cancelled'))`, [accountId]);
      await this.#db.query("UPDATE orders SET attachment_ids = '[]'::jsonb WHERE customer_id = $1", [accountId]);
      await this.#db.query("UPDATE account_erasure_jobs SET history_erased = true WHERE account_id = $1", [accountId]);
    });
  }

  async files(accountId: string) {
    const r = await this.#db.query<{ id: string; storage_key: string; safe_storage_key: string | null; preview_storage_key: string | null; expired: boolean }>(
      `SELECT a.id, a.storage_key, a.safe_storage_key, a.preview_storage_key, a.expires_at < now() AS expired
       FROM attachments a JOIN accounts owner ON owner.id = a.owner_id
       WHERE a.owner_id = $1 AND owner.status = 'deleted' AND a.status = 'cleanup_pending' LIMIT 100`, [accountId]);
    return r.rows.map((row) => ({ id: row.id, expired: row.expired,
      keys: [...new Set([row.storage_key, row.safe_storage_key, row.preview_storage_key,
        `processed-attachments/${row.id}/image.webp`, `processed-attachments/${row.id}/preview.webp`]
        .filter((key): key is string => key !== null))] }));
  }
  async removeFile(id: string): Promise<void> {
    await this.#db.query("DELETE FROM attachments WHERE id = $1 AND status = 'cleanup_pending'", [id]);
  }
}
