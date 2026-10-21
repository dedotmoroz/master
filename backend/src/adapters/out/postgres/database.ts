import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

export class PgDatabase {
  readonly #pool: Pool;
  readonly #transactionClient = new AsyncLocalStorage<PoolClient>();

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  get inTransaction(): boolean {
    return this.#transactionClient.getStore() !== undefined;
  }

  async query<TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<TRow>> {
    const executor = this.#transactionClient.getStore() ?? this.#pool;
    return executor.query<TRow>(text, [...values]);
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.#transactionClient.getStore()) return work();

    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await this.#transactionClient.run(client, work);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  requireTransaction(operation: string): void {
    if (!this.inTransaction) {
      throw new Error(`${operation} requires an active PostgreSQL transaction`);
    }
  }
}

export class PgTransactionManager {
  readonly #database: PgDatabase;

  constructor(database: PgDatabase) {
    this.#database = database;
  }

  execute<T>(work: () => Promise<T>): Promise<T> {
    return this.#database.transaction(work);
  }
}
