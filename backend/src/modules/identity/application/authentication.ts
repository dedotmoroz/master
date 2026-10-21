import { Account } from "../domain/account.ts";
import { EmailAuthRequest, type EmailAuthPurpose } from "../domain/email-auth-request.ts";
import { DomainError, assertDomain } from "../../../shared/domain/domain-error.ts";
import { Email } from "../../../shared/domain/value-objects.ts";
import type {
  AccountRepository,
  Clock,
  IdGenerator,
  TransactionManager,
  VerificationTokenService,
} from "../../marketplace/application/ports/guest-order-ports.ts";
import type {
  AuthenticationEmailSender,
  AuthenticationRequestAccessPolicy,
  EmailAuthRequestRepository,
  SessionManager,
} from "./ports/authentication-ports.ts";

export type RequestEmailAuthenticationCommand = Readonly<{
  email: string;
  purpose: EmailAuthPurpose;
  clientAddress: string;
}>;

export type ConfirmEmailAuthenticationResult = Readonly<{
  accountId: string;
  email: string;
  capabilities: readonly ("customer" | "contractor" | "admin")[];
  sessionToken: string;
  createdAccount: boolean;
}>;

export class RequestEmailAuthenticationHandler {
  readonly #requests: EmailAuthRequestRepository;
  readonly #accounts: AccountRepository;
  readonly #access: AuthenticationRequestAccessPolicy;
  readonly #tokens: VerificationTokenService;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;
  readonly #transactions: TransactionManager;
  readonly #ttlMs: number;

  constructor(dependencies: Readonly<{
    requests: EmailAuthRequestRepository;
    accounts: AccountRepository;
    access: AuthenticationRequestAccessPolicy;
    tokens: VerificationTokenService;
    ids: IdGenerator;
    clock: Clock;
    transactions: TransactionManager;
    ttlMs?: number;
  }>) {
    this.#requests = dependencies.requests;
    this.#accounts = dependencies.accounts;
    this.#access = dependencies.access;
    this.#tokens = dependencies.tokens;
    this.#ids = dependencies.ids;
    this.#clock = dependencies.clock;
    this.#transactions = dependencies.transactions;
    this.#ttlMs = dependencies.ttlMs ?? 15 * 60 * 1_000;
  }

  async execute(command: RequestEmailAuthenticationCommand): Promise<void> {
    const email = Email.create(command.email);
    await this.#access.assertAllowed({ clientAddress: command.clientAddress, email });
    await this.#transactions.execute(async () => {
      const account = await this.#accounts.findByEmail(email);
      if (command.purpose === "login" && (!account || account.status !== "active")) return;
      if (command.purpose === "registration" && account && account.status !== "active") return;

      const id = this.#ids.next();
      const now = this.#clock.now();
      const token = this.#tokens.issue(`email-auth:${id}`);
      await this.#requests.revokePending(email, command.purpose, now);
      await this.#requests.save(EmailAuthRequest.create({
        id,
        email,
        purpose: command.purpose,
        tokenHash: token.hash,
        createdAt: now,
        expiresAt: new Date(now.getTime() + this.#ttlMs),
      }));
    });
  }
}

export class ConfirmEmailAuthenticationHandler {
  readonly #requests: EmailAuthRequestRepository;
  readonly #accounts: AccountRepository;
  readonly #sessions: SessionManager;
  readonly #tokens: VerificationTokenService;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;
  readonly #transactions: TransactionManager;

  constructor(dependencies: Readonly<{
    requests: EmailAuthRequestRepository;
    accounts: AccountRepository;
    sessions: SessionManager;
    tokens: VerificationTokenService;
    ids: IdGenerator;
    clock: Clock;
    transactions: TransactionManager;
  }>) {
    this.#requests = dependencies.requests;
    this.#accounts = dependencies.accounts;
    this.#sessions = dependencies.sessions;
    this.#tokens = dependencies.tokens;
    this.#ids = dependencies.ids;
    this.#clock = dependencies.clock;
    this.#transactions = dependencies.transactions;
  }

