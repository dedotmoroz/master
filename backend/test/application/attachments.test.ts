import assert from "node:assert/strict";
import test from "node:test";
import { Account } from "../../src/modules/identity/domain/account.ts";
import type { AccountRepository, Clock, IdGenerator, TransactionManager, VerificationTokenService } from "../../src/modules/marketplace/application/ports/guest-order-ports.ts";
import type { AttachmentRepository, ObjectStorage } from "../../src/modules/attachments/application/ports/attachment-ports.ts";
import {
  ConfirmAttachmentUploadHandler,
  ConfirmGuestAttachmentUploadHandler,
  GetPublicAttachmentUrlHandler,
  GuestAttachmentClaimsService,
  RequestAttachmentUploadHandler,
  RequestGuestAttachmentUploadHandler,
  UploadedAttachmentUsagePolicy,
} from "../../src/modules/attachments/application/attachments.ts";
import { Attachment } from "../../src/modules/attachments/domain/attachment.ts";
import { DomainError } from "../../src/shared/domain/domain-error.ts";
import { Email } from "../../src/shared/domain/value-objects.ts";
import { CleanupExpiredGuestAttachmentsHandler } from "../../src/modules/attachments/application/cleanup-attachments.ts";
import { ProtectedGuestUploadAccess } from "../../src/modules/attachments/application/guest-upload-protection.ts";

const now = new Date("2026-01-01T10:00:00.000Z");

class Services implements Clock, IdGenerator, TransactionManager {
  now(): Date { return new Date(now); }
  next(): string { return "attachment-1"; }
  execute<T>(work: () => Promise<T>): Promise<T> { return work(); }
}

class Tokens implements VerificationTokenService {
  issue(subject: string) {
    const raw = `claim:${subject}`;
    return { raw, hash: this.hash(raw) };
  }
  hash(raw: string): string { return `hash:${raw}`; }
}

class Accounts implements AccountRepository {
  readonly account = Account.registerVerified("account-1", Email.create("owner@example.com"), now);
  async save(): Promise<void> {}
  async findById(id: string): Promise<Account | null> { return id === this.account.id ? this.account : null; }
  async findByEmail(): Promise<Account | null> { return this.account; }
}

class Attachments implements AttachmentRepository {
  readonly items = new Map<string, Attachment>();
  publicReference = false;
  async save(attachment: Attachment): Promise<void> { this.items.set(attachment.id, attachment); }
  async findById(id: string): Promise<Attachment | null> { return this.items.get(id) ?? null; }
  async findByIds(ids: readonly string[]): Promise<readonly Attachment[]> {
    return ids.flatMap((id) => {
      const item = this.items.get(id);
      return item ? [item] : [];
    });
  }
  async isPubliclyReferenced(): Promise<boolean> { return this.publicReference; }
  async findGuestCleanupCandidates(cutoff: Date, limit: number): Promise<readonly Attachment[]> {
    return [...this.items.values()].filter((item) => {
      const snapshot = item.toSnapshot();
      return snapshot.purpose === "guest_order"
        && snapshot.ownerId === null
        && snapshot.claimedSubmissionId === null
        && (snapshot.status === "cleanup_pending" || snapshot.expiresAt < cutoff);
    }).slice(0, limit);
  }
  async deleteCleanupPending(id: string): Promise<void> {
    if (this.items.get(id)?.status === "cleanup_pending") this.items.delete(id);
  }
}

class Storage implements ObjectStorage {
  readonly deletedKeys: string[] = [];
  readonly objects = new Map<string, Buffer>();
  metadata: { contentType: string; sizeBytes: number } | null = {
    contentType: "image/webp",
    sizeBytes: 1_024,
  };
  async createUploadUrl(input: Readonly<{ key: string; contentType: string; sizeBytes: number; expiresInSeconds: number }>) {
    return { url: `https://storage.test/${input.key}`, headers: { "content-type": input.contentType } };
  }
  async stat(): Promise<{ contentType: string; sizeBytes: number } | null> { return this.metadata; }
  async get(key: string): Promise<Buffer> { return this.objects.get(key) ?? Buffer.from("content"); }
  async put(input: Readonly<{ key: string; contentType: string; body: Buffer }>): Promise<void> { this.objects.set(input.key, input.body); }
  async createDownloadUrl(): Promise<string> { return "https://storage.test/download"; }
  async delete(key: string): Promise<void> { this.deletedKeys.push(key); }
}

