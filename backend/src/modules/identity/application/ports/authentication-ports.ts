import type { Email } from "../../../../shared/domain/value-objects.ts";
import type { EmailAuthRequest, EmailAuthPurpose } from "../../domain/email-auth-request.ts";

export interface EmailAuthRequestRepository {
  save(request: EmailAuthRequest): Promise<void>;
  findById(requestId: string): Promise<EmailAuthRequest | null>;
  findByTokenHash(tokenHash: string, options?: Readonly<{ forUpdate?: boolean }>): Promise<EmailAuthRequest | null>;
  revokePending(email: Email, purpose: EmailAuthPurpose, occurredAt: Date): Promise<void>;
}

export interface AuthenticationEmailSender {
  sendAuthenticationLink(input: Readonly<{
    email: string;
    purpose: EmailAuthPurpose;
    rawToken: string;
    expiresAt: Date;
  }>): Promise<void>;
}

export interface AuthenticationRequestAccessPolicy {
  assertAllowed(input: Readonly<{ clientAddress: string; email: Email }>): Promise<void>;
}

export interface SessionManager {
  issue(accountId: string): Promise<string>;
  revoke(rawToken: string, occurredAt: Date): Promise<void>;
  revokeAll(accountId: string, occurredAt: Date): Promise<void>;
}