  async execute(rawToken: string, expectedPurpose: EmailAuthPurpose): Promise<ConfirmEmailAuthenticationResult> {
    assertDomain(rawToken.trim().length > 0, "INVALID_AUTHENTICATION_TOKEN", "Authentication token is invalid");
    const tokenHash = this.#tokens.hash(rawToken);
    return this.#transactions.execute(async () => {
      const candidate = await this.#requests.findByTokenHash(tokenHash);
      if (!candidate) throw new DomainError("INVALID_AUTHENTICATION_TOKEN", "Authentication token is invalid");
      let account = await this.#accounts.findByEmail(candidate.email);
      if (account) account = await this.#accounts.findById(account.id, { forUpdate: true });
      const request = await this.#requests.findByTokenHash(tokenHash, { forUpdate: true });
      if (!request || request.purpose !== expectedPurpose || request.status !== "pending") {
        throw new DomainError("INVALID_AUTHENTICATION_TOKEN", "Authentication token is invalid");
      }
      const now = this.#clock.now();
      assertDomain(now <= request.expiresAt, "AUTHENTICATION_TOKEN_EXPIRED", "Authentication token has expired");

      let createdAccount = false;
      if (!account && request.purpose === "registration") {
        account = Account.registerVerified(this.#ids.next(), request.email, now);
        createdAccount = true;
      }
      assertDomain(account !== null && account.status === "active", "INVALID_AUTHENTICATION_TOKEN", "Authentication token is invalid");
      request.consume(account.id, now);
      if (createdAccount) await this.#accounts.save(account);
      await this.#requests.save(request);
      const sessionToken = await this.#sessions.issue(account.id);
      return {
        accountId: account.id,
        email: account.email.value,
        capabilities: account.capabilities,
        sessionToken,
        createdAccount,
      };
    });
  }
}

export class EmailAuthenticationRequestedHandler {
  readonly #requests: EmailAuthRequestRepository;
  readonly #tokens: VerificationTokenService;
  readonly #email: AuthenticationEmailSender;

  constructor(dependencies: Readonly<{
    requests: EmailAuthRequestRepository;
    tokens: VerificationTokenService;
    email: AuthenticationEmailSender;
  }>) {
    this.#requests = dependencies.requests;
    this.#tokens = dependencies.tokens;
    this.#email = dependencies.email;
  }

  async execute(requestId: string): Promise<void> {
    const request = await this.#requests.findById(requestId);
    if (!request || request.status !== "pending") return;
    const token = this.#tokens.issue(`email-auth:${request.id}`);
    if (token.hash !== request.tokenHash) throw new Error("Generated authentication token does not match persisted hash");
    await this.#email.sendAuthenticationLink({
      email: request.email.value,
      purpose: request.purpose,
      rawToken: token.raw,
      expiresAt: request.expiresAt,
    });
  }
}

export class LogoutHandler {
  readonly #sessions: SessionManager;
  readonly #clock: Clock;

  constructor(sessions: SessionManager, clock: Clock) {
    this.#sessions = sessions;
    this.#clock = clock;
  }

  revokeCurrent(rawToken: string): Promise<void> {
    return this.#sessions.revoke(rawToken, this.#clock.now());
  }

  revokeAll(accountId: string): Promise<void> {
    return this.#sessions.revokeAll(accountId, this.#clock.now());
  }
}

export class GetOwnAccountHandler {
  readonly #accounts: AccountRepository;

  constructor(accounts: AccountRepository) {
    this.#accounts = accounts;
  }

  async execute(accountId: string): Promise<Readonly<{
    id: string;
    email: string;
    status: "active" | "suspended" | "deleted";
    capabilities: readonly ("customer" | "contractor" | "admin")[];
    createdAt: Date;
  }>> {
    const account = await this.#accounts.findById(accountId);
    assertDomain(account !== null, "AUTHENTICATION_REQUIRED", "A valid Bearer session is required");
    const snapshot = account.toSnapshot();
    return {
      id: snapshot.id,
      email: snapshot.email,
      status: snapshot.status,
      capabilities: snapshot.capabilities,
      createdAt: snapshot.createdAt,
    };
  }
}
