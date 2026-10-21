import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { PollingWorker } from "../../src/adapters/out/outbox/polling-worker.ts";
import { PollingOutboxWorker } from "../../src/adapters/out/outbox/polling-outbox-worker.ts";
import { PollingAttachmentCleanupWorker } from "../../src/adapters/out/storage/polling-attachment-cleanup-worker.ts";

function captureLogs() {
  const entries: Array<{ context: Readonly<Record<string, unknown>>; message: string }> = [];
  const write = (context: Readonly<Record<string, unknown>>, message: string) => { entries.push({ context, message }); };
  return { entries, logger: { info: write, error: write } };
}

test("worker reports failure, recovers, never overlaps, and waits for active work on stop", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { entries, logger } = captureLogs();
  let calls = 0;
  let finish!: (count: number) => void;
  const worker = new PollingWorker(async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error("secret-token customer@example.com"), { code: "ECONNREFUSED" });
    return new Promise<number>((resolve) => { finish = resolve; });
  }, logger, { name: "test", intervalMs: 10, stallMs: 50 });
  assert.equal(worker.snapshot().state, "stopped");
  worker.start();
  worker.start();
  context.mock.timers.tick(0);
  await setImmediate();
  assert.equal(worker.snapshot().consecutiveFailures, 1);
  assert.ok(worker.snapshot().lastFailedAt);
  assert.doesNotMatch(JSON.stringify(entries), /secret-token|customer@example.com/);
  context.mock.timers.tick(10);
  await setImmediate();
  assert.equal(worker.snapshot().state, "running");
  context.mock.timers.tick(100);
  assert.equal(calls, 2);
  assert.equal(entries.filter((e) => e.message === "Worker batch stalled").length, 1);
  let stopped = false;
  const stopping = worker.stop().then(() => { stopped = true; });
  await setImmediate();
  assert.equal(stopped, false);
  finish(3);
  await stopping;
  assert.equal(worker.snapshot().state, "stopped");
  assert.equal(worker.snapshot().consecutiveFailures, 0);
  assert.equal(worker.snapshot().lastBatchSize, 3);
  assert.ok(worker.snapshot().lastSucceededAt);
  context.mock.timers.tick(100);
  assert.equal(calls, 2);
});

test("both polling adapters forward batch settings and stop before the first poll", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { logger } = captureLogs();
  const calls: unknown[] = [];
  const processor = { execute: async (id: string, limit?: number) => { calls.push([id, limit]); return 0; } };
  const outbox = new PollingOutboxWorker(processor, logger, { workerId: "outbox-1", pollIntervalMs: 10, batchSize: 20 });
  const cleanup = new PollingAttachmentCleanupWorker(processor, logger, { workerId: "cleanup-1", intervalMs: 10, batchSize: 100 });
  outbox.start();
  await outbox.stop();
  context.mock.timers.tick(0);
  assert.deepEqual(calls, []);
  outbox.start();
  cleanup.start();
  context.mock.timers.tick(0);
  await setImmediate();
  await Promise.all([outbox.stop(), cleanup.stop()]);
  assert.deepEqual(calls, [["outbox-1", 20], ["cleanup-1", 100]]);
});
