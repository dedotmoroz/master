import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { readMysqlDump } from "./legacy/mysql-dump.ts";
import { buildImportPlan } from "./legacy/import-plan.ts";
import { importDatabase } from "./legacy/import-database.ts";
import { safeError } from "../src/shared/safe-error.ts";

async function main() {
  const apply = process.argv.includes("--apply");
  const source = process.argv.find((arg, i) => i > 1 && arg !== "--apply") ?? fileURLToPath(new URL("../../naitimastera.sql", import.meta.url));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  const sql = await readFile(source, "utf8");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 2000 });
  try {
    const categories = await pool.query<{ source: string; legacy_id: number; category_id: string }>("SELECT source, legacy_id, category_id FROM work_category_legacy_refs");
    const locations = await pool.query<{ source: string; legacy_id: number; location_id: string }>("SELECT source, legacy_id, location_id FROM russian_location_legacy_refs");
    const plan = buildImportPlan(readMysqlDump(sql), {
      categories: new Map(categories.rows.map((r) => [`${r.source}:${r.legacy_id}`, r.category_id])),
      locations: new Map(locations.rows.map((r) => [`${r.source}:${r.legacy_id}`, r.location_id])),
    });
    console.log(JSON.stringify({ phase: "validated", ...plan.report }, null, 2));
    if (apply) {
      const client = await pool.connect();
      try {
        const result = await importDatabase(client, createHash("sha256").update(sql).digest("hex"), plan);
        console.log(JSON.stringify({ phase: "committed", ...result }));
      } finally { client.release(); }
    }
  } finally { await pool.end(); }
}
main().catch((error: unknown) => {
  console.error(JSON.stringify({ status: "failed", failure: safeError(error),
    reason: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "IMPORT_FAILED" }));
  process.exitCode = 1;
});