function fixture() {
  const services = new Services();
  const attachments = new Attachments();
  const storage = new Storage();
  return { services, attachments, storage };
}

test("Request and confirm attachment upload form a verified lifecycle", async () => {
  const context = fixture();
  const requested = await new RequestAttachmentUploadHandler({
    accounts: new Accounts(),
    attachments: context.attachments,
    storage: context.storage,
    ids: context.services,
    clock: context.services,
    transactions: context.services,
    uploadUrlTtlSeconds: 900,
  }).execute({
    ownerId: "account-1",
    purpose: "portfolio",
    originalFileName: "house.webp",
    contentType: "image/webp",
    sizeBytes: 1_024,
  });

  const confirmed = await new ConfirmAttachmentUploadHandler({
    attachments: context.attachments,
    storage: context.storage,
    clock: context.services,
    transactions: context.services,
  }).execute("account-1", requested.attachment.id);

  assert.equal(requested.attachment.status, "pending_upload");
  assert.equal(requested.uploadHeaders["content-type"], "image/webp");
  assert.equal(confirmed.status, "processing");
});

test("Attachment usage requires matching owner, purpose, and ready status", async () => {
  const context = fixture();
  const attachment = Attachment.requestUpload({
    id: "attachment-1",
    ownerId: "account-1",
    purpose: "portfolio",
    originalFileName: "house.webp",
    contentType: "image/webp",
    sizeBytes: 1_024,
    storageKey: "attachments/account-1/attachment-1",
    createdAt: now,
    expiresAt: new Date("2026-01-01T10:15:00.000Z"),
  });
  context.attachments.items.set(attachment.id, attachment);
  const policy = new UploadedAttachmentUsagePolicy(context.attachments);

  await assert.rejects(
    policy.assertUsable("account-1", [attachment.id], "portfolio"),
    (error: unknown) => error instanceof DomainError && error.code === "ATTACHMENT_NOT_USABLE",
  );
  attachment.confirmUpload({ contentType: "image/webp", sizeBytes: 1_024 }, now);
  attachment.markReady({
    storageKey: "processed-attachments/attachment-1/image.webp",
    contentType: "image/webp",
    sizeBytes: 900,
    previewStorageKey: "processed-attachments/attachment-1/preview.webp",
  }, now);
  await policy.assertUsable("account-1", [attachment.id], "portfolio");
});

test("Guest attachment is confirmed with its claim token, reserved, and assigned after email confirmation", async () => {
  const context = fixture();
  const tokens = new Tokens();
  const requested = await new RequestGuestAttachmentUploadHandler({
    attachments: context.attachments,
    storage: context.storage,
    tokens,
    ids: context.services,
    clock: context.services,
    transactions: context.services,
    uploadUrlTtlSeconds: 900,
  }).execute({
    originalFileName: "plan.webp",
    contentType: "image/webp",
    sizeBytes: 1_024,
  });
  const confirm = new ConfirmGuestAttachmentUploadHandler({
    attachments: context.attachments,
    storage: context.storage,
    tokens,
    clock: context.services,
    transactions: context.services,
  });

  await assert.rejects(
    confirm.execute(requested.attachment.id, "wrong-token"),
    (error: unknown) => error instanceof DomainError && error.code === "ATTACHMENT_NOT_FOUND",
  );
  const uploaded = await confirm.execute(requested.attachment.id, requested.claimToken);
  context.attachments.items.get(uploaded.id)?.markReady({
    storageKey: "processed-attachments/attachment-1/image.webp",
    contentType: "image/webp",
    sizeBytes: 900,
    previewStorageKey: "processed-attachments/attachment-1/preview.webp",
  }, now);
  const claims = new GuestAttachmentClaimsService({
    attachments: context.attachments,
    tokens,
    clock: context.services,
  });
  await claims.reserveForSubmission("submission-1", [{
    attachmentId: uploaded.id,
    claimToken: requested.claimToken,
  }]);
  await assert.rejects(
    claims.reserveForSubmission("submission-2", [{
      attachmentId: uploaded.id,
      claimToken: requested.claimToken,
    }]),
    (error: unknown) => error instanceof DomainError && error.code === "GUEST_ATTACHMENT_ALREADY_CLAIMED",
  );
  await claims.assignToAccount("submission-1", "account-1", [uploaded.id]);

  const assigned = context.attachments.items.get(uploaded.id)?.toSnapshot();
  assert.equal(uploaded.ownerId, null);
  assert.equal(assigned?.ownerId, "account-1");
  assert.equal(assigned?.claimedSubmissionId, "submission-1");
  assert.equal(assigned?.guestClaimTokenHash, null);
  const policy = new UploadedAttachmentUsagePolicy(context.attachments);
  await policy.assertUsable("account-1", [uploaded.id], "order");
  await assert.rejects(policy.assertUsable("another-account", [uploaded.id], "order"),
    (error: unknown) => error instanceof DomainError && error.code === "ATTACHMENT_NOT_USABLE");
  await assert.rejects(policy.assertUsable("account-1", [uploaded.id], "portfolio"),
    (error: unknown) => error instanceof DomainError && error.code === "ATTACHMENT_NOT_USABLE");
});

