import type { Attachment } from "../../domain/attachment.ts";

export interface AttachmentRepository {
  save(attachment: Attachment): Promise<void>;
  findById(
    attachmentId: string,
    options?: Readonly<{ forUpdate?: boolean }>,
  ): Promise<Attachment | null>;
  findByIds(attachmentIds: readonly string[], options?: Readonly<{ forUpdate?: boolean }>): Promise<readonly Attachment[]>;
  isPubliclyReferenced(attachmentId: string): Promise<boolean>;
  findGuestCleanupCandidates(cutoff: Date, limit: number): Promise<readonly Attachment[]>;
  deleteCleanupPending(attachmentId: string): Promise<void>;
}

export interface UnusedAccountAttachments {
  // Called within a transaction; candidates are locked until commit.
  observeUnreferenced(now: Date, limit: number): Promise<void>;
  findCandidates(cutoff: Date, limit: number): Promise<readonly Attachment[]>;
  isReferenced(attachmentId: string): Promise<boolean>;
}

export type StoredObjectMetadata = Readonly<{
  contentType: string;
  sizeBytes: number;
}>;

export class ObjectSizeLimitExceededError extends Error {
  constructor() {
    super("Stored object exceeds its allowed size");
    this.name = "ObjectSizeLimitExceededError";
  }
}

export interface ObjectStorage {
  createUploadUrl(input: Readonly<{
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }>): Promise<Readonly<{ url: string; headers: Readonly<Record<string, string>> }>>;
  stat(key: string): Promise<StoredObjectMetadata | null>;
  get(key: string, maximumBytes: number): Promise<Buffer>;
  put(input: Readonly<{ key: string; contentType: string; body: Buffer }>): Promise<void>;
  createDownloadUrl(input: Readonly<{
    key: string;
    fileName: string;
    expiresInSeconds: number;
    disposition: "inline" | "attachment";
  }>): Promise<string>;
  delete(key: string): Promise<void>;
}

export type MalwareScanResult =
  | Readonly<{ clean: true }>
  | Readonly<{ clean: false; threat: string }>;

export interface MalwareScanner {
  scan(content: Buffer): Promise<MalwareScanResult>;
}

export type SanitizedImage = Readonly<{
  content: Buffer;
  preview: Buffer;
  contentType: "image/webp";
}>;

export interface ImageSanitizer {
  sanitize(content: Buffer): Promise<SanitizedImage>;
}

export interface AttachmentUsagePolicy {
  assertUsable(
    ownerId: string,
    attachmentIds: readonly string[],
    purpose: "profile_avatar" | "portfolio" | "order",
  ): Promise<void>;
}

export type GuestAttachmentClaim = Readonly<{
  attachmentId: string;
  claimToken: string;
}>;

export interface GuestAttachmentClaims {
  reserveForSubmission(
    submissionId: string,
    claims: readonly GuestAttachmentClaim[],
  ): Promise<readonly string[]>;
  assignToAccount(
    submissionId: string,
    accountId: string,
    attachmentIds: readonly string[],
  ): Promise<void>;
}

export interface PublicRateLimiter {
  consume(input: Readonly<{
    action: string;
    clientAddress: string;
    limit: number;
    windowSeconds: number;
    occurredAt: Date;
  }>): Promise<Readonly<{ allowed: boolean; retryAfterSeconds: number }>>;
}

export interface HumanVerification {
  verify(input: Readonly<{
    token: string | null;
    clientAddress: string;
    expectedAction: string;
  }>): Promise<boolean>;
}

export interface GuestUploadAccessPolicy {
  assertAllowed(input: Readonly<{
    clientAddress: string;
    humanVerificationToken: string | null;
  }>): Promise<void>;
}
