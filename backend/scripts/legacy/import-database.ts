import type { PoolClient } from "pg";
import { importerVersion, legacyId, legacyText, type buildImportPlan } from "./import-plan.ts";
type Plan = ReturnType<typeof buildImportPlan>;

async function insert(client: PoolClient, table: string, rows: readonly Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  // Table/columns are internal constants, never derived from the dump.
  const columns = Object.keys(rows[0]!);
  if (![table, ...columns].every((v) => /^[a-z_]+$/.test(v))) throw new Error("INVALID_IMPORT_IDENTIFIER");
  await client.query(`INSERT INTO ${table} (${columns.join(",")})
    SELECT ${columns.join(",")} FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`, [JSON.stringify(rows)]);
}

export async function importDatabase(client: PoolClient, sha256: string, plan: Plan): Promise<{ alreadyImported: boolean }> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(776321091)");
    const previous = await client.query("SELECT 1 FROM legacy_import_runs WHERE source_sha256 = $1", [sha256]);
    if (previous.rowCount) {
      await client.query("COMMIT");
      return { alreadyImported: true };
    }
    const occupied = await client.query<{ found: boolean }>(`SELECT EXISTS(SELECT 1 FROM accounts) OR EXISTS(SELECT 1 FROM orders) AS found`);
    if (occupied.rows[0]!.found) throw new Error("IMPORT_REQUIRES_EMPTY_TARGET");
    await insert(client, "accounts", plan.accounts);
    await insert(client, "account_capabilities", plan.capabilities);
    await insert(client, "contractor_profiles", plan.profiles);
    await insert(client, "contractor_profile_specializations", plan.specializations);
    await insert(client, "contractor_service_areas", plan.serviceAreas);
    await insert(client, "orders", plan.orders.map((o) => ({ ...o, status: o.selected_bid_id ? "draft" : o.status,
      selected_bid_id: null, contractor_id: null })));
    await insert(client, "bids", plan.bids);
    for (const order of plan.orders.filter((o) => o.selected_bid_id)) {
      await client.query("UPDATE orders SET status = $2, selected_bid_id = $3, contractor_id = $4 WHERE id = $1",
        [order.id, order.status, order.selected_bid_id, order.contractor_id]);
    }
    await insert(client, "legacy_bid_versions", plan.versions);
    await insert(client, "legacy_profile_reviews", plan.reviews);
    await insert(client, "legacy_import_entities", plan.entities);
    const canonicalBid = new Map(plan.versions.map((r) => [String(r.legacy_id), r.bid_id]));
    const accounts = new Set(plan.accounts.map((r) => r.id));
    await insert(client, "legacy_bid_messages", plan.selection.candidates.bidMessages.map((r) => {
      const authorId = legacyId("sed_users", r.post_userid!);
      const seconds = Number(r.post_date);
      if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error("LEGACY_MESSAGE_DATE_INVALID");
      return { id: legacyId("sed_projects_posts", r.post_id!), legacy_id: r.post_id,
        order_id: legacyId("sed_projects", r.post_pid!), bid_id: canonicalBid.get(r.post_oid!) ?? null,
        author_id: accounts.has(authorId) ? authorId : null, legacy_author_id: r.post_userid,
        text: legacyText(r.post_text), created_at: new Date(seconds * 1000).toISOString() };
    }));
    // Import restored snapshots directly: no domain events, emails, sessions, or consent fabrication.
    await client.query("INSERT INTO legacy_import_runs(source_sha256, importer_version, report) VALUES($1,$2,$3)",
      [sha256, importerVersion, JSON.stringify(plan.report)]);
    await client.query("COMMIT");
    return { alreadyImported: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
