import { assertDomain } from "../../../shared/domain/domain-error.ts";
import type {
  AccountRepository,
  Clock,
  IdGenerator,
  TransactionManager,
  VerificationTokenService,
} from "../../marketplace/application/ports/guest-order-ports.ts";
import { Attachment, type AttachmentPurpose, type AttachmentSnapshot } from "../domain/attachment.ts";
import type {
  AttachmentRepository,
  AttachmentUsagePolicy,
  GuestAttachmentClaim,
  GuestAttachmentClaims,
  ObjectStorage,
} from "./ports/attachment-ports.ts";

export type RequestAttachmentUploadCommand = Readonly<{
  ownerId: string;
  purpose: Exclude<AttachmentPurpose, "guest_order">;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
}>;

export type AttachmentUploadRequest = Readonly<{
  attachment: AttachmentSnapshot;
  uploadUrl: string;
  uploadHeaders: Readonly<Record<string, string>>;
}>;

export type RequestGuestAttachmentUploadCommand = Readonly<{
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
}>;

export type GuestAttachmentUploadRequest = AttachmentUploadRequest & Readonly<{
  claimToken: string;
}>;

export class RequestAttachmentUploadHandler {
  readonly #accounts: AccountRepository;
  readonly #attachments: AttachmentRepository;
  readonly #storage: ObjectStorage;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;
  readonly #transactions: TransactionManager;
  readonly #uploadUrlTtlSeconds: number;

  constructor(dependencies: Readonly<{
    accounts: AccountRepository;
    attachments: AttachmentRepository;
    storage: ObjectStorage;
    ids: IdGenerator;
    clock: Clock;
    transactions: TransactionManager;
    uploadUrlTtlSeconds: number;
  }>) {
    this.#accounts = dependencies.accounts;
    this.#attachments = dependencies.attachments;
    this.#storage = dependencies.storage;
    this.#ids = dependencies.ids;
    this.#clock = dependencies.clock;
    this.#transactions = dependencies.transactions;
    this.#uploadUrlTtlSeconds = dependencies.uploadUrlTtlSeconds;
  }

  async execute(command: RequestAttachmentUploadCommand): Promise<AttachmentUploadRequest> {
    const attachment = await this.#transactions.execute(async () => {
      const account = await this.#accounts.findById(command.ownerId, { forUpdate: true });
      assertDomain(account !== null && account.status === "active", "ACCOUNT_NOT_ACTIVE", "Account is not active");
      const id = this.#ids.next();
      const now = this.#clock.now();
      const expiresAt = new Date(now.getTime() + this.#uploadUrlTtlSeconds * 1_000);
      const created = Attachment.requestUpload({
        id,
        ownerId: account.id,
        purpose: command.purpose,
        originalFileName: command.originalFileName,
        contentType: command.contentType,
        sizeBytes: command.sizeBytes,
        storageKey: `attachments/${account.id}/${id}`,
        createdAt: now,
        expiresAt,
      });
      await this.#attachments.save(created);
      return created;
    });
    const signed = await this.#storage.createUploadUrl({
      key: attachment.storageKey,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      expiresInSeconds: this.#uploadUrlTtlSeconds,
    });
    return {
      attachment: attachment.toSnapshot(),
      uploadUrl: signed.url,
      uploadHeaders: signed.headers,
    };
  }
}

export class ConfirmAttachmentUploadHandler {
  readonly #attachments: AttachmentRepository;
  readonly #storage: ObjectStorage;
  readonly #clock: Clock;
  readonly #transactions: TransactionManager;

  constructor(dependencies: Readonly<{
    attachments: AttachmentRepository;
    storage: ObjectStorage;
    clock: Clock;
    transactions: TransactionManager;
  }>) {
    this.#attachments = dependencies.attachments;
    this.#storage = dependencies.storage;
    this.#clock = dependencies.clock;
    this.#transactions = dependencies.transactions;
  }

