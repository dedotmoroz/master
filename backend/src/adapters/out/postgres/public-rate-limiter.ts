import { createHmac } from "node:crypto";
import type { PublicRateLimiter } from "../../../modules/attachments/application/ports/attachment-ports.ts";
import type { PgDatabase } from "./database.ts";

type RateLimitRow = {
  request_count: number;
  window_started_at: Date;
};

export class PgPublicRateLimiter implements PublicRateLimiter {
  readonly #database: PgDatabase;
  readonly #secret: Buffer;

  constructor(database: PgDatabase, secret: string) {
    this.#database = database;
    this.#secret = Buffer.from(secret, "utf8");
  }

  async consume(input: Readonly<{
    action: string;
    clientAddress: string;
    limit: number;
    windowSeconds: number;
    occurredAt: Date;
  }>): Promise<Readonly<{ allowed: boolean; retryAfterSeconds: number }>> {
    const clientKey = createHmac("sha256", this.#secret)
      .update(`public-rate-limit:${input.clientAddress}`)
      .digest("hex");
    const windowMs = input.windowSeconds * 1_000;
    const windowStartedAt = new Date(
      Math.floor(input.occurredAt.getTime() / windowMs) * windowMs,
    );
    const result = await this.#database.query<RateLimitRow>(
      `INSERT INTO public_rate_limits
         (action, client_key, window_started_at, request_count, updated_at)
       VALUES ($1, $2, $3, 1, $4)
       ON CONFLICT (action, client_key) DO UPDATE SET
         request_count = CASE
           WHEN public_rate_limits.window_started_at = EXCLUDED.window_started_at
             THEN public_rate_limits.request_count + 1
           ELSE 1
         END,
         window_started_at = EXCLUDED.window_started_at,
         updated_at = EXCLUDED.updated_at
       RETURNING request_count, window_started_at`,
      [input.action, clientKey, windowStartedAt, input.occurredAt],
    );
    const row = result.rows[0] as RateLimitRow;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((row.window_started_at.getTime() + windowMs - input.occurredAt.getTime()) / 1_000),
    );
    return { allowed: row.request_count <= input.limit, retryAfterSeconds };
  }
}
