import assert from "node:assert/strict";
import test from "node:test";
import { ProcessAttachmentHandler } from "../../src/modules/attachments/application/process-attachment.ts";
import type {
  AttachmentRepository,
  ImageSanitizer,
  MalwareScanner,
  ObjectStorage,
} from "../../src/modules/attachments/application/ports/attachment-ports.ts";
import { Attachment } from "../../src/modules/attachments/domain/attachment.ts";
import type { Clock, TransactionManager } from "../../src/modules/marketplace/application/ports/guest-order-ports.ts";

const now = new Date("2026-01-01T10:05:00.000Z");

class MemoryRepository implements AttachmentRepository {
  readonly item: Attachment;
  deleted = false;
  constructor(item: Attachment) { this.item = item; }
  async save(): Promise<void> {}
  async findById(id: string): Promise<Attachment | null> { return !this.deleted && id === this.item.id ? this.item : null; }
  async findByIds(): Promise<readonly Attachment[]> { return [this.item]; }
  async isPubliclyReferenced(): Promise<boolean> { return false; }
  async findGuestCleanupCandidates(): Promise<readonly Attachment[]> { return []; }
  async deleteCleanupPending(): Promise<void> {}
}

class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, Buffer>();
  readonly deleted: string[] = [];
  async createUploadUrl() { return { url: "https://storage.test/upload", headers: {} }; }
  async stat(): Promise<{ contentType: string; sizeBytes: number } | null> { return null; }
  async get(key: string): Promise<Buffer> {
    const object = this.objects.get(key);
    if (!object) throw new Error("missing object");
    return object;
  }
  async put(input: Readonly<{ key: string; contentType: string; body: Buffer }>): Promise<void> {
    this.objects.set(input.key, input.body);
  }
  async createDownloadUrl(): Promise<string> { return "https://storage.test/download"; }
  async delete(key: string): Promise<void> { this.objects.delete(key); this.deleted.push(key); }
}

class Services implements Clock, TransactionManager {
  now(): Date { return new Date(now); }
  execute<T>(work: () => Promise<T>): Promise<T> { return work(); }
}

function processing(contentType: "image/jpeg" | "application/pdf", content: Buffer) {
  const attachment = Attachment.requestUpload({
    id: "attachment-1",
    ownerId: "account-1",
    purpose: "portfolio",
    originalFileName: contentType === "application/pdf" ? "plan.pdf" : "photo.jpg",
    contentType,
    sizeBytes: content.byteLength,
    storageKey: "raw/attachment-1",
    createdAt: new Date("2026-01-01T10:00:00.000Z"),
    expiresAt: new Date("2026-01-01T10:15:00.000Z"),
  });
  attachment.pullEvents();
  attachment.confirmUpload({ contentType, sizeBytes: content.byteLength }, new Date("2026-01-01T10:01:00.000Z"));
  attachment.pullEvents();
  const repository = new MemoryRepository(attachment);
  const storage = new MemoryStorage();
  storage.objects.set(attachment.storageKey, content);
  return { attachment, repository, storage };
}

function handler(
  fixture: ReturnType<typeof processing>,
  scanner: MalwareScanner = { scan: async () => ({ clean: true }) },
  images: ImageSanitizer = {
    sanitize: async () => ({
      content: Buffer.from("safe-image"),
      preview: Buffer.from("safe-preview"),
      contentType: "image/webp",
    }),
  },
) {
  return new ProcessAttachmentHandler({
    attachments: fixture.repository,
    storage: fixture.storage,
    scanner,
    images,
    transactions: new Services(),
    clock: new Services(),
  });
}

test("clean images are re-encoded, previewed, and only then become ready", async () => {
  const fixture = processing("image/jpeg", Buffer.from("untrusted-image"));
  await handler(fixture).execute(fixture.attachment.id);

  const snapshot = fixture.attachment.toSnapshot();
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.safeContentType, "image/webp");
  assert.equal(snapshot.safeStorageKey, "processed-attachments/attachment-1/image.webp");
  assert.equal(snapshot.previewStorageKey, "processed-attachments/attachment-1/preview.webp");
  assert.equal(fixture.storage.objects.has("raw/attachment-1"), false);
  assert.deepEqual(fixture.storage.objects.get(snapshot.safeStorageKey as string), Buffer.from("safe-image"));
});

test("malware is rejected without invoking the image decoder", async () => {
  const fixture = processing("image/jpeg", Buffer.from("infected-image"));
  let decoded = false;
  await handler(
    fixture,
    { scan: async () => ({ clean: false, threat: "Eicar-Test-Signature" }) },
    { sanitize: async () => { decoded = true; throw new Error("must not run"); } },
  ).execute(fixture.attachment.id);

  assert.equal(fixture.attachment.status, "rejected");
  assert.equal(fixture.attachment.toSnapshot().rejectionReason, "malware_detected");
  assert.equal(decoded, false);
  assert.equal(fixture.storage.objects.has("raw/attachment-1"), false);
});

test("clean PDF keeps its private object but invalid PDF content is rejected", async () => {
  const valid = processing("application/pdf", Buffer.from("%PDF-1.7\ncontent"));
  await handler(valid).execute(valid.attachment.id);
  assert.equal(valid.attachment.status, "ready");
  assert.equal(valid.attachment.safeStorageKey, valid.attachment.storageKey);

  const invalid = processing("application/pdf", Buffer.from("not a pdf"));
  await handler(invalid).execute(invalid.attachment.id);
  assert.equal(invalid.attachment.status, "rejected");
  assert.equal(invalid.attachment.toSnapshot().rejectionReason, "invalid_document");
});

test("processing cannot recreate image objects after account cleanup removed the attachment", async () => {
  const fixture = processing("image/jpeg", Buffer.from("untrusted-image"));
  await handler(fixture, { scan: async () => ({ clean: true }) }, {
    sanitize: async () => {
      fixture.repository.deleted = true;
      return { content: Buffer.from("safe-image"), preview: Buffer.from("safe-preview"), contentType: "image/webp" };
    },
  }).execute(fixture.attachment.id);
  assert.equal(fixture.storage.objects.size, 0);
});
