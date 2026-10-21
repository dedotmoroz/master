import assert from "node:assert/strict";
import test from "node:test";
import { Attachment } from "../../src/modules/attachments/domain/attachment.ts";
import { DomainError } from "../../src/shared/domain/domain-error.ts";

const createdAt = new Date("2026-01-01T10:00:00.000Z");
const expiresAt = new Date("2026-01-01T10:15:00.000Z");

function pending() {
  return Attachment.requestUpload({
    id: "attachment-1",
    ownerId: "account-1",
    purpose: "portfolio",
    originalFileName: "house.webp",
    contentType: "image/webp",
    sizeBytes: 1_024,
    storageKey: "attachments/account-1/attachment-1",
    createdAt,
    expiresAt,
  });
}

test("Attachment confirms metadata and becomes ready only after processing", () => {
  const attachment = pending();
  attachment.pullEvents();

  attachment.confirmUpload(
    { contentType: "image/webp", sizeBytes: 1_024 },
    new Date("2026-01-01T10:01:00.000Z"),
  );
  attachment.confirmUpload(
    { contentType: "image/webp", sizeBytes: 1_024 },
    new Date("2026-01-01T10:02:00.000Z"),
  );

  assert.equal(attachment.status, "processing");
  assert.equal(attachment.pullEvents().filter((event) => event.name === "AttachmentProcessingRequested").length, 1);
  attachment.markReady({
    storageKey: "processed-attachments/attachment-1/image.webp",
    contentType: "image/webp",
    sizeBytes: 800,
    previewStorageKey: "processed-attachments/attachment-1/preview.webp",
  }, new Date("2026-01-01T10:03:00.000Z"));
  assert.equal(attachment.status, "ready");
});

test("Attachment rejects mismatched and expired uploads", () => {
  assert.throws(
    () => pending().confirmUpload(
      { contentType: "image/jpeg", sizeBytes: 1_024 },
      new Date("2026-01-01T10:01:00.000Z"),
    ),
    (error: unknown) => error instanceof DomainError && error.code === "ATTACHMENT_MISMATCH",
  );
  assert.throws(
    () => pending().confirmUpload(
      { contentType: "image/webp", sizeBytes: 1_024 },
      new Date("2026-01-01T10:16:00.000Z"),
    ),
    (error: unknown) => error instanceof DomainError && error.code === "ATTACHMENT_UPLOAD_EXPIRED",
  );
});

test("Avatar accepts images up to five MiB and rejects PDFs", () => {
  assert.throws(
    () => Attachment.requestUpload({
      id: "attachment-1",
      ownerId: "account-1",
      purpose: "profile_avatar",
      originalFileName: "resume.pdf",
      contentType: "application/pdf",
      sizeBytes: 1_024,
      storageKey: "attachments/account-1/attachment-1",
      createdAt,
      expiresAt,
    }),
    (error: unknown) => error instanceof DomainError && error.code === "ATTACHMENT_TYPE_NOT_ALLOWED",
  );
});

test("Guest attachment can be reserved once and transferred to the confirmed customer", () => {
  const attachment = Attachment.requestGuestUpload({
    id: "attachment-1",
    originalFileName: "plan.pdf",
    contentType: "application/pdf",
    sizeBytes: 1_024,
    storageKey: "guest-attachments/attachment-1",
    guestClaimTokenHash: "claim-hash",
    createdAt,
    expiresAt,
  });
  attachment.confirmUpload(
    { contentType: "application/pdf", sizeBytes: 1_024 },
    new Date("2026-01-01T10:01:00.000Z"),
  );
  attachment.markReady({
    storageKey: attachment.storageKey,
    contentType: "application/pdf",
    sizeBytes: 1_024,
    previewStorageKey: null,
  }, new Date("2026-01-01T10:02:00.000Z"));
  attachment.reserveForSubmission("claim-hash", "submission-1", createdAt);
  attachment.assignToOwner("account-1", "submission-1", createdAt);

  assert.equal(attachment.ownerId, "account-1");
  assert.equal(attachment.toSnapshot().guestClaimTokenHash, null);
  assert.throws(
    () => attachment.assignToOwner("account-2", "submission-1", createdAt),
    (error: unknown) => error instanceof DomainError && error.code === "ATTACHMENT_NOT_USABLE",
  );
});
