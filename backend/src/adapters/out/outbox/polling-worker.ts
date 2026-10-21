import { safeError } from "../../../shared/safe-error.ts";

export interface WorkerLogger {
  info(context: Readonly<Record<string, unknown>>, message: string): void;
  error(context: Readonly<Record<string, unknown>>, message: string): void;
}

export type WorkerSnapshot = Readonly<{
  state: "stopped" | "idle" | "running";
  lastStartedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  consecutiveFailures: number;
  lastBatchSize: number;
}>;

export class PollingWorker {
  readonly #execute: () => Promise<number>;
  readonly #logger: WorkerLogger;
  readonly #name: string;
  readonly #intervalMs: number;
  readonly #stallMs: number;
  #timer: NodeJS.Timeout | null = null;
  #active: Promise<void> | null = null;
  #stopping = true;
  #snapshot: WorkerSnapshot = {
    state: "stopped", lastStartedAt: null, lastSucceededAt: null, lastFailedAt: null,
    consecutiveFailures: 0, lastBatchSize: 0,
  };

  constructor(execute: () => Promise<number>, logger: WorkerLogger,
    options: Readonly<{ name: string; intervalMs: number; stallMs?: number }>) {
    this.#execute = execute;
    this.#logger = logger;
    this.#name = options.name;
    this.#intervalMs = options.intervalMs;
    this.#stallMs = options.stallMs ?? 300_000;
  }

  snapshot(): WorkerSnapshot { return { ...this.#snapshot }; }

  start(): void {
    if (!this.#stopping || this.#active) return;
    this.#stopping = false;
    this.#snapshot = { ...this.#snapshot, state: "idle" };
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    await this.#active;
    this.#snapshot = { ...this.#snapshot, state: "stopped" };
  }

  #schedule(delay: number): void {
    if (this.#stopping) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#active = this.#poll().finally(() => {
        this.#active = null;
        this.#schedule(this.#intervalMs);
      });
    }, delay);
    this.#timer.unref();
  }

  async #poll(): Promise<void> {
    const started = Date.now();
    this.#snapshot = { ...this.#snapshot, state: "running", lastStartedAt: new Date(started).toISOString() };
    // Signal a stalled batch without overlapping or abandoning in-flight work.
    const watchdog = setTimeout(() => {
      this.#logger.error({ worker: this.#name, durationMs: Date.now() - started }, "Worker batch stalled");
    }, this.#stallMs);
    watchdog.unref();
    try {
      const processed = await this.#execute();
      if (processed > 0 || this.#snapshot.consecutiveFailures > 0) {
        this.#logger.info({ worker: this.#name, processed, durationMs: Date.now() - started }, "Worker batch completed");
      }
      this.#snapshot = { ...this.#snapshot, lastSucceededAt: new Date().toISOString(),
        lastBatchSize: processed, consecutiveFailures: 0 };
    } catch (error) {
      this.#snapshot = { ...this.#snapshot, lastFailedAt: new Date().toISOString(),
        consecutiveFailures: this.#snapshot.consecutiveFailures + 1 };
      this.#logger.error({ worker: this.#name, failure: safeError(error),
        consecutiveFailures: this.#snapshot.consecutiveFailures }, "Worker batch failed");
    } finally {
      clearTimeout(watchdog);
      this.#snapshot = { ...this.#snapshot, state: this.#stopping ? "stopped" : "idle" };
    }
  }
}
