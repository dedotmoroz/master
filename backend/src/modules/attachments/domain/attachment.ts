import { AggregateRoot } from "../../../shared/domain/domain-event.ts";
import { assertDomain } from "../../../shared/domain/domain-error.ts";
import { assertEntityId, assertNonBlank } from "../../../shared/domain/value-objects.ts";

export type AttachmentPurpose = "profile_avatar" | "portfolio" | "guest_order" | "order";
export type AttachmentStatus = "pending_upload" | "processing" | "ready" | "rejected" | "cleanup_pending";

export type AttachmentSnapshot = Readonly<{
  id: string;
  ownerId: string | null;
  purpose: AttachmentPurpose;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  status: AttachmentStatus;
  createdAt: Date;
  expiresAt: Date;
  uploadedAt: Date | null;
  processedAt: Date | null;
  safeStorageKey: string | null;
  safeContentType: string | null;
  safeSizeBytes: number | null;
  previewStorageKey: string | null;
  rejectionReason: string | null;
  guestClaimTokenHash: string | null;
  claimedSubmissionId: string | null;
}>;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PORTFOLIO_TYPES = new Set([...IMAGE_TYPES, "application/pdf"]);
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_PORTFOLIO_BYTES = 20 * 1024 * 1024;

function validateFile(purpose: AttachmentPurpose, contentType: string, sizeBytes: number): void {
  const allowedTypes = purpose === "profile_avatar" ? IMAGE_TYPES : PORTFOLIO_TYPES;
  const maximum = purpose === "profile_avatar" ? MAX_AVATAR_BYTES : MAX_PORTFOLIO_BYTES;
  assertDomain(allowedTypes.has(contentType), "ATTACHMENT_TYPE_NOT_ALLOWED", "File type is not allowed", {
    purpose,
    contentType,
  });
  assertDomain(
    Number.isSafeInteger(sizeBytes) && sizeBytes > 0 && sizeBytes <= maximum,
    "ATTACHMENT_SIZE_NOT_ALLOWED",
    "File size is not allowed",
    { purpose, maximum },
  );
}

export class Attachment extends AggregateRoot {
  readonly id: string;
  readonly purpose: AttachmentPurpose;
  readonly originalFileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  #ownerId: string | null;
  #status: AttachmentStatus;
  #uploadedAt: Date | null;
  #processedAt: Date | null;
  #safeStorageKey: string | null;
  #safeContentType: string | null;
  #safeSizeBytes: number | null;
  #previewStorageKey: string | null;
  #rejectionReason: string | null;
  #guestClaimTokenHash: string | null;
  #claimedSubmissionId: string | null;

