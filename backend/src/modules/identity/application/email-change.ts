import { assertDomain } from "../../../shared/domain/domain-error.ts";
import { Email } from "../../../shared/domain/value-objects.ts";
import type { AccountRepository, Clock, IdGenerator, TransactionManager, VerificationTokenService } from "../../marketplace/application/ports/guest-order-ports.ts";
import { EmailChangeRequest } from "../domain/email-change-request.ts";
import type { AuthenticationRequestAccessPolicy, EmailAuthRequestRepository, SessionManager } from "./ports/authentication-ports.ts";
import type { OutboxMessage } from "../../notifications/application/process-outbox.ts";

export interface EmailChangeRepository {
  save(request: EmailChangeRequest): Promise<void>;
  revokePending(accountId: string): Promise<void>;
  findById(id: string): Promise<EmailChangeRequest | null>;
  findByTokenHash(hash: string, options?: Readonly<{ forUpdate?: boolean }>): Promise<EmailChangeRequest | null>;
}

export interface EmailChangeSender {
  sendEmailChangeLink(input: Readonly<{ email: string; rawToken: string; expiresAt: Date }>): Promise<void>;
  sendEmailChangedNotice(input: Readonly<{ previousEmail: string; email: string }>): Promise<void>;
}

type Dependencies = Readonly<{
  requests: EmailChangeRepository; accounts: AccountRepository; tokens: VerificationTokenService;
  clock: Clock; transactions: TransactionManager;
}>;
type RequestDependencies = Dependencies & Readonly<{ ids: IdGenerator; access: AuthenticationRequestAccessPolicy; ttlMs?: number }>;
type ConfirmDependencies = Dependencies & Readonly<{ sessions: SessionManager; authenticationRequests: EmailAuthRequestRepository }>;
type MailDependencies = Readonly<{ requests: EmailChangeRepository; tokens: VerificationTokenService; email: EmailChangeSender; clock: Clock }>;

export class RequestEmailChangeHandler {
  readonly #dependencies: RequestDependencies;
  constructor(dependencies: RequestDependencies) { this.#dependencies = dependencies; }

  async execute(input: Readonly<{ accountId: string; email: string; clientAddress: string }>): Promise<void> {
    const d = this.#dependencies;
    const email = Email.create(input.email);
    await d.access.assertAllowed({ email, clientAddress: input.clientAddress });
    await d.transactions.execute(async () => {
      const occupied = await d.accounts.findByEmail(email);
      const account = await d.accounts.findById(input.accountId, { forUpdate: true });
      assertDomain(account !== null && account.status === "active", "ACCOUNT_NOT_ACTIVE", "Account is not active");
      assertDomain(!email.equals(account.email), "EMAIL_UNCHANGED", "New email is the same as current email");
      assertDomain(occupied === null, "EMAIL_ALREADY_IN_USE", "Email is already in use");
      const id = d.ids.next();
      const now = d.clock.now();
      await d.requests.revokePending(account.id);
      await d.requests.save(EmailChangeRequest.create({
        id, accountId: account.id, previousEmail: account.email.value, newEmail: email.value,
        tokenHash: d.tokens.issue(`email-change:${id}`).hash,
        createdAt: now, expiresAt: new Date(now.getTime() + (d.ttlMs ?? 15 * 60_000)),
      }));
    });
  }
}

export class ConfirmEmailChangeHandler {
  readonly #dependencies: ConfirmDependencies;
  constructor(dependencies: ConfirmDependencies) { this.#dependencies = dependencies; }

  async execute(rawToken: string): Promise<void> {
    const d = this.#dependencies;
    const hash = d.tokens.hash(rawToken);
    await d.transactions.execute(async () => {
      const candidate = await d.requests.findByTokenHash(hash);
      assertDomain(candidate !== null, "INVALID_EMAIL_CHANGE_TOKEN", "Email change token is invalid");
      // Serialize both addresses before locking the account and request, as in login confirmation.
      let occupied = null;
      for (const address of [candidate.previousEmail, candidate.newEmail].sort((a, b) => a.value.localeCompare(b.value))) {
        const found = await d.accounts.findByEmail(address);
        if (address.equals(candidate.newEmail)) occupied = found;
      }
      const account = await d.accounts.findById(candidate.accountId, { forUpdate: true });
      const request = await d.requests.findByTokenHash(hash, { forUpdate: true });
      assertDomain(request !== null && request.status === "pending" && account !== null
        && account.status === "active" && account.email.equals(request.previousEmail),
      "INVALID_EMAIL_CHANGE_TOKEN", "Email change token is invalid");
      const now = d.clock.now();
      request.consume(now);
      assertDomain(occupied === null, "EMAIL_ALREADY_IN_USE", "Email is already in use");
      account.changeEmail(request.newEmail, now);
      await d.accounts.save(account);
      await d.requests.save(request);
      await d.authenticationRequests.revokePending(request.previousEmail, "login", now);
      await d.authenticationRequests.revokePending(request.previousEmail, "registration", now);
      await d.sessions.revokeAll(account.id, now);
    });
  }
}

export class EmailChangeMailHandler {
  readonly #dependencies: MailDependencies;
  constructor(dependencies: MailDependencies) { this.#dependencies = dependencies; }

  async requested(id: string): Promise<void> {
    const d = this.#dependencies;
    const request = await d.requests.findById(id);
    if (!request || request.status !== "pending" || d.clock.now() >= request.expiresAt) return;
    const token = d.tokens.issue(`email-change:${request.id}`);
    if (token.hash !== request.tokenHash) throw new Error("Email change token hash mismatch");
    await d.email.sendEmailChangeLink({ email: request.newEmail.value, rawToken: token.raw, expiresAt: request.expiresAt });
  }

  async changed(message: OutboxMessage): Promise<void> {
    const { previousEmail, email } = message.payload;
    assertDomain(typeof previousEmail === "string" && typeof email === "string", "INVALID_EMAIL_CHANGE_EVENT", "Email change event is invalid");
    await this.#dependencies.email.sendEmailChangedNotice({ previousEmail, email });
  }
}
