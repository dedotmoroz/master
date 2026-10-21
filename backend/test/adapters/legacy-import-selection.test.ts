import assert from "node:assert/strict";
import test from "node:test";
import { selectLegacyImport, summarizeLegacySelection } from "../../scripts/legacy/import-selection.ts";
import type { LegacyRow } from "../../scripts/legacy/mysql-dump.ts";

function fixture(): Map<string, LegacyRow[]> {
  return new Map([
    ["sed_users", [{ user_id: "1" }]],
    ["sed_projects", [
      { item_id: "10", item_userid: "1", item_state: "0", item_date: "1", item_text: "Description" },
      { item_id: "11", item_userid: "1", item_state: "1", item_text: "Description" },
      { item_id: "12", item_userid: "0" },
      { item_id: "13", item_userid: "999" },
      { item_id: "14", item_userid: "1", item_state: "-1" },
    ]],
    ["sed_offers", [{ item_id: "20", item_pid: "10", item_userid: "1", item_text: "Bid" }, { item_id: "21", item_pid: "13" }]],
    ["sed_attachs", [{ att_id: "30", att_pid: "10" }, { att_id: "31", att_pid: "12" }]],
    ["sed_projects_posts", [{ post_id: "40", post_pid: "10", post_oid: "20" },
      { post_id: "41", post_pid: "13", post_oid: "21" }, { post_id: "42", post_pid: "10", post_oid: "21" }]],
  ]);
}

test("legacy selection excludes ownerless orders and dependent rows without altering the source or publication state", () => {
  const tables = fixture();
  const before = JSON.stringify([...tables]);
  const selection = selectLegacyImport(tables);
  assert.deepEqual(selection.excluded.orders.map((r) => r.item_id), ["12", "13", "14"]);
  assert.deepEqual(selection.excluded.bids.map((r) => r.item_id), ["21"]);
  assert.deepEqual(selection.excluded.orderAttachments.map((r) => r.att_id), ["31"]);
  assert.deepEqual(selection.excluded.bidMessages.map((r) => r.post_id), ["41", "42"]);
  assert.deepEqual(selection.candidates.orders.map((r) => r.item_state), ["0", "1"]);
  assert.equal(JSON.stringify([...tables]), before);
  assert.deepEqual(summarizeLegacySelection(selection), summarizeLegacySelection(selectLegacyImport(tables)));
  assert.deepEqual(summarizeLegacySelection(selection).excluded, { orders: 3, bids: 1, orderAttachments: 1, bidMessages: 2 });
});

test("legacy selection applies approved empty-description, deleted-state, missing-contractor and empty-bid exclusions", () => {
  const tables = fixture();
  tables.get("sed_projects")!.push({ item_id: "15", item_userid: "1", item_state: "0", item_text: "  " });
  tables.get("sed_offers")!.push({ item_id: "22", item_pid: "10", item_userid: "9", item_text: "Bid" },
    { item_id: "23", item_pid: "10", item_userid: "1", item_text: "  " });
  const selection = selectLegacyImport(tables);
  assert.ok(selection.excluded.orders.some((r) => r.item_id === "15"));
  assert.ok(selection.excluded.bids.some((r) => r.item_id === "22"));
  assert.ok(selection.excluded.bids.some((r) => r.item_id === "23"));
});

test("legacy selection stops if an essential source table is missing instead of excluding everything", () => {
  const tables = fixture();
  tables.delete("sed_users");
  assert.throws(() => selectLegacyImport(tables), /Required legacy table is missing/);
});