test("Public URL is issued only after a ready attachment is referenced", async () => {
  const context = fixture();
  const attachment = Attachment.restore({
    id: "attachment-1",
    ownerId: "account-1",
    purpose: "portfolio",
    originalFileName: "house.webp",
    contentType: "image/webp",
    sizeBytes: 1_024,
    storageKey: "attachments/account-1/attachment-1",
    status: "ready",
    createdAt: now,
    expiresAt: new Date("2026-01-01T10:15:00.000Z"),
    uploadedAt: now,
    processedAt: now,
    safeStorageKey: "processed-attachments/attachment-1/image.webp",
    safeContentType: "image/webp",
    safeSizeBytes: 900,
    previewStorageKey: "processed-attachments/attachment-1/preview.webp",
    rejectionReason: null,
    guestClaimTokenHash: null,
    claimedSubmissionId: null,
  });
  context.attachments.items.set(attachment.id, attachment);
  const handler = new GetPublicAttachmentUrlHandler({
    attachments: context.attachments,
    storage: context.storage,
    downloadUrlTtlSeconds: 900,
  });

  await assert.rejects(
    handler.execute(attachment.id),
    (error: unknown) => error instanceof DomainError && error.code === "ATTACHMENT_NOT_FOUND",
  );
  context.attachments.publicReference = true;
  assert.equal((await handler.execute(attachment.id)).expiresInSeconds, 900);
});

test("Guest upload protection applies the rate limit before human verification", async () => {
  let humanChecks = 0;
  const policy = new ProtectedGuestUploadAccess({
    rateLimiter: {
      consume: async () => ({ allowed: false, retryAfterSeconds: 42 }),
    },
    humanVerification: {
      verify: async () => {
        humanChecks += 1;
        return true;
      },
    },
    clock: new Services(),
    limit: 10,
    windowSeconds: 900,
  });

  await assert.rejects(
    policy.assertAllowed({ clientAddress: "127.0.0.1", humanVerificationToken: "captcha" }),
    (error: unknown) => error instanceof DomainError
      && error.code === "RATE_LIMIT_EXCEEDED"
      && error.details.retryAfterSeconds === 42,
  );
  assert.equal(humanChecks, 0);
});

test("Expired unclaimed guest attachments are marked before their object and row are removed", async () => {
  const context = fixture();
  const attachment = Attachment.requestGuestUpload({
    id: "attachment-1",
    originalFileName: "abandoned.pdf",
    contentType: "application/pdf",
    sizeBytes: 1024,
    storageKey: "guest-attachments/attachment-1",
    guestClaimTokenHash: "claim-hash",
    createdAt: new Date("2026-01-01T09:00:00.000Z"),
    expiresAt: new Date("2026-01-01T09:15:00.000Z"),
  });
  context.attachments.items.set(attachment.id, attachment);
  const cleanup = new CleanupExpiredGuestAttachmentsHandler({
    attachments: context.attachments,
    storage: context.storage,
    transactions: context.services,
    clock: context.services,
    unclaimedRetentionMs: 0,
  });

  assert.equal(await cleanup.execute("worker-1", 10), 1);
  assert.equal(context.attachments.items.has(attachment.id), false);
  assert.deepEqual(context.storage.deletedKeys, ["guest-attachments/attachment-1"]);
});
