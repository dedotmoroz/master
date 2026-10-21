import { resolve } from "node:path";
import { Pool } from "pg";
import { runMigrations } from "../src/adapters/out/postgres/migrations.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString });
try {
  await runMigrations(pool, resolve("migrations"));
  console.log("Migrations applied");
} finally {
  await pool.end();
}
