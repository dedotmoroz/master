import { readFile, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { loadConfig } from "../src/app/config.ts";
import { S3ObjectStorage } from "../src/adapters/out/storage/s3-object-storage.ts";
import { ClamAvMalwareScanner } from "../src/adapters/out/security/clamav-malware-scanner.ts";
import { SharpImageSanitizer } from "../src/adapters/out/media/sharp-image-sanitizer.ts";
import { PgDatabase, PgTransactionManager } from "../src/adapters/out/postgres/database.ts";
import { PgAttachmentRepository } from "../src/adapters/out/postgres/repositories.ts";
import { Attachment, type AttachmentPurpose } from "../src/modules/attachments/domain/attachment.ts";
import { readMysqlDump } from "./legacy/mysql-dump.ts";
import { legacyId, legacyText } from "./legacy/import-plan.ts";
import { selectLegacyImport } from "./legacy/import-selection.ts";
import { safeError } from "../src/shared/safe-error.ts";
import { prepareLegacyFile } from "./legacy/prepare-file.ts";

type Job = { table: string; legacy: string; path: string; owner: string; purpose: AttachmentPurpose;
  parent: string; createdAt: Date; title?: string; description?: string };
const root = fileURLToPath(new URL("../../naitimastera", import.meta.url));
const maxBytes = 20 * 1024 * 1024;
function skipped(reason: string): never { throw new Error(`SKIP_${reason}`); }

async function main() {
  const config = loadConfig();
  if (config.malwareScanner.provider !== "clamav") throw new Error("CLAMAV_REQUIRED_FOR_IMPORT");
  const scanner = new ClamAvMalwareScanner(config.malwareScanner);
  // Fail before touching file metadata if the scanner is not ready. No development bypass.
  await scanner.scan(Buffer.from("legacy-import-readiness"));
  const pool = new Pool({ connectionString: config.databaseUrl, max: 2, connectionTimeoutMillis: 2000 });
  const storage = new S3ObjectStorage(config.storage);
  const images = new SharpImageSanitizer();
  const db = new PgDatabase(pool);
  const transactions = new PgTransactionManager(db);
  const attachments = new PgAttachmentRepository(db);
  const counts: Record<string, number> = {};
  let lock: PoolClient | undefined;
  try {
    lock = await pool.connect();
    const acquired = await lock.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(776321092) AS acquired");
    if (!acquired.rows[0]!.acquired) throw new Error("FILE_IMPORT_ALREADY_RUNNING");
    const tables = readMysqlDump(await readFile(fileURLToPath(new URL("../../naitimastera.sql", import.meta.url)), "utf8"));
    const selected = selectLegacyImport(tables);
    const orderMap = new Map(selected.candidates.orders.map((r) => [r.item_id!, r]));
    const profileIds = new Set((await pool.query<{ account_id: string }>("SELECT account_id FROM contractor_profiles")).rows.map((r) => r.account_id));
    const jobs: Job[] = selected.candidates.orderAttachments.map((r) => {
      const order = orderMap.get(r.att_pid!)!;
      return { table: "sed_attachs", legacy: r.att_id!, path: r.att_file!, owner: order.item_userid!, purpose: "order",
        parent: legacyId("sed_projects", order.item_id!), createdAt: new Date(Number(order.item_date) * 1000) };
    });
    for (const user of tables.get("sed_users")!) {
      if (user.user_avatar && profileIds.has(legacyId("sed_users", user.user_id!))) jobs.push({
        table: "sed_users_avatar", legacy: user.user_id!, path: user.user_avatar, owner: user.user_id!, purpose: "profile_avatar",
        parent: legacyId("sed_users", user.user_id!), createdAt: new Date(Number(user.user_regdate) * 1000),
      });
    }
    for (const item of tables.get("sed_portfolio") ?? []) {
      if (profileIds.has(legacyId("sed_users", item.item_userid!))) jobs.push({ table: "sed_portfolio", legacy: item.item_id!,
        path: item.item_img ?? "", owner: item.item_userid!, purpose: "portfolio", parent: legacyId("sed_users", item.item_userid!),
        createdAt: new Date(Number(item.item_date) * 1000), title: legacyText(item.item_title).slice(0, 160),
        description: legacyText(item.item_text).slice(0, 2000) });
    }
    const safeRoot = await realpath(root);
    for (const job of jobs) {
      const id = legacyId(job.table, job.legacy);
      const existing = await pool.query("SELECT 1 FROM attachments WHERE id = $1 AND status = 'ready'", [id]);
      if (existing.rowCount) { counts.alreadyReady = (counts.alreadyReady ?? 0) + 1; continue; }
      let safeKey: string | undefined;
      let previewKey: string | null = null;
      try {
        if (!job.path) skipped("FILE_MISSING");
        if (isAbsolute(job.path) || /^[a-z]+:/i.test(job.path) || job.path.includes("\\") || job.path.includes("\0")) skipped("UNSAFE_OR_EXTERNAL_PATH");
        const target = await realpath(resolve(safeRoot, job.path)).catch(() => skipped("FILE_MISSING"));
        const rel = relative(safeRoot, target);
        if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) skipped("UNSAFE_OR_EXTERNAL_PATH");
        const metadata = await stat(target);
        if (!metadata.isFile() || metadata.size < 1 || metadata.size > (job.purpose === "profile_avatar" ? 5 * 1024 * 1024 : maxBytes)) skipped("FILE_SIZE");
        const content = await readFile(target);
        if (content.length !== metadata.size) throw new Error("SOURCE_FILE_CHANGED");
        const { body, preview, type } = await prepareLegacyFile(content, job.purpose, scanner, images);
        safeKey = `legacy-attachments/${id}/${type === "application/pdf" ? "document.pdf" : "image.webp"}`;
        previewKey = preview ? `legacy-attachments/${id}/preview.webp` : null;
        const now = new Date();
        const attachment = Attachment.restore({ id, ownerId: legacyId("sed_users", job.owner), purpose: job.purpose,
          originalFileName: basename(job.path).slice(0, 255), contentType: type, sizeBytes: body.length, storageKey: safeKey,
          status: "ready", createdAt: job.createdAt, expiresAt: new Date(now.getTime() + 1000), uploadedAt: now, processedAt: now,
          safeStorageKey: safeKey, safeContentType: type, safeSizeBytes: body.length, previewStorageKey: previewKey,
          rejectionReason: null, guestClaimTokenHash: null, claimedSubmissionId: null });
        await transactions.execute(async () => {
          const account = await db.query<{ status: string }>("SELECT status FROM accounts WHERE id = $1 FOR UPDATE", [attachment.ownerId]);
          if (account.rows[0]?.status !== "active") skipped("ACCOUNT_NOT_ACTIVE");
          await storage.put({ key: safeKey!, contentType: type, body });
          if (preview && previewKey) await storage.put({ key: previewKey, contentType: type, body: preview });
          if ((await storage.stat(safeKey!))?.sizeBytes !== body.length) throw new Error("STORAGE_VERIFICATION_FAILED");
          if (preview && previewKey && (await storage.stat(previewKey))?.sizeBytes !== preview.length) throw new Error("STORAGE_VERIFICATION_FAILED");
          await attachments.save(attachment);
          await db.query(`INSERT INTO legacy_import_entities(source_table,legacy_id,target_id,account_id,metadata)
            VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_table,legacy_id) DO NOTHING`,
            [job.table, job.legacy, id, attachment.ownerId, JSON.stringify({
              sourceSha256: createHash("sha256").update(content).digest("hex"),
              safeSha256: createHash("sha256").update(body).digest("hex"),
            })]);
          if (job.purpose === "order") {
            const current = await db.query<{ attachment_ids: string[] }>("SELECT attachment_ids FROM orders WHERE id = $1 FOR UPDATE", [job.parent]);
            if (!current.rows[0] || current.rows[0].attachment_ids.length >= 10) skipped("ORDER_ATTACHMENT_LIMIT");
            await db.query(`UPDATE orders SET attachment_ids = attachment_ids || to_jsonb($2::text) WHERE id = $1
              AND NOT attachment_ids @> jsonb_build_array($2::text)`, [job.parent, id]);
          } else if (job.purpose === "profile_avatar") {
            await db.query("UPDATE contractor_profiles SET avatar_attachment_id = $2 WHERE account_id = $1 AND avatar_attachment_id IS NULL", [job.parent, id]);
          } else {
            await db.query(`UPDATE contractor_profiles SET portfolio = portfolio || $2::jsonb WHERE account_id = $1`,
              [job.parent, JSON.stringify([{ title: job.title, description: job.description, attachmentIds: [id] }])]);
          }
          await db.query(`INSERT INTO legacy_file_import_results(source_table, legacy_id, attachment_id, status)
            VALUES($1,$2,$3,'ready') ON CONFLICT(source_table,legacy_id) DO UPDATE SET attachment_id=EXCLUDED.attachment_id,
            status='ready', reason=NULL, checked_at=now()`, [job.table, job.legacy, id]);
        });
        counts.ready = (counts.ready ?? 0) + 1;
      } catch (error) {
        if (safeKey) await storage.delete(safeKey);
        if (previewKey) await storage.delete(previewKey);
        if (!(error instanceof Error) || !error.message.startsWith("SKIP_")) throw error;
        const reason = error.message.slice(5);
        await pool.query(`INSERT INTO legacy_file_import_results(source_table,legacy_id,status,reason)
          VALUES($1,$2,'skipped',$3) ON CONFLICT(source_table,legacy_id) DO UPDATE SET status='skipped',reason=EXCLUDED.reason,checked_at=now()`,
          [job.table, job.legacy, reason]);
        counts[reason] = (counts[reason] ?? 0) + 1;
      }
      const processed = Object.values(counts).reduce((a, b) => a + b, 0);
      if (processed % 100 === 0) console.log(JSON.stringify({ phase: "files", processed, total: jobs.length, counts }));
    }
    console.log(JSON.stringify({ phase: "files-complete", counts }));
  } finally {
    if (lock) { await lock.query("SELECT pg_advisory_unlock(776321092)"); lock.release(); }
    storage.destroy(); await pool.end();
  }
}
main().catch((error: unknown) => { console.error(JSON.stringify({ phase: "files-failed", failure: safeError(error) })); process.exitCode = 1; });