  async execute(ownerId: string, attachmentId: string): Promise<AttachmentSnapshot> {
    const current = await this.#attachments.findById(attachmentId);
    assertDomain(
      current !== null && current.ownerId === ownerId,
      "ATTACHMENT_NOT_FOUND",
      "Attachment was not found",
    );
    if (current.status !== "pending_upload") return current.toSnapshot();
    const metadata = await this.#storage.stat(current.storageKey);
    assertDomain(metadata !== null, "ATTACHMENT_OBJECT_NOT_FOUND", "Uploaded object was not found");
    return this.#transactions.execute(async () => {
      const attachment = await this.#attachments.findById(attachmentId, { forUpdate: true });
      assertDomain(
        attachment !== null && attachment.ownerId === ownerId,
        "ATTACHMENT_NOT_FOUND",
        "Attachment was not found",
      );
      attachment.confirmUpload(metadata, this.#clock.now());
      await this.#attachments.save(attachment);
      return attachment.toSnapshot();
    });
  }
}

export class RequestGuestAttachmentUploadHandler {
  readonly #attachments: AttachmentRepository;
  readonly #storage: ObjectStorage;
  readonly #tokens: VerificationTokenService;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;
  readonly #transactions: TransactionManager;
  readonly #uploadUrlTtlSeconds: number;

  constructor(dependencies: Readonly<{
    attachments: AttachmentRepository;
    storage: ObjectStorage;
    tokens: VerificationTokenService;
    ids: IdGenerator;
    clock: Clock;
    transactions: TransactionManager;
    uploadUrlTtlSeconds: number;
  }>) {
    this.#attachments = dependencies.attachments;
    this.#storage = dependencies.storage;
    this.#tokens = dependencies.tokens;
    this.#ids = dependencies.ids;
    this.#clock = dependencies.clock;
    this.#transactions = dependencies.transactions;
    this.#uploadUrlTtlSeconds = dependencies.uploadUrlTtlSeconds;
  }

  async execute(command: RequestGuestAttachmentUploadCommand): Promise<GuestAttachmentUploadRequest> {
    const id = this.#ids.next();
    const issuedToken = this.#tokens.issue(`guest-attachment:${id}`);
    const attachment = await this.#transactions.execute(async () => {
      const now = this.#clock.now();
      const created = Attachment.requestGuestUpload({
        id,
        originalFileName: command.originalFileName,
        contentType: command.contentType,
        sizeBytes: command.sizeBytes,
        storageKey: `guest-attachments/${id}`,
        guestClaimTokenHash: issuedToken.hash,
        createdAt: now,
        expiresAt: new Date(now.getTime() + this.#uploadUrlTtlSeconds * 1_000),
      });
      await this.#attachments.save(created);
      return created;
    });
    const signed = await this.#storage.createUploadUrl({
      key: attachment.storageKey,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      expiresInSeconds: this.#uploadUrlTtlSeconds,
    });
    return {
      attachment: attachment.toSnapshot(),
      claimToken: issuedToken.raw,
      uploadUrl: signed.url,
      uploadHeaders: signed.headers,
    };
  }
}

export class ConfirmGuestAttachmentUploadHandler {
  readonly #attachments: AttachmentRepository;
  readonly #storage: ObjectStorage;
  readonly #tokens: VerificationTokenService;
  readonly #clock: Clock;
  readonly #transactions: TransactionManager;

  constructor(dependencies: Readonly<{
    attachments: AttachmentRepository;
    storage: ObjectStorage;
    tokens: VerificationTokenService;
    clock: Clock;
    transactions: TransactionManager;
  }>) {
    this.#attachments = dependencies.attachments;
    this.#storage = dependencies.storage;
    this.#tokens = dependencies.tokens;
    this.#clock = dependencies.clock;
    this.#transactions = dependencies.transactions;
  }

