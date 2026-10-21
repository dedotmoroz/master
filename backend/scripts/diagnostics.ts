import { Pool } from "pg";
import { PgDatabase } from "../src/adapters/out/postgres/database.ts";
import { readOperationalDiagnostics } from "../src/adapters/out/postgres/operational-diagnostics.ts";
import { safeError } from "../src/shared/safe-error.ts";

async function main(): Promise<void> {
  // No migrations or workers. Can run independently of the API with a read-only DB role.
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL,
    max: 2, connectionTimeoutMillis: 2_000, statement_timeout: 5_000, query_timeout: 6_000,
    options: "-c default_transaction_read_only=on" });
  try {
    const report = await readOperationalDiagnostics(new PgDatabase(pool));
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "ok") process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ status: "unavailable", failure: safeError(error) }));
  process.exitCode = 2;
});
