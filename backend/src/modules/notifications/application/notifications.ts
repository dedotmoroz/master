import { assertDomain } from "../../../shared/domain/domain-error.ts";
import type { AccountRepository, Clock, IdGenerator, OrderRepository, TransactionManager } from "../../marketplace/application/ports/guest-order-ports.ts";
import type { OutboxMessage } from "./process-outbox.ts";
import type { NotificationPreferencesRepository } from "./notification-preferences.ts";

import type { NotificationKind } from "../domain/notification.ts";
export type { NotificationKind } from "../domain/notification.ts";

export type Notification = Readonly<{
  id: string;
  accountId: string;
  sourceEventId: string;
  kind: NotificationKind;
  orderId: string;
  bidId?: string | null;
  title: string;
  text: string;
  createdAt: Date;
  readAt: Date | null;
  emailedAt: Date | null;
  emailSkippedAt: Date | null;
}>;

export type NotificationPage = Readonly<{
  items: readonly Notification[];
  total: number;
  unreadCount: number;
  limit: number;
  offset: number;
}>;

export interface NotificationRepository {
  /** Insert once per source event and recipient; enqueue email atomically. */
  save(notification: Notification): Promise<void>;
  findById(id: string): Promise<Notification | null>;
  list(accountId: string, pagination: Readonly<{ limit: number; offset: number }>): Promise<NotificationPage>;
  markRead(accountId: string, id: string, occurredAt: Date): Promise<boolean>;
  markEmailed(id: string, occurredAt: Date): Promise<void>;
  markEmailSkipped(id: string, occurredAt: Date): Promise<void>;
}

export interface NotificationEmailSender {
  sendNotification(input: Readonly<{
    kind: NotificationKind;
    email: string;
    notificationId: string;
    orderId: string;
    bidId?: string | null;
    title: string;
    text: string;
  }>): Promise<void>;
}

type MarketplaceNotificationDependencies = Readonly<{
    orders: OrderRepository;
    accounts: AccountRepository;
    notifications: NotificationRepository;
    transactions: TransactionManager;
    ids: IdGenerator;
}>;

export class MarketplaceNotificationHandler {
  readonly dependencies: MarketplaceNotificationDependencies;
  constructor(dependencies: MarketplaceNotificationDependencies) { this.dependencies = dependencies; }

  async execute(message: OutboxMessage): Promise<void> {
    const kind: NotificationKind | null = message.eventType === "BidSubmitted" ? "bid_submitted"
      : message.eventType === "BidSelected" ? "bid_selected"
        : message.eventType === "OrderCompleted" ? "order_completed" : null;
    if (kind === null) return;
    const orderId = kind === "order_completed" ? message.aggregateId : message.payload.orderId;
    assertDomain(typeof orderId === "string", "INVALID_NOTIFICATION_EVENT", "Order ID is missing from event");
    const order = await this.dependencies.orders.findById(orderId);
    assertDomain(order !== null, "INVALID_NOTIFICATION_EVENT", "Notification order does not exist");
    const snapshot = order.toSnapshot();
    const recipients = kind === "bid_submitted" ? [order.customerId]
      : kind === "bid_selected" ? [message.payload.contractorId]
        : [message.payload.customerId, message.payload.contractorId];
    const title = kind === "bid_submitted" ? "Новый отклик на заказ"
      : kind === "bid_selected" ? "Вас выбрали исполнителем" : "Заказ завершён";
    const text = kind === "bid_submitted" ? `На заказ «${snapshot.title}» поступил новый отклик.`
      : kind === "bid_selected" ? `Вы выбраны исполнителем заказа «${snapshot.title}».`
        : `Заказ «${snapshot.title}» завершён. Вы можете оставить отзыв о работе.`;

    await this.dependencies.transactions.execute(async () => {
      for (const recipient of new Set(recipients)) {
        assertDomain(typeof recipient === "string" && order.isParticipant(recipient),
          "INVALID_NOTIFICATION_EVENT", "Notification recipient is not an order participant");
        const account = await this.dependencies.accounts.findById(recipient);
        if (!account || account.status !== "active") continue;
        await this.dependencies.notifications.save({
          id: this.dependencies.ids.next(), accountId: recipient, sourceEventId: message.id,
          kind, orderId: order.id, title, text, createdAt: message.occurredAt,
          readAt: null, emailedAt: null, emailSkippedAt: null,
        });
      }
    });
  }
}

type NotificationEmailDependencies = Readonly<{
    preferences: NotificationPreferencesRepository;
    notifications: NotificationRepository;
    accounts: AccountRepository;
    email: NotificationEmailSender;
    clock: Clock;
}>;

export class SendNotificationEmailHandler {
  readonly dependencies: NotificationEmailDependencies;
  constructor(dependencies: NotificationEmailDependencies) { this.dependencies = dependencies; }

  async execute(id: string): Promise<void> {
    const notification = await this.dependencies.notifications.findById(id);
    if (!notification || notification.emailedAt !== null || notification.emailSkippedAt !== null) return;
    const account = await this.dependencies.accounts.findById(notification.accountId);
    if (!account || account.status !== "active") return;
    const preferences = await this.dependencies.preferences.findByAccountId(account.id);
    if (!preferences.allowsEmail(notification.kind)) {
      await this.dependencies.notifications.markEmailSkipped(id, this.dependencies.clock.now());
      return;
    }
    await this.dependencies.email.sendNotification({
      kind: notification.kind,
      email: account.email.value, notificationId: notification.id, orderId: notification.orderId,
      bidId: notification.bidId ?? null,
      title: notification.title, text: notification.text,
    });
    await this.dependencies.notifications.markEmailed(id, this.dependencies.clock.now());
  }
}

export class ListNotificationsHandler {
  readonly notifications: NotificationRepository;
  constructor(notifications: NotificationRepository) { this.notifications = notifications; }

  execute(accountId: string, pagination: Readonly<{ limit: number; offset: number }>): Promise<NotificationPage> {
    assertDomain(Number.isSafeInteger(pagination.limit) && pagination.limit >= 1 && pagination.limit <= 100
      && Number.isSafeInteger(pagination.offset) && pagination.offset >= 0,
    "INVALID_PAGINATION", "Pagination is invalid");
    return this.notifications.list(accountId, pagination);
  }
}

export class ReadNotificationHandler {
  readonly notifications: NotificationRepository;
  readonly clock: Clock;
  constructor(notifications: NotificationRepository, clock: Clock) {
    this.notifications = notifications;
    this.clock = clock;
  }

  async execute(accountId: string, notificationId: string): Promise<void> {
    assertDomain(await this.notifications.markRead(accountId, notificationId, this.clock.now()),
      "NOTIFICATION_NOT_FOUND", "Notification was not found");
  }
}
