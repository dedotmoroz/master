import assert from "node:assert/strict";
import test from "node:test";
import { ProcessOutboxBatchHandler, type OutboxRepository, type OutboxMessage } from "../../src/modules/notifications/application/process-outbox.ts";
import { safeError } from "../../src/shared/safe-error.ts";

test("outbox records a safe failure and reports retries without aborting the rest of the batch", async () => {
  const messages: OutboxMessage[] = ["bad", "good"].map((id) => ({ id, eventType: "NotificationEmailRequested",
    aggregateType: "Notification", aggregateId: id, payload: { email: "private@example.com" }, occurredAt: new Date(), attempts: 2 }));
  const failures: unknown[] = [];
  const reports: unknown[] = [];
  const processed: string[] = [];
  const outbox: OutboxRepository = {
    claimBatch: async () => messages,
    markProcessed: async (id) => { processed.push(id); },
    markFailed: async (id, reason, retryAt) => { failures.push({ id, reason, retryAt }); },
  };
  const before = Date.now();
  const handler = new ProcessOutboxBatchHandler(outbox, new Map([["NotificationEmailRequested", async (message) => {
    if (message.id === "bad") throw Object.assign(new Error("SMTP token=private-secret private@example.com"), { code: "EAUTH" });
  }]]), 60_000, (failure) => { reports.push(failure); });
  assert.equal(await handler.execute("worker"), 2);
  assert.deepEqual(processed, ["good"]);
  const failure = failures[0] as { reason: string; retryAt: Date };
  assert.equal(failure.reason, "Error:EAUTH");
  assert.ok(failure.retryAt.getTime() >= before + 120_000);
  assert.doesNotMatch(JSON.stringify({ failures, reports }), /private-secret|private@example.com/);
  assert.equal(reports.length, 1);
});

test("safe errors exclude arbitrary names, codes, messages, nested causes and non-errors", () => {
  assert.deepEqual(safeError(Object.assign(new Error("private"), { name: "private-email", code: "private-token", cause: "private" })), { type: "Error" });
  assert.deepEqual(safeError("private"), { type: "UnknownError" });
  assert.deepEqual(safeError(Object.assign(new Error("listen on private-address"), { code: "EADDRINUSE" })),
    { type: "Error", code: "EADDRINUSE" });
});
