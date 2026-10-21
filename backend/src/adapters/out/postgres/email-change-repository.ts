import type { EmailChangeRepository } from "../../../modules/identity/application/email-change.ts";
import { EmailChangeRequest, type EmailChangeSnapshot } from "../../../modules/identity/domain/email-change-request.ts";
import type { PgDatabase } from "./database.ts";
import { persistEvents } from "./repositories.ts";

type Row = {
  id: string; account_id: string; previous_email: string; new_email: string;
  token_hash: string; status: EmailChangeSnapshot["status"]; created_at: Date; expires_at: Date;
};
function restore(row: Row): EmailChangeRequest {
  return EmailChangeRequest.restore({ id: row.id, accountId: row.account_id,
    previousEmail: row.previous_email, newEmail: row.new_email, tokenHash: row.token_hash,
    status: row.status, createdAt: row.created_at, expiresAt: row.expires_at });
}

export class PgEmailChangeRepository implements EmailChangeRepository {
  readonly #database: PgDatabase;
  constructor(database: PgDatabase) { this.#database = database; }

  async save(request: EmailChangeRequest): Promise<void> {
    this.#database.requireTransaction("Saving an email change request");
    const s = request.toSnapshot();
    await this.#database.query(
      `INSERT INTO email_change_requests
        (id, account_id, previous_email, new_email, token_hash, status, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
      [s.id, s.accountId, s.previousEmail, s.newEmail, s.tokenHash, s.status, s.createdAt, s.expiresAt],
    );
    await persistEvents(this.#database, "EmailChangeRequest", request);
  }
  async revokePending(accountId: string): Promise<void> {
    await this.#database.query("UPDATE email_change_requests SET status = 'revoked' WHERE account_id = $1 AND status = 'pending'", [accountId]);
  }
  async findById(id: string): Promise<EmailChangeRequest | null> {
    const result = await this.#database.query<Row>("SELECT * FROM email_change_requests WHERE id = $1", [id]);
    return result.rows[0] ? restore(result.rows[0]) : null;
  }
  async findByTokenHash(hash: string, options: Readonly<{ forUpdate?: boolean }> = {}): Promise<EmailChangeRequest | null> {
    if (options.forUpdate) this.#database.requireTransaction("Locking an email change request");
    const result = await this.#database.query<Row>(
      `SELECT * FROM email_change_requests WHERE token_hash = $1${options.forUpdate ? " FOR UPDATE" : ""}`, [hash]);
    return result.rows[0] ? restore(result.rows[0]) : null;
  }
}
