import type { Clock, TransactionManager } from "../../marketplace/application/ports/guest-order-ports.ts";
import { ObjectSizeLimitExceededError } from "./ports/attachment-ports.ts";
import type {
  AttachmentRepository,
  ImageSanitizer,
  MalwareScanner,
  ObjectStorage,
} from "./ports/attachment-ports.ts";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export class ProcessAttachmentHandler {
  readonly #attachments: AttachmentRepository;
  readonly #storage: ObjectStorage;
  readonly #scanner: MalwareScanner;
  readonly #images: ImageSanitizer;
  readonly #transactions: TransactionManager;
  readonly #clock: Clock;

  constructor(dependencies: Readonly<{
    attachments: AttachmentRepository;
    storage: ObjectStorage;
    scanner: MalwareScanner;
    images: ImageSanitizer;
    transactions: TransactionManager;
    clock: Clock;
  }>) {
    this.#attachments = dependencies.attachments;
    this.#storage = dependencies.storage;
    this.#scanner = dependencies.scanner;
    this.#images = dependencies.images;
    this.#transactions = dependencies.transactions;
    this.#clock = dependencies.clock;
  }

  async execute(attachmentId: string): Promise<void> {
    const current = await this.#attachments.findById(attachmentId);
    if (!current) return;

    if (current.status === "ready" || current.status === "rejected") {
      if (current.safeStorageKey !== current.storageKey) await this.#storage.delete(current.storageKey);
      return;
    }
    if (current.status !== "processing") return;

    let source: Buffer;
    try {
      source = await this.#storage.get(current.storageKey, current.sizeBytes);
    } catch (error) {
      if (!(error instanceof ObjectSizeLimitExceededError)) throw error;
      await this.#reject(current.id, "invalid_upload");
      await this.#storage.delete(current.storageKey);
      return;
    }
    if (source.byteLength !== current.sizeBytes) {
      await this.#reject(current.id, "invalid_upload");
      await this.#storage.delete(current.storageKey);
      return;
    }
    const scan = await this.#scanner.scan(source);
    if (!scan.clean) {
      await this.#reject(current.id, "malware_detected");
      await this.#storage.delete(current.storageKey);
      return;
    }

    if (!IMAGE_TYPES.has(current.contentType)) {
      if (!source.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
        await this.#reject(current.id, "invalid_document");
        await this.#storage.delete(current.storageKey);
        return;
      }
      const kept = await this.#markReady(current.id, {
        storageKey: current.storageKey,
        contentType: current.contentType,
        sizeBytes: source.byteLength,
        previewStorageKey: null,
      });
      if (!kept) await this.#storage.delete(current.storageKey);
      return;
    }

    let sanitized;
    try {
      sanitized = await this.#images.sanitize(source);
    } catch {
      await this.#reject(current.id, "invalid_image");
      await this.#storage.delete(current.storageKey);
      return;
    }

    const safeStorageKey = `processed-attachments/${current.id}/image.webp`;
    const previewStorageKey = `processed-attachments/${current.id}/preview.webp`;
    await this.#storage.put({ key: safeStorageKey, contentType: sanitized.contentType, body: sanitized.content });
    await this.#storage.put({ key: previewStorageKey, contentType: sanitized.contentType, body: sanitized.preview });
    const kept = await this.#markReady(current.id, {
      storageKey: safeStorageKey,
      contentType: sanitized.contentType,
      sizeBytes: sanitized.content.byteLength,
      previewStorageKey,
    });
    if (!kept) {
      await this.#storage.delete(safeStorageKey);
      await this.#storage.delete(previewStorageKey);
    }
    await this.#storage.delete(current.storageKey);
  }

  async #markReady(
    attachmentId: string,
    result: Readonly<{
      storageKey: string;
      contentType: string;
      sizeBytes: number;
      previewStorageKey: string | null;
    }>,
  ): Promise<boolean> {
    return this.#transactions.execute(async () => {
      const attachment = await this.#attachments.findById(attachmentId, { forUpdate: true });
      if (attachment?.status === "ready") return true;
      if (!attachment || attachment.status !== "processing") return false;
      attachment.markReady(result, this.#clock.now());
      await this.#attachments.save(attachment);
      return true;
    });
  }

  async #reject(attachmentId: string, reason: string): Promise<void> {
    await this.#transactions.execute(async () => {
      const attachment = await this.#attachments.findById(attachmentId, { forUpdate: true });
      if (!attachment || attachment.status !== "processing") return;
      attachment.reject(reason, this.#clock.now());
      await this.#attachments.save(attachment);
    });
  }
}
