import { assertDomain } from "../../../shared/domain/domain-error.ts";
import type { AccountRepository, Clock, IdGenerator, OrderRepository, TransactionManager } from "./ports/guest-order-ports.ts";
import type { BidRepository, Page } from "./ports/bid-ports.ts";
import { BidMessage, type BidMessageSnapshot } from "../domain/bid-message.ts";
import type { NotificationRepository } from "../../notifications/application/notifications.ts";

export type ConversationMessage = Readonly<{
  id: string; bidId: string; orderId: string; authorId: string | null; text: string; createdAt: Date;
}>;
export interface BidMessageRepository {
  save(message: BidMessage): Promise<void>;
  findByClientId(bidId: string, authorId: string, clientMessageId: string): Promise<BidMessage | null>;
  list(bidId: string, pagination: Readonly<{ limit: number; offset: number }>): Promise<Page<ConversationMessage>>;
}
export interface MessageRateLimiter {
  consume(input: Readonly<{ action: string; clientAddress: string; limit: number; windowSeconds: number; occurredAt: Date }>):
    Promise<Readonly<{ allowed: boolean; retryAfterSeconds: number }>>;
}
type Dependencies = Readonly<{
  accounts: AccountRepository; bids: BidRepository; orders: OrderRepository; messages: BidMessageRepository;
  transactions: TransactionManager; notifications: NotificationRepository; ids: IdGenerator; clock: Clock;
  rateLimiter: MessageRateLimiter;
}>;

export class BidMessaging {
  readonly #d: Dependencies;
  constructor(dependencies: Dependencies) { this.#d = dependencies; }

  async #conversation(accountId: string, bidId: string) {
    const candidate = await this.#d.bids.findById(bidId);
    const candidateOrder = candidate ? await this.#d.orders.findById(candidate.orderId) : null;
    assertDomain(candidate && candidateOrder && [candidate.contractorId, candidateOrder.customerId].includes(accountId),
      "BID_NOT_FOUND", "Bid was not found");
    // Same account -> order -> bid lock ordering as selection/deletion. Sender cannot race account erasure.
    for (const id of [...new Set([candidate.contractorId, candidateOrder.customerId])].sort()) {
      const account = await this.#d.accounts.findById(id, { forUpdate: true });
      assertDomain(account?.status === "active", "BID_NOT_FOUND", "Bid was not found");
    }
    const order = await this.#d.orders.findById(candidate.orderId, { forUpdate: true });
    const bid = await this.#d.bids.findById(bidId, { forUpdate: true });
    assertDomain(order && bid && bid.orderId === order.id && [bid.contractorId, order.customerId].includes(accountId),
      "BID_NOT_FOUND", "Bid was not found");
    return { order, bid, recipient: accountId === order.customerId ? bid.contractorId : order.customerId };
  }

  async list(accountId: string, bidId: string, pagination: Readonly<{ limit: number; offset: number }>): Promise<Page<ConversationMessage> & { canSend: boolean }> {
    assertDomain(Number.isSafeInteger(pagination.limit) && pagination.limit >= 1 && pagination.limit <= 100
      && Number.isSafeInteger(pagination.offset) && pagination.offset >= 0, "INVALID_PAGINATION", "Pagination is invalid");
    return this.#d.transactions.execute(async () => {
      const { order, bid } = await this.#conversation(accountId, bidId);
      return { ...await this.#d.messages.list(bidId, pagination), canSend:
        (order.status === "published" || order.status === "in_progress") && (bid.status === "submitted" || bid.status === "selected") };
    });
  }

  async send(input: Readonly<{ accountId: string; bidId: string; text: string; clientMessageId: string }>): Promise<BidMessageSnapshot> {
    const text = BidMessage.normalizeText(input.text);
    const clientMessageId = BidMessage.normalizeClientId(input.clientMessageId);
    return this.#d.transactions.execute(async () => {
      const { order, bid, recipient } = await this.#conversation(input.accountId, input.bidId);
      const existing = await this.#d.messages.findByClientId(bid.id, input.accountId, clientMessageId);
      if (existing) {
        assertDomain(existing.toSnapshot().text === text, "MESSAGE_IDEMPOTENCY_CONFLICT", "clientMessageId was already used for a different message");
        return existing.toSnapshot();
      }
      assertDomain((order.status === "published" || order.status === "in_progress")
        && (bid.status === "submitted" || bid.status === "selected"), "CONVERSATION_READ_ONLY", "This conversation is read-only");
      const now = this.#d.clock.now();
      const rate = await this.#d.rateLimiter.consume({ action: "bid_message", clientAddress: input.accountId,
        limit: 20, windowSeconds: 60, occurredAt: now });
      assertDomain(rate.allowed, "RATE_LIMIT_EXCEEDED", "Too many messages", { retryAfterSeconds: rate.retryAfterSeconds });
      const message = BidMessage.create({ id: this.#d.ids.next(), bidId: bid.id, orderId: order.id,
        authorId: input.accountId, clientMessageId, text, createdAt: now });
      await this.#d.messages.save(message);
      await this.#d.notifications.save({ id: this.#d.ids.next(), accountId: recipient, sourceEventId: message.toSnapshot().id,
        kind: "message_received", orderId: order.id, bidId: bid.id, title: "Новое сообщение по отклику",
        text: "Вам поступило новое сообщение по отклику. Откройте переписку в личном кабинете.",
        createdAt: now, readAt: null, emailedAt: null, emailSkippedAt: null });
      return message.toSnapshot();
    });
  }
}
