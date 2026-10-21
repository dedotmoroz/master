import type { Clock, TransactionManager } from '../../marketplace/application/ports/guest-order-ports.ts';
import type { AttachmentRepository, ObjectStorage, UnusedAccountAttachments } from './ports/attachment-ports.ts';

export class CleanupUnusedAccountAttachmentsHandler {
  readonly dependencies: Readonly<{
    attachments: AttachmentRepository; unused: UnusedAccountAttachments; storage: ObjectStorage;
    transactions: TransactionManager; clock: Clock; retentionMs?: number;
  }>;
  constructor(dependencies: CleanupUnusedAccountAttachmentsHandler['dependencies']){ this.dependencies = dependencies; }

  async execute(_workerId: string, limit = 100): Promise<number> {
    const d = this.dependencies;
    const now = d.clock.now();
    const retention = d.retentionMs ?? 86_400_000;
    if (!Number.isFinite(retention) || retention < 86_400_000) throw new Error('Account file retention must be at least 24 hours');
    const candidates = await d.transactions.execute(async () => {
      await d.unused.observeUnreferenced(now, limit);
      const found = await d.unused.findCandidates(new Date(now.getTime() - retention), limit);
      const claimed = [];
      for (const attachment of found) {
        // Saving references locks the same rows. Recheck with a fresh snapshot.
        if (await d.unused.isReferenced(attachment.id)) continue;
        const original = attachment.storageKey;
        const allowed = new Set([
          `attachments/${attachment.ownerId}/${attachment.id}`, `guest-attachments/${attachment.id}`,
          `processed-attachments/${attachment.id}/image.webp`, `processed-attachments/${attachment.id}/preview.webp`,
        ]);
        const keys = [original, attachment.safeStorageKey, attachment.previewStorageKey].filter((key): key is string => key !== null);
        if (attachment.ownerId === null || ![...allowed].slice(0,2).includes(original) || keys.some(key => !allowed.has(key))) continue;
        attachment.markUnusedAccountForCleanup(now);
        await d.attachments.save(attachment);
        claimed.push({attachment, keys: [...new Set(keys)]});
      }
      return claimed;
    });
    // Retriable after partial storage failure; cleanup_pending cannot be bound.
    for (const {attachment, keys} of candidates) {
      for (const key of keys) await d.storage.delete(key);
      await d.attachments.deleteCleanupPending(attachment.id);
    }
    return candidates.length;
  }
}
