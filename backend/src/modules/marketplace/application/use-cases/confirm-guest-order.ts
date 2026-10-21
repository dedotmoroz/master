import { Account } from "../../../identity/domain/account.ts";
import { DomainError, assertDomain } from "../../../../shared/domain/domain-error.ts";
import { Order } from "../../domain/order.ts";
import type { GuestAttachmentClaims } from "../../../attachments/application/ports/attachment-ports.ts";
import type {
  AccountRepository,
  Clock,
  IdGenerator,
  OrderRepository,
  OrderSubmissionRepository,
  SessionIssuer,
  TransactionManager,
  VerificationTokenService,
} from "../ports/guest-order-ports.ts";

export type ConfirmGuestOrderResult = Readonly<{
  accountId: string;
  orderId: string;
  sessionToken: string;
  reusedAccount: boolean;
  alreadyConfirmed: boolean;
}>;

export class ConfirmGuestOrderHandler {
  readonly #submissions: OrderSubmissionRepository;
  readonly #accounts: AccountRepository;
  readonly #orders: OrderRepository;
  readonly #sessions: SessionIssuer;
  readonly #tokens: VerificationTokenService;
  readonly #accountIds: IdGenerator;
  readonly #orderIds: IdGenerator;
  readonly #clock: Clock;
  readonly #transactions: TransactionManager;
  readonly #guestAttachments: GuestAttachmentClaims;

  constructor(dependencies: Readonly<{
    submissions: OrderSubmissionRepository;
    accounts: AccountRepository;
    orders: OrderRepository;
    sessions: SessionIssuer;
    tokens: VerificationTokenService;
    accountIds: IdGenerator;
    orderIds: IdGenerator;
    clock: Clock;
    transactions: TransactionManager;
    guestAttachments: GuestAttachmentClaims;
  }>) {
    this.#submissions = dependencies.submissions;
    this.#accounts = dependencies.accounts;
    this.#orders = dependencies.orders;
    this.#sessions = dependencies.sessions;
    this.#tokens = dependencies.tokens;
    this.#accountIds = dependencies.accountIds;
    this.#orderIds = dependencies.orderIds;
    this.#clock = dependencies.clock;
    this.#transactions = dependencies.transactions;
    this.#guestAttachments = dependencies.guestAttachments;
  }

  async execute(rawToken: string): Promise<ConfirmGuestOrderResult> {
    assertDomain(rawToken.trim().length > 0, "INVALID_CONFIRMATION_TOKEN", "Confirmation token is required");
    const tokenHash = this.#tokens.hash(rawToken);
    const confirmed = await this.#transactions.execute(async () => {
      const candidate = await this.#submissions.findByTokenHash(tokenHash);
      if (!candidate) throw new DomainError("INVALID_CONFIRMATION_TOKEN", "Confirmation token is invalid");
      // Pending publication and account deletion serialize on the email before locking the submission.
      const existingAccount = candidate.status === "pending_email"
        ? await this.#accounts.findByEmail(candidate.email) : null;
      const submission = await this.#submissions.findByTokenHash(tokenHash, { forUpdate: true });
      if (!submission) {
        throw new DomainError("INVALID_CONFIRMATION_TOKEN", "Confirmation token is invalid");
      }

      if (submission.status === "confirmed") {
        const account = await this.#accounts.findById(submission.accountId as string);
        assertDomain(account !== null && account.status === "active", "ACCOUNT_NOT_ACTIVE", "Account is not active");
        await this.#guestAttachments.assignToAccount(
          submission.id,
          submission.accountId as string,
          submission.draft.temporaryAttachmentIds,
        );
        return {
          accountId: submission.accountId as string,
          orderId: submission.orderId as string,
          reusedAccount: true,
          alreadyConfirmed: true,
        };
      }

      const now = this.#clock.now();
      assertDomain(!submission.isExpired(now), "SUBMISSION_EXPIRED", "Confirmation link has expired");
      let reusedAccount = true;
      let account = existingAccount;
      if (!account) {
        reusedAccount = false;
        account = Account.registerVerified(this.#accountIds.next(), submission.email, now);
      }
      assertDomain(account.status === "active", "ACCOUNT_NOT_ACTIVE", "Order cannot be published for an inactive account");
      account.grantCapability("customer", now);

      const order = Order.createPublished(
        {
          id: this.#orderIds.next(),
          customerId: account.id,
          categoryId: submission.draft.categoryId,
          locationId: submission.draft.locationId,
          title: submission.draft.title,
          description: submission.draft.description,
          budget: submission.draft.budget,
          attachmentIds: submission.draft.temporaryAttachmentIds,
          createdAt: submission.createdAt,
        },
        now,
      );
      submission.confirm(account.id, order.id, now);

      await this.#accounts.save(account);
      await this.#guestAttachments.assignToAccount(
        submission.id,
        account.id,
        submission.draft.temporaryAttachmentIds,
      );

      await this.#orders.save(order);
      await this.#submissions.save(submission);
      return {
        accountId: account.id,
        orderId: order.id,
        reusedAccount,
        alreadyConfirmed: false,
      };
    });

    return {
      ...confirmed,
      sessionToken: await this.#sessions.issue(confirmed.accountId),
    };
  }
}
