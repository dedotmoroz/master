import assert from "node:assert/strict";
import test from "node:test";
import { BidMessage } from "../../src/modules/marketplace/domain/bid-message.ts";

const snapshot = { id: "message-1", bidId: "bid-1", orderId: "order-1", authorId: "user-1",
  clientMessageId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", text: "  Сообщение  ", createdAt: new Date("2026-01-01") };
test("private messages normalize text and client ID, and protect their immutable timestamp", () => {
  const m = BidMessage.create(snapshot);
  snapshot.createdAt.setUTCFullYear(2027);
  const s = m.toSnapshot();
  assert.equal(s.text, "Сообщение");
  assert.equal(s.clientMessageId, snapshot.clientMessageId.toLowerCase());
  assert.equal(s.createdAt.getUTCFullYear(), 2026);
  s.createdAt.setUTCFullYear(2030);
  assert.equal(m.toSnapshot().createdAt.getUTCFullYear(), 2026);
});
test("private messages reject blank/oversized/NUL text, malformed client IDs and dates", () => {
  for (const text of ["  ", "x".repeat(5001), "x\0y"]) assert.throws(() => BidMessage.create({ ...snapshot, text }));
  assert.throws(() => BidMessage.create({ ...snapshot, clientMessageId: "bad" }));
  assert.throws(() => BidMessage.create({ ...snapshot, createdAt: new Date("bad") }));
});
