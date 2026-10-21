import type { Clock, TransactionManager } from "../../marketplace/application/ports/guest-order-ports.ts";
import type { AttachmentRepository, ObjectStorage } from "./ports/attachment-ports.ts";

export class CleanupExpiredGuestAttachmentsHandler {
  readonly #attachments: AttachmentRepository;
  readonly #storage: ObjectStorage;
  readonly #transactions: TransactionManager;
  readonly #clock: Clock;
  readonly #unclaimedRetentionMs: number;

  constructor(dependencies: Readonly<{
    attachments: AttachmentRepository;
    storage: ObjectStorage;
    transactions: TransactionManager;
    clock: Clock;
    unclaimedRetentionMs?: number;
  }>) {
    this.#attachments = dependencies.attachments;
    this.#storage = dependencies.storage;
    this.#transactions = dependencies.transactions;
    this.#clock = dependencies.clock;
    this.#unclaimedRetentionMs = dependencies.unclaimedRetentionMs ?? 86_400_000;
  }

  async execute(_workerId: string, limit = 100): Promise<number> {
    const now = this.#clock.now();
    const candidates = await this.#transactions.execute(async () => {
      const cutoff = new Date(now.getTime() - this.#unclaimedRetentionMs);
      const found = await this.#attachments.findGuestCleanupCandidates(cutoff, limit);
      for (const attachment of found) {
        attachment.markForCleanup(now);
        await this.#attachments.save(attachment);
      }
      return found;
    });

    let removed = 0;
    for (const attachment of candidates) {
      const keys = new Set([
        attachment.storageKey,
        attachment.safeStorageKey,
        attachment.previewStorageKey,
      ].filter((key): key is string => key !== null));
      for (const key of keys) await this.#storage.delete(key);
      await this.#attachments.deleteCleanupPending(attachment.id);
      removed += 1;
    }
    return removed;
  }
}