  async execute(attachmentId: string, rawClaimToken: string): Promise<AttachmentSnapshot> {
    assertDomain(rawClaimToken.trim().length > 0, "ATTACHMENT_NOT_FOUND", "Attachment was not found");
    const tokenHash = this.#tokens.hash(rawClaimToken);
    const current = await this.#attachments.findById(attachmentId);
    assertDomain(
      current !== null && current.ownerId === null && current.matchesGuestClaim(tokenHash),
      "ATTACHMENT_NOT_FOUND",
      "Attachment was not found",
    );
    if (current.status !== "pending_upload") return current.toSnapshot();
    const metadata = await this.#storage.stat(current.storageKey);
    assertDomain(metadata !== null, "ATTACHMENT_OBJECT_NOT_FOUND", "Uploaded object was not found");
    return this.#transactions.execute(async () => {
      const attachment = await this.#attachments.findById(attachmentId, { forUpdate: true });
      assertDomain(
        attachment !== null && attachment.ownerId === null && attachment.matchesGuestClaim(tokenHash),
        "ATTACHMENT_NOT_FOUND",
        "Attachment was not found",
      );
      attachment.confirmUpload(metadata, this.#clock.now());
      await this.#attachments.save(attachment);
      return attachment.toSnapshot();
    });
  }
}

export class GuestAttachmentClaimsService implements GuestAttachmentClaims {
  readonly #attachments: AttachmentRepository;
  readonly #tokens: VerificationTokenService;
  readonly #clock: Clock;

  constructor(dependencies: Readonly<{
    attachments: AttachmentRepository;
    tokens: VerificationTokenService;
    clock: Clock;
  }>) {
    this.#attachments = dependencies.attachments;
    this.#tokens = dependencies.tokens;
    this.#clock = dependencies.clock;
  }

  async reserveForSubmission(
    submissionId: string,
    claims: readonly GuestAttachmentClaim[],
  ): Promise<readonly string[]> {
    assertDomain(claims.length <= 10, "TOO_MANY_ATTACHMENTS", "An order can contain at most 10 attachments");
    const ids = claims.map((claim) => claim.attachmentId);
    assertDomain(new Set(ids).size === ids.length, "DUPLICATE_ATTACHMENTS", "Attachment is used more than once");
    const claimById = new Map(claims.map((claim) => [claim.attachmentId, claim]));
    const now = this.#clock.now();
    for (const attachmentId of [...ids].sort()) {
      const claim = claimById.get(attachmentId) as GuestAttachmentClaim;
      const tokenHash = this.#tokens.hash(claim.claimToken);
      const attachment = await this.#attachments.findById(attachmentId, { forUpdate: true });
      assertDomain(
        attachment !== null && attachment.matchesGuestClaim(tokenHash),
        "ATTACHMENT_NOT_FOUND",
        "Attachment was not found",
      );
      attachment.reserveForSubmission(tokenHash, submissionId, now);
      await this.#attachments.save(attachment);
    }
    return ids;
  }

  async assignToAccount(
    submissionId: string,
    accountId: string,
    attachmentIds: readonly string[],
  ): Promise<void> {
    const now = this.#clock.now();
    for (const attachmentId of [...attachmentIds].sort()) {
      const attachment = await this.#attachments.findById(attachmentId, { forUpdate: true });
      assertDomain(attachment !== null, "ATTACHMENT_NOT_USABLE", "Attachment was not found");
      attachment.assignToOwner(accountId, submissionId, now);
      await this.#attachments.save(attachment);
    }
  }
}

export class GetPublicAttachmentUrlHandler {
  readonly #attachments: AttachmentRepository;
  readonly #storage: ObjectStorage;
  readonly #downloadUrlTtlSeconds: number;

  constructor(dependencies: Readonly<{
    attachments: AttachmentRepository;
    storage: ObjectStorage;
    downloadUrlTtlSeconds: number;
  }>) {
    this.#attachments = dependencies.attachments;
    this.#storage = dependencies.storage;
    this.#downloadUrlTtlSeconds = dependencies.downloadUrlTtlSeconds;
  }

