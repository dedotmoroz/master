import { PollingWorker, type WorkerLogger } from "../outbox/polling-worker.ts";

export interface AttachmentCleanupBatchProcessor {
  execute(workerId: string, limit?: number): Promise<number>;
}

export class PollingAttachmentCleanupWorker extends PollingWorker {
  constructor(processor: AttachmentCleanupBatchProcessor, logger: WorkerLogger,
    options: Readonly<{ workerId: string; intervalMs: number; batchSize: number }>) {
    super(() => processor.execute(options.workerId, options.batchSize), logger,
      { name: "attachment-cleanup", intervalMs: options.intervalMs });
  }
}