  private constructor(snapshot: AttachmentSnapshot) {
    super();
    this.id = assertEntityId(snapshot.id, "attachmentId");
    this.#ownerId = snapshot.ownerId === null ? null : assertEntityId(snapshot.ownerId, "ownerId");
    this.purpose = snapshot.purpose;
    this.originalFileName = assertNonBlank(snapshot.originalFileName, "originalFileName", 255);
    this.contentType = assertNonBlank(snapshot.contentType.toLowerCase(), "contentType", 100);
    validateFile(this.purpose, this.contentType, snapshot.sizeBytes);
    this.sizeBytes = snapshot.sizeBytes;
    this.storageKey = assertNonBlank(snapshot.storageKey, "storageKey", 500);
    this.createdAt = new Date(snapshot.createdAt);
    this.expiresAt = new Date(snapshot.expiresAt);
    this.#status = snapshot.status;
    this.#uploadedAt = snapshot.uploadedAt ? new Date(snapshot.uploadedAt) : null;
    this.#processedAt = snapshot.processedAt ? new Date(snapshot.processedAt) : null;
    this.#safeStorageKey = snapshot.safeStorageKey === null
      ? null
      : assertNonBlank(snapshot.safeStorageKey, "safeStorageKey", 500);
    this.#safeContentType = snapshot.safeContentType === null
      ? null
      : assertNonBlank(snapshot.safeContentType.toLowerCase(), "safeContentType", 100);
    this.#safeSizeBytes = snapshot.safeSizeBytes;
    this.#previewStorageKey = snapshot.previewStorageKey === null
      ? null
      : assertNonBlank(snapshot.previewStorageKey, "previewStorageKey", 500);
    this.#rejectionReason = snapshot.rejectionReason === null
      ? null
      : assertNonBlank(snapshot.rejectionReason, "rejectionReason", 500);
    this.#guestClaimTokenHash = snapshot.guestClaimTokenHash === null
      ? null
      : assertNonBlank(snapshot.guestClaimTokenHash, "guestClaimTokenHash", 200);
    this.#claimedSubmissionId = snapshot.claimedSubmissionId === null
      ? null
      : assertEntityId(snapshot.claimedSubmissionId, "claimedSubmissionId");
    if (this.purpose === "guest_order") {
      assertDomain(
        (this.#ownerId === null && this.#guestClaimTokenHash !== null)
          || (this.#ownerId !== null && this.#guestClaimTokenHash === null),
        "INVALID_GUEST_ATTACHMENT_OWNERSHIP",
        "Guest attachment ownership is invalid",
      );
    } else {
      assertDomain(
        this.#ownerId !== null && this.#guestClaimTokenHash === null && this.#claimedSubmissionId === null,
        "INVALID_ATTACHMENT_OWNERSHIP",
        "Account attachment ownership is invalid",
      );
    }
    if (this.#status === "pending_upload") {
      assertDomain(this.#uploadedAt === null && this.#processedAt === null, "INVALID_ATTACHMENT_STATUS", "Attachment status is invalid");
    } else if (this.#status === "processing") {
      assertDomain(this.#uploadedAt !== null && this.#processedAt === null, "INVALID_ATTACHMENT_STATUS", "Attachment status is invalid");
    } else if (this.#status === "ready") {
      assertDomain(
        this.#uploadedAt !== null
          && this.#processedAt !== null
          && this.#safeStorageKey !== null
          && this.#safeContentType !== null
          && this.#safeSizeBytes !== null
          && Number.isSafeInteger(this.#safeSizeBytes)
          && this.#safeSizeBytes > 0,
        "INVALID_ATTACHMENT_STATUS",
        "Attachment status is invalid",
      );
    } else if (this.#status === "rejected") {
      assertDomain(
        this.#uploadedAt !== null && this.#processedAt !== null && this.#rejectionReason !== null,
        "INVALID_ATTACHMENT_STATUS",
        "Attachment status is invalid",
      );
    }
  }

  static requestUpload(input: Readonly<{
    id: string;
    ownerId: string;
    purpose: AttachmentPurpose;
    originalFileName: string;
    contentType: string;
    sizeBytes: number;
    storageKey: string;
    createdAt: Date;
    expiresAt: Date;
  }>): Attachment {
    assertDomain(input.expiresAt.getTime() > input.createdAt.getTime(), "INVALID_ATTACHMENT_EXPIRY", "Upload expiry is invalid");
    assertDomain(input.purpose !== "guest_order", "INVALID_ATTACHMENT_PURPOSE", "Guest uploads require a claim token");
    const attachment = new Attachment({
      ...input,
      status: "pending_upload",
      uploadedAt: null,
      processedAt: null,
      safeStorageKey: null,
      safeContentType: null,
      safeSizeBytes: null,
      previewStorageKey: null,
      rejectionReason: null,
      guestClaimTokenHash: null,
      claimedSubmissionId: null,
    });
    attachment.record({
      name: "AttachmentUploadRequested",
      aggregateId: attachment.id,
      occurredAt: input.createdAt,
      payload: { ownerId: attachment.ownerId, purpose: attachment.purpose },
    });
    return attachment;
  }

  static requestGuestUpload(input: Readonly<{
    id: string;
    originalFileName: string;
    contentType: string;
    sizeBytes: number;
    storageKey: string;
    guestClaimTokenHash: string;
    createdAt: Date;
    expiresAt: Date;
  }>): Attachment {
    assertDomain(input.expiresAt.getTime() > input.createdAt.getTime(), "INVALID_ATTACHMENT_EXPIRY", "Upload expiry is invalid");
    const attachment = new Attachment({
      ...input,
      ownerId: null,
      purpose: "guest_order",
      status: "pending_upload",
      uploadedAt: null,
      processedAt: null,
      safeStorageKey: null,
      safeContentType: null,
      safeSizeBytes: null,
      previewStorageKey: null,
      rejectionReason: null,
      claimedSubmissionId: null,
    });
    attachment.record({
      name: "GuestAttachmentUploadRequested",
      aggregateId: attachment.id,
      occurredAt: input.createdAt,
      payload: { purpose: attachment.purpose },
    });
    return attachment;
  }

  static restore(snapshot: AttachmentSnapshot): Attachment {
    return new Attachment(snapshot);
  }

  get status(): AttachmentStatus {
    return this.#status;
  }

  get ownerId(): string | null {
    return this.#ownerId;
  }

  get claimedSubmissionId(): string | null {
    return this.#claimedSubmissionId;
  }

  get safeStorageKey(): string | null {
    return this.#safeStorageKey;
  }

  get previewStorageKey(): string | null {
    return this.#previewStorageKey;
  }

  get safeContentType(): string | null {
    return this.#safeContentType;
  }

  matchesGuestClaim(tokenHash: string): boolean {
    return this.purpose === "guest_order" && this.#guestClaimTokenHash === tokenHash;
  }

  confirmUpload(actual: Readonly<{ contentType: string; sizeBytes: number }>, occurredAt: Date): void {
    if (this.#status !== "pending_upload") return;
    assertDomain(this.#status === "pending_upload", "ATTACHMENT_NOT_USABLE", "Attachment is being removed");
    assertDomain(occurredAt.getTime() <= this.expiresAt.getTime(), "ATTACHMENT_UPLOAD_EXPIRED", "Upload request has expired");
    assertDomain(
      actual.contentType.toLowerCase() === this.contentType && actual.sizeBytes === this.sizeBytes,
      "ATTACHMENT_MISMATCH",
      "Uploaded file does not match the declared metadata",
    );
    this.#status = "processing";
    this.#uploadedAt = new Date(occurredAt);
    this.record({
      name: "AttachmentProcessingRequested",
      aggregateId: this.id,
      occurredAt,
      payload: { ownerId: this.ownerId, purpose: this.purpose },
    });
  }

  markReady(result: Readonly<{
    storageKey: string;
    contentType: string;
    sizeBytes: number;
    previewStorageKey: string | null;
  }>, occurredAt: Date): void {
    if (this.#status === "ready") return;
    assertDomain(this.#status === "processing", "ATTACHMENT_NOT_PROCESSING", "Attachment is not awaiting processing");
    this.#safeStorageKey = assertNonBlank(result.storageKey, "safeStorageKey", 500);
    this.#safeContentType = assertNonBlank(result.contentType.toLowerCase(), "safeContentType", 100);
    assertDomain(Number.isSafeInteger(result.sizeBytes) && result.sizeBytes > 0, "INVALID_ATTACHMENT_SIZE", "Processed attachment size is invalid");
    this.#safeSizeBytes = result.sizeBytes;
    this.#previewStorageKey = result.previewStorageKey === null
      ? null
      : assertNonBlank(result.previewStorageKey, "previewStorageKey", 500);
    this.#processedAt = new Date(occurredAt);
    this.#rejectionReason = null;
    this.#status = "ready";
    this.record({
      name: "AttachmentReady",
      aggregateId: this.id,
      occurredAt,
      payload: { ownerId: this.ownerId, purpose: this.purpose },
    });
  }

  reject(reason: string, occurredAt: Date): void {
    if (this.#status === "rejected") return;
    assertDomain(this.#status === "processing", "ATTACHMENT_NOT_PROCESSING", "Attachment is not awaiting processing");
    this.#rejectionReason = assertNonBlank(reason, "rejectionReason", 500);
    this.#processedAt = new Date(occurredAt);
    this.#safeStorageKey = null;
    this.#safeContentType = null;
    this.#safeSizeBytes = null;
    this.#previewStorageKey = null;
    this.#status = "rejected";
    this.record({
      name: "AttachmentRejected",
      aggregateId: this.id,
      occurredAt,
      payload: { ownerId: this.ownerId, purpose: this.purpose, reason: this.#rejectionReason },
    });
  }

  markForCleanup(occurredAt: Date): void {
    if (this.#status === "cleanup_pending") return;
    assertDomain(
      this.purpose === "guest_order"
        && this.#ownerId === null
        && this.#claimedSubmissionId === null
        && occurredAt.getTime() > this.expiresAt.getTime(),
      "ATTACHMENT_NOT_CLEANABLE",
      "Attachment is not eligible for cleanup",
    );
    this.#status = "cleanup_pending";
  }

  markUnusedAccountForCleanup(occurredAt: Date): void {
    assertDomain(this.#ownerId !== null && occurredAt > this.expiresAt,
      "ATTACHMENT_NOT_EXPIRED", "Only expired account uploads can be cleaned");
    this.#status = "cleanup_pending";
  }

  reserveForSubmission(tokenHash: string, submissionId: string, occurredAt: Date): void {
    assertDomain(this.purpose === "guest_order" && this.#ownerId === null, "ATTACHMENT_NOT_USABLE", "Attachment cannot be used for a guest order");
    assertDomain(this.#status === "ready", "ATTACHMENT_NOT_USABLE", "Attachment is not ready");
    assertDomain(this.matchesGuestClaim(tokenHash), "ATTACHMENT_NOT_FOUND", "Attachment was not found");
    const normalizedSubmissionId = assertEntityId(submissionId, "submissionId");
    assertDomain(
      this.#claimedSubmissionId === null || this.#claimedSubmissionId === normalizedSubmissionId,
      "GUEST_ATTACHMENT_ALREADY_CLAIMED",
      "Attachment is already reserved for another order",
    );
    if (this.#claimedSubmissionId === normalizedSubmissionId) return;
    this.#claimedSubmissionId = normalizedSubmissionId;
    this.record({
      name: "GuestAttachmentReserved",
      aggregateId: this.id,
      occurredAt,
      payload: { submissionId: normalizedSubmissionId },
    });
  }

  assignToOwner(ownerId: string, submissionId: string, occurredAt: Date): void {
    const normalizedOwnerId = assertEntityId(ownerId, "ownerId");
    const normalizedSubmissionId = assertEntityId(submissionId, "submissionId");
    if (this.#ownerId !== null) {
      assertDomain(
        this.#ownerId === normalizedOwnerId && this.#claimedSubmissionId === normalizedSubmissionId,
        "ATTACHMENT_NOT_USABLE",
        "Attachment belongs to another account or order",
      );
      return;
    }
    assertDomain(
      this.purpose === "guest_order" && this.#status === "ready" && this.#claimedSubmissionId === normalizedSubmissionId,
      "ATTACHMENT_NOT_USABLE",
      "Attachment is not reserved for this order",
    );
    this.#ownerId = normalizedOwnerId;
    this.#guestClaimTokenHash = null;
    this.record({
      name: "GuestAttachmentOwnershipAssigned",
      aggregateId: this.id,
      occurredAt,
      payload: { ownerId: normalizedOwnerId, submissionId: normalizedSubmissionId },
    });
  }

  toSnapshot(): AttachmentSnapshot {
    return {
      id: this.id,
      ownerId: this.#ownerId,
      purpose: this.purpose,
      originalFileName: this.originalFileName,
      contentType: this.contentType,
      sizeBytes: this.sizeBytes,
      storageKey: this.storageKey,
      status: this.#status,
      createdAt: new Date(this.createdAt),
      expiresAt: new Date(this.expiresAt),
      uploadedAt: this.#uploadedAt ? new Date(this.#uploadedAt) : null,
      processedAt: this.#processedAt ? new Date(this.#processedAt) : null,
      safeStorageKey: this.#safeStorageKey,
      safeContentType: this.#safeContentType,
      safeSizeBytes: this.#safeSizeBytes,
      previewStorageKey: this.#previewStorageKey,
      rejectionReason: this.#rejectionReason,
      guestClaimTokenHash: this.#guestClaimTokenHash,
      claimedSubmissionId: this.#claimedSubmissionId,
    };
  }
}
