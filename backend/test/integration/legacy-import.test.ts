import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { runMigrations } from "../../src/adapters/out/postgres/migrations.ts";
import { buildImportPlan } from "../../scripts/legacy/import-plan.ts";
import { importDatabase } from "../../scripts/legacy/import-database.ts";
import { PgDatabase } from "../../src/adapters/out/postgres/database.ts";
import { PgReputationReadRepository } from "../../src/adapters/out/postgres/repositories.ts";
import type { LegacyRow } from "../../scripts/legacy/mysql-dump.ts";

test("legacy import is atomic, idempotent and preserves selected bids and private revisions without notifications", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const schema = `legacy_test_${randomUUID().replaceAll("-", "_")}`;
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  try {
    await runMigrations(pool, resolve("migrations"));
    const tables = new Map<string, LegacyRow[]>([
      ["sed_users", [
        { user_id: "1", user_email: "customer@example.com", user_maingrp: "8", user_name: "Customer", user_regdate: "1500000000",
          user_password: "private-old-password", user_email_auth_string: "private-old-token" },
        { user_id: "2", user_email: "contractor@example.com", user_maingrp: "4", user_name: "Contractor", user_regdate: "1500000000" },
      ]],
      ["sed_projects", [{ item_id: "1", item_userid: "1", item_state: "0", item_title: "Work", item_text: "Description",
        item_cat: "1", item_city: "1", item_date: "1500000000", item_cost: "123.45" }]],
      ["sed_offers", ["1", "2"].map((id) => ({ item_id: id, item_pid: "1", item_userid: "2", item_text: "Bid", item_date: "1500000001",
        item_choise: id === "2" ? "performer" : "", item_hidden: "1", item_time_type: "0" }))],
      ["sed_attachs", []], ["sed_freelancers_scat", [{ item_userid: "2", item_scat: "1" }]],
      ["sed_reviews", [{ item_id: "1", item_userid: "1", item_touserid: "2", item_score: "-1", item_date: "1500000001", item_text: "Historical" }]],
    ]);
    const plan = buildImportPlan(tables, { categories: new Map([["projects:1", "house-building"], ["freelancers:1", "house-building"]]),
      locations: new Map([["city:1", "ru-locality-1"]]) });
    const client = await pool.connect();
    try {
      await assert.rejects(importDatabase(client, "a".repeat(64), { ...plan, accounts: [...plan.accounts, plan.accounts[0]!] }));
      assert.equal((await client.query("SELECT count(*)::int AS n FROM accounts")).rows[0].n, 0);
      assert.deepEqual(await importDatabase(client, "a".repeat(64), plan), { alreadyImported: false });
      await client.query("UPDATE contractor_profiles SET display_name = 'Changed after import'");
      assert.deepEqual(await importDatabase(client, "a".repeat(64), plan), { alreadyImported: true });
      assert.equal((await client.query("SELECT display_name FROM contractor_profiles")).rows[0].display_name, "Changed after import");
      assert.equal((await client.query("SELECT status FROM orders")).rows[0].status, "in_progress");
      assert.equal((await client.query("SELECT count(*)::int AS n FROM legacy_bid_versions")).rows[0].n, 2);
      assert.equal((await client.query("SELECT visibility FROM bids")).rows[0].visibility, "private");
      assert.equal((await client.query("SELECT count(*)::int AS n FROM outbox_events")).rows[0].n, 0);
      assert.equal((await client.query("SELECT count(*)::int AS n FROM sessions")).rows[0].n, 0);
      assert.equal((await client.query("SELECT score FROM legacy_profile_reviews")).rows[0].score, -1);
      assert.equal((await client.query("SELECT count(*)::int AS n FROM account_capabilities WHERE capability = 'admin'")).rows[0].n, 0);
      assert.equal((await client.query("SELECT count(*)::int AS n FROM legacy_import_entities WHERE metadata::text LIKE '%private-old-%'")).rows[0].n, 0);

      const contractor = plan.profiles[0]!.account_id;
      const customer = plan.accounts.find((a) => a.id !== contractor)!.id;
      const reads = new PgReputationReadRepository(new PgDatabase(pool));
      // Existing negative stays -1 in the source, but is read as 2 everywhere in the public API.
      assert.equal((await reads.findContractorProfile(contractor))!.ratingAverage, 2);
      const oldPage = await reads.listPublishedReviews(contractor, { limit: 20, offset: 0 });
      assert.equal(oldPage.items[0]!.score, 2);
      assert.equal(oldPage.items[0]!.orderId, null);
      assert.equal(oldPage.items[0]!.orderTitle, null);
      const positiveId = randomUUID();
      await client.query(`INSERT INTO legacy_profile_reviews(id,legacy_id,author_id,subject_id,score,text,created_at)
        VALUES($1,2,$2,$3,1,'Positive',to_timestamp(1500000002))`, [positiveId, customer, contractor]);
      await client.query("UPDATE orders SET status = 'completed', completed_at = to_timestamp(1500000003)");
      const newId = randomUUID();
      await client.query(`INSERT INTO reviews(id,order_id,author_id,subject_id,score,text,status,created_at)
        VALUES($1,$2,$3,$4,4,'New review','published',to_timestamp(1500000003))`, [newId, plan.orders[0]!.id, customer, contractor]);
      const combined = await reads.findContractorProfile(contractor);
      assert.equal(combined!.ratingAverage, 3.67); // (2 + 5 + 4) / 3; no averages-of-averages.
      assert.equal(combined!.reviewCount, 3);
      assert.equal(combined!.completedOrderCount, 1); // Legacy feedback never invents completed deals.
      const feed = await reads.listPublishedReviews(contractor, { limit: 20, offset: 0 });
      assert.deepEqual(feed.items.map((r) => r.score), [4, 5, 2]);
      assert.equal(feed.total, 3);
      const second = await reads.listPublishedReviews(contractor, { limit: 1, offset: 1 });
      assert.equal(second.total, 3);
      assert.equal(second.items[0]!.id, positiveId);
      assert.equal(feed.items[0]!.orderId, plan.orders[0]!.id);
      const catalog = await reads.listContractors({ sort: "rating", minRating: 3.6, limit: 20, offset: 0 });
      assert.equal(catalog.items[0]!.ratingAverage, 3.67);
      assert.equal(catalog.items[0]!.reviewCount, 3);
      assert.equal((await reads.listContractors({ sort: "rating", minRating: 4, limit: 20, offset: 0 })).total, 0);
      // Hidden/disputed feedback from either source disappears from the same feed/count/average.
      await client.query("UPDATE reviews SET status = 'hidden' WHERE id = $1", [newId]);
      await client.query("UPDATE legacy_profile_reviews SET status = 'disputed' WHERE legacy_id = 1");
      assert.equal((await reads.findContractorProfile(contractor))!.ratingAverage, 5);
      assert.equal((await reads.listPublishedReviews(contractor, { limit: 20, offset: 0 })).total, 1);
      await client.query("UPDATE legacy_profile_reviews SET status = 'hidden' WHERE id = $1", [positiveId]);
      assert.equal((await reads.findContractorProfile(contractor))!.ratingAverage, null);
      assert.equal((await reads.findContractorProfile(contractor))!.reviewCount, 0);
      await runMigrations(pool, resolve("migrations"));
      assert.equal((await client.query("SELECT rating_score FROM legacy_profile_reviews WHERE legacy_id = 1")).rows[0].rating_score, 2);
    } finally { client.release(); }
  } finally {
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
