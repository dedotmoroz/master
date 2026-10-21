import { assertDomain } from "../../../shared/domain/domain-error.ts";
import type { AccountRepository, Clock, IdGenerator, TransactionManager, VerificationTokenService } from "../../marketplace/application/ports/guest-order-ports.ts";
import type { AuthenticationRequestAccessPolicy, EmailAuthRequestRepository, SessionManager } from "./ports/authentication-ports.ts";
import type { EmailChangeRepository } from "./email-change.ts";
import { AccountDeletionRequest } from "../domain/account-deletion-request.ts";
import type { ObjectStorage } from "../../attachments/application/ports/attachment-ports.ts";

export interface AccountDeletionRepository {
  save(request: AccountDeletionRequest): Promise<void>;
  revokePending(accountId: string): Promise<void>;
  findById(id: string): Promise<AccountDeletionRequest | null>;
  findByTokenHash(hash: string, options?: Readonly<{ forUpdate?: boolean }>): Promise<AccountDeletionRequest | null>;
}

export interface AccountErasure {
  hasOngoingOrders(accountId: string): Promise<boolean>;
  erasePersonalData(accountId: string, previousEmail: string, anonymousEmail: string, occurredAt: Date): Promise<void>;
}

export interface AccountDeletionEmailSender {
  sendAccountDeletionLink(input: Readonly<{ email: string; rawToken: string; expiresAt: Date }>): Promise<void>;
}

export interface AccountErasureCleanup {
  eraseHistory(accountId: string): Promise<void>;
  files(accountId: string): Promise<readonly Readonly<{ id: string; expired: boolean; keys: readonly string[] }>[]>;
  removeFile(id: string): Promise<void>;
}

export class CleanupDeletedAccountHandler {
  readonly #cleanup: AccountErasureCleanup;
  readonly #storage: ObjectStorage;
  constructor(cleanup: AccountErasureCleanup, storage: ObjectStorage) { this.#cleanup = cleanup; this.#storage = storage; }
  async execute(accountId: string): Promise<void> {
    await this.#cleanup.eraseHistory(accountId);
    while (true) {
      const files = await this.#cleanup.files(accountId);
      if (files.length === 0) return;
      let waiting = false;
      for (const file of files) {
        if (!file.expired) { waiting = true; continue; }
        for (const key of file.keys) await this.#storage.delete(key);
        await this.#cleanup.removeFile(file.id);
      }
      // Previously issued upload URLs must expire before final object deletion.
      if (waiting) throw new Error("Account file cleanup is waiting for upload URLs to expire");
    }
  }
}

type Dependencies = Readonly<{
  requests: AccountDeletionRepository; accounts: AccountRepository; erasure: AccountErasure;
  transactions: TransactionManager; tokens: VerificationTokenService; clock: Clock;
}>;
type RequestDependencies = Dependencies & Readonly<{ ids: IdGenerator; access: AuthenticationRequestAccessPolicy; ttlMs?: number }>;
type ConfirmDependencies = Dependencies & Readonly<{
  sessions: SessionManager; authenticationRequests: EmailAuthRequestRepository; emailChanges: EmailChangeRepository;
}>;

export class RequestAccountDeletionHandler {
  readonly #d: RequestDependencies;
  constructor(dependencies: RequestDependencies) { this.#d = dependencies; }
  async execute(input: Readonly<{ accountId: string; clientAddress: string }>): Promise<void> {
    const d = this.#d;
    const candidate = await d.accounts.findById(input.accountId);
    assertDomain(candidate !== null && candidate.status === "active", "ACCOUNT_NOT_ACTIVE", "Account is not active");
    await d.access.assertAllowed({ email: candidate.email, clientAddress: input.clientAddress });
    await d.transactions.execute(async () => {
      const account = await d.accounts.findById(input.accountId, { forUpdate: true });
      assertDomain(account !== null && account.status === "active", "ACCOUNT_NOT_ACTIVE", "Account is not active");
      assertDomain(!await d.erasure.hasOngoingOrders(account.id), "ACCOUNT_HAS_ONGOING_ORDERS", "Complete ongoing orders before deleting the account");
      const now = d.clock.now();
      const id = d.ids.next();
      await d.requests.revokePending(account.id);
      await d.requests.save(AccountDeletionRequest.create({ id, accountId: account.id, email: account.email.value,
        tokenHash: d.tokens.issue(`account-deletion:${id}`).hash, createdAt: now,
        expiresAt: new Date(now.getTime() + (d.ttlMs ?? 15 * 60_000)),
      }));
    });
  }
}

export class ConfirmAccountDeletionHandler {
  readonly #d: ConfirmDependencies;
  constructor(dependencies: ConfirmDependencies) { this.#d = dependencies; }
  async execute(rawToken: string): Promise<void> {
    const d = this.#d;
    const hash = d.tokens.hash(rawToken);
    await d.transactions.execute(async () => {
      const candidate = await d.requests.findByTokenHash(hash);
      assertDomain(candidate !== null, "INVALID_DELETION_TOKEN", "Deletion token is invalid");
      await d.accounts.findByEmail(candidate.email);
      const account = await d.accounts.findById(candidate.accountId, { forUpdate: true });
      const request = await d.requests.findByTokenHash(hash, { forUpdate: true });
      assertDomain(request !== null && request.status === "pending" && account !== null
        && account.status === "active" && account.email.equals(request.email), "INVALID_DELETION_TOKEN", "Deletion token is invalid");
      const now = d.clock.now();
      request.consume(now);
      assertDomain(!await d.erasure.hasOngoingOrders(account.id), "ACCOUNT_HAS_ONGOING_ORDERS", "Complete ongoing orders before deleting the account");
      const previousEmail = account.email;
      account.delete(now);
      await d.accounts.save(account);
      await d.requests.save(request);
      await d.requests.revokePending(account.id);
      await d.sessions.revokeAll(account.id, now);
      await d.authenticationRequests.revokePending(previousEmail, "login", now);
      await d.authenticationRequests.revokePending(previousEmail, "registration", now);
      await d.emailChanges.revokePending(account.id);
      await d.erasure.erasePersonalData(account.id, previousEmail.value, account.email.value, now);
    });
  }
}

type MailDependencies = Readonly<{
  requests: AccountDeletionRepository; accounts: AccountRepository;
  tokens: VerificationTokenService; clock: Clock; email: AccountDeletionEmailSender;
}>;
export class AccountDeletionMailHandler {
  readonly #d: MailDependencies;
  constructor(dependencies: MailDependencies) { this.#d = dependencies; }
  async execute(id: string): Promise<void> {
    const d = this.#d;
    const request = await d.requests.findById(id);
    if (!request || request.status !== "pending" || d.clock.now() >= request.expiresAt) return;
    const account = await d.accounts.findById(request.accountId);
    if (!account || account.status !== "active" || !account.email.equals(request.email)) return;
    const token = d.tokens.issue(`account-deletion:${id}`);
    if (token.hash !== request.tokenHash) throw new Error("Deletion token hash mismatch");
    await d.email.sendAccountDeletionLink({ email: request.email.value, rawToken: token.raw, expiresAt: request.expiresAt });
  }
}
