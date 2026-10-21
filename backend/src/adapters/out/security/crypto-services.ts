import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  AuthenticatedAccount,
  SessionAuthenticator,
} from "../../../modules/identity/application/session-authentication.ts";
import type { AccountCapability } from "../../../modules/identity/domain/account.ts";
import type {
  Clock,
  IdGenerator,
  IssuedToken,
  SessionIssuer,
  VerificationTokenService,
} from "../../../modules/marketplace/application/ports/guest-order-ports.ts";
import type { SessionManager } from "../../../modules/identity/application/ports/authentication-ports.ts";
import type { PgDatabase } from "../postgres/database.ts";

export class CryptoIdGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}

export class HmacVerificationTokenService implements VerificationTokenService {
  readonly #secret: Buffer;

  constructor(secret: string) {
    if (Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error("Verification token secret must contain at least 32 bytes");
    }
    this.#secret = Buffer.from(secret, "utf8");
  }

  issue(subject: string): IssuedToken {
    const encodedSubject = Buffer.from(subject, "utf8").toString("base64url");
    const signature = createHmac("sha256", this.#secret).update(encodedSubject).digest("base64url");
    const raw = `${encodedSubject}.${signature}`;
    return { raw, hash: this.hash(raw) };
  }

  hash(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  isAuthentic(raw: string): boolean {
    const [encodedSubject, signature] = raw.split(".");
    if (!encodedSubject || !signature) return false;
    const expected = createHmac("sha256", this.#secret).update(encodedSubject).digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(signature, "base64url");
    } catch {
      return false;
    }
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  }
}

export class PgSessionIssuer implements SessionIssuer, SessionManager {
  readonly #database: PgDatabase;
  readonly #clock: Clock;
  readonly #ttlMs: number;

  constructor(database: PgDatabase, clock: Clock, ttlMs = 30 * 24 * 60 * 60 * 1_000) {
    this.#database = database;
    this.#clock = clock;
    this.#ttlMs = ttlMs;
  }

  async issue(accountId: string): Promise<string> {
    const raw = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(raw).digest("hex");
    const createdAt = this.#clock.now();
    const expiresAt = new Date(createdAt.getTime() + this.#ttlMs);
    await this.#database.query(
      `INSERT INTO sessions (id, account_id, token_hash, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), accountId, tokenHash, createdAt, expiresAt],
    );
    return raw;
  }

  async revoke(rawToken: string, occurredAt: Date): Promise<void> {
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await this.#database.query(
      `UPDATE sessions SET revoked_at = $2
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash, occurredAt],
    );
  }

  async revokeAll(accountId: string, occurredAt: Date): Promise<void> {
    await this.#database.query(
      `UPDATE sessions SET revoked_at = $2
       WHERE account_id = $1 AND revoked_at IS NULL`,
      [accountId, occurredAt],
    );
  }
}

type SessionAccountRow = {
  account_id: string;
  capabilities: AccountCapability[];
};

export class PgSessionAuthenticator implements SessionAuthenticator {
  readonly #database: PgDatabase;
  readonly #clock: Clock;

  constructor(database: PgDatabase, clock: Clock) {
    this.#database = database;
    this.#clock = clock;
  }

  async authenticate(rawToken: string): Promise<AuthenticatedAccount | null> {
    if (rawToken.length < 20 || rawToken.length > 1_000) return null;
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const result = await this.#database.query<SessionAccountRow>(
      `SELECT s.account_id,
              COALESCE(array_agg(ac.capability) FILTER (WHERE ac.capability IS NOT NULL), '{}') AS capabilities
       FROM sessions s
       JOIN accounts a ON a.id = s.account_id
       LEFT JOIN account_capabilities ac ON ac.account_id = a.id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > $2
         AND a.status = 'active'
       GROUP BY s.account_id`,
      [tokenHash, this.#clock.now()],
    );
    const row = result.rows[0];
    return row ? { accountId: row.account_id, capabilities: row.capabilities } : null;
  }
}