  async execute(attachmentId: string, ownerId?: string): Promise<Readonly<{
    url: string;
    expiresInSeconds: number;
    contentType: string;
  }>> {
    const attachment = await this.#attachments.findById(attachmentId);
    const isReferenced = attachment && attachment.status === "ready"
      ? ownerId === undefined ? await this.#attachments.isPubliclyReferenced(attachmentId) : attachment.ownerId === ownerId
      : false;
    assertDomain(attachment !== null && isReferenced, "ATTACHMENT_NOT_FOUND", "Attachment was not found");
    assertDomain(attachment.safeStorageKey !== null && attachment.safeContentType !== null, "ATTACHMENT_NOT_FOUND", "Attachment was not found");
    const url = await this.#storage.createDownloadUrl({
      key: attachment.safeStorageKey,
      fileName: attachment.originalFileName,
      expiresInSeconds: this.#downloadUrlTtlSeconds,
      disposition: attachment.safeContentType === "application/pdf" ? "attachment" : "inline",
    });
    return { url, expiresInSeconds: this.#downloadUrlTtlSeconds, contentType: attachment.safeContentType };
  }
}

export class GetPublicAttachmentPreviewUrlHandler {
  readonly #attachments: AttachmentRepository;
  readonly #storage: ObjectStorage;
  readonly #downloadUrlTtlSeconds: number;

  constructor(dependencies: Readonly<{
    attachments: AttachmentRepository;
    storage: ObjectStorage;
    downloadUrlTtlSeconds: number;
  }>) {
    this.#attachments = dependencies.attachments;
    this.#storage = dependencies.storage;
    this.#downloadUrlTtlSeconds = dependencies.downloadUrlTtlSeconds;
  }

  async execute(attachmentId: string, ownerId?: string): Promise<Readonly<{
    url: string;
    expiresInSeconds: number;
    contentType: "image/webp";
  }>> {
    const attachment = await this.#attachments.findById(attachmentId);
    const isReferenced = attachment?.status === "ready" && attachment.previewStorageKey !== null
      ? ownerId === undefined ? await this.#attachments.isPubliclyReferenced(attachmentId) : attachment.ownerId === ownerId
      : false;
    assertDomain(attachment !== null && attachment.previewStorageKey !== null && isReferenced, "ATTACHMENT_NOT_FOUND", "Attachment was not found");
    const url = await this.#storage.createDownloadUrl({
      key: attachment.previewStorageKey,
      fileName: `${attachment.id}-preview.webp`,
      expiresInSeconds: this.#downloadUrlTtlSeconds,
      disposition: "inline",
    });
    return { url, expiresInSeconds: this.#downloadUrlTtlSeconds, contentType: "image/webp" };
  }
}

export class UploadedAttachmentUsagePolicy implements AttachmentUsagePolicy {
  readonly #attachments: AttachmentRepository;

  constructor(attachments: AttachmentRepository) {
    this.#attachments = attachments;
  }

  async assertUsable(
    ownerId: string,
    attachmentIds: readonly string[],
    purpose: Exclude<AttachmentPurpose, "guest_order">,
  ): Promise<void> {
    if (attachmentIds.length === 0) return;
    const unique = new Set(attachmentIds);
    assertDomain(unique.size === attachmentIds.length, "DUPLICATE_ATTACHMENTS", "Attachment is used more than once");
    const attachments = await this.#attachments.findByIds(attachmentIds, { forUpdate: true });
    const usable = attachments.length === attachmentIds.length
      && attachments.every((attachment) =>
        attachment.ownerId === ownerId
        && (attachment.purpose === purpose || (purpose === "order" && attachment.purpose === "guest_order"))
        && attachment.status === "ready");
    assertDomain(usable, "ATTACHMENT_NOT_USABLE", "Attachment is not ready or belongs to another account");
  }
}
