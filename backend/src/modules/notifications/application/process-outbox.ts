import type {
  OrderSubmissionRepository,
  VerificationTokenService,
} from "../../marketplace/application/ports/guest-order-ports.ts";
import { safeErrorReason } from "../../../shared/safe-error.ts";

export type OutboxMessage = Readonly<{
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
  attempts: number;
}>;

export interface OutboxRepository {
  claimBatch(workerId: string, limit: number): Promise<readonly OutboxMessage[]>;
  markProcessed(messageId: string): Promise<void>;
  markFailed(messageId: string, error: string, retryAt: Date): Promise<void>;
}

export interface ConfirmationEmailSender {
  sendOrderConfirmation(input: Readonly<{
    email: string;
    contactName: string;
    rawToken: string;
    expiresAt: Date;
  }>): Promise<void>;
}

export type OutboxMessageHandler = (message: OutboxMessage) => Promise<void>;
export type OutboxFailureReporter = (failure: Readonly<{
  eventId: string; eventType: string; attempts: number; reason: string; retryAt: string;
}>) => void;

export class GuestOrderSubmittedHandler {
  readonly #submissions: OrderSubmissionRepository;
  readonly #tokens: VerificationTokenService;
  readonly #email: ConfirmationEmailSender;

  constructor(dependencies: Readonly<{
    submissions: OrderSubmissionRepository;
    tokens: VerificationTokenService;
    email: ConfirmationEmailSender;
  }>) {
    this.#submissions = dependencies.submissions;
    this.#tokens = dependencies.tokens;
    this.#email = dependencies.email;
  }

  async execute(message: OutboxMessage): Promise<void> {
    const submission = await this.#submissions.findById(message.aggregateId);
    if (!submission || submission.status !== "pending_email") return;

    const token = this.#tokens.issue(submission.id);
    if (token.hash !== submission.tokenHash) {
      throw new Error("Generated confirmation token does not match the persisted hash");
    }
    await this.#email.sendOrderConfirmation({
      email: submission.email.value,
      contactName: submission.contactName,
      rawToken: token.raw,
      expiresAt: submission.expiresAt,
    });
  }
}

export class ProcessOutboxBatchHandler {
  readonly #outbox: OutboxRepository;
  readonly #handlers: ReadonlyMap<string, OutboxMessageHandler>;
  readonly #retryDelayMs: number;
  readonly #reportFailure: OutboxFailureReporter;

  constructor(
    outbox: OutboxRepository,
    handlers: ReadonlyMap<string, OutboxMessageHandler>,
    retryDelayMs = 60_000,
    reportFailure: OutboxFailureReporter = () => {},
  ) {
    this.#outbox = outbox;
    this.#handlers = handlers;
    this.#retryDelayMs = retryDelayMs;
    this.#reportFailure = reportFailure;
  }

  async execute(workerId: string, limit = 20): Promise<number> {
    const messages = await this.#outbox.claimBatch(workerId, limit);
    for (const message of messages) {
      const handler = this.#handlers.get(message.eventType);
      try {
        if (handler) await handler(message);
        await this.#outbox.markProcessed(message.id);
      } catch (error) {
        const reason = safeErrorReason(error);
        const retryAt = new Date(Date.now() + this.#retryDelayMs * Math.max(1, message.attempts));
        await this.#outbox.markFailed(message.id, reason, retryAt);
        this.#reportFailure({ eventId: message.id, eventType: message.eventType,
          attempts: message.attempts, reason, retryAt: retryAt.toISOString() });
      }
    }
    return messages.length;
  }
}
