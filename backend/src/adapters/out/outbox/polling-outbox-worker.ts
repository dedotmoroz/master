import { PollingWorker, type WorkerLogger } from "./polling-worker.ts";
export type { WorkerLogger } from "./polling-worker.ts";

export interface OutboxBatchProcessor {
  execute(workerId: string, limit?: number): Promise<number>;
}

export type PollingOutboxWorkerOptions = Readonly<{
  workerId: string;
  pollIntervalMs: number;
  batchSize: number;
}>;

export class PollingOutboxWorker extends PollingWorker {
  constructor(processor: OutboxBatchProcessor, logger: WorkerLogger, options: PollingOutboxWorkerOptions) {
    super(() => processor.execute(options.workerId, options.batchSize), logger,
      { name: "outbox", intervalMs: options.pollIntervalMs });
  }
}
