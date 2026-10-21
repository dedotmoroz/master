import assert from "node:assert/strict";
import test from "node:test";
import { Account } from "../../src/modules/identity/domain/account.ts";
import { Order } from "../../src/modules/marketplace/domain/order.ts";
import { Email } from "../../src/shared/domain/value-objects.ts";
import type { OutboxMessage } from "../../src/modules/notifications/application/process-outbox.ts";
import { NotificationPreferences } from "../../src/modules/notifications/domain/notification-preferences.ts";
import {
  MarketplaceNotificationHandler, SendNotificationEmailHandler,
  type Notification, type NotificationRepository,
} from "../../src/modules/notifications/application/notifications.ts";

const now = new Date("2026-10-16T12:00:00Z");

class MemoryNotifications implements NotificationRepository {
  readonly items = new Map<string, Notification>();

  async save(notification: Notification): Promise<void> { this.items.set(notification.id, notification); }
  async findById(id: string): Promise<Notification | null> { return this.items.get(id) ?? null; }
  async list(accountId: string, pagination: { limit: number; offset: number }) {
    const items = [...this.items.values()].filter((item) => item.accountId === accountId);
    return { items, total: items.length, unreadCount: items.filter((item) => !item.readAt).length, ...pagination };
  }
  async markRead(accountId: string, id: string, occurredAt: Date): Promise<boolean> {
    const item = this.items.get(id);
    if (!item || item.accountId !== accountId) return false;
    this.items.set(id, { ...item, readAt: item.readAt ?? occurredAt });
    return true;
  }
  async markEmailed(id: string, occurredAt: Date): Promise<void> {
    const item = this.items.get(id)!;
    this.items.set(id, { ...item, emailedAt: occurredAt });
  }
  async markEmailSkipped(id: string, occurredAt: Date): Promise<void> {
    const item = this.items.get(id)!;
    this.items.set(id, { ...item, emailSkippedAt: occurredAt });
  }
}

function fixture() {
  const accounts = new Map([
    ["customer-1", Account.registerVerified("customer-1", Email.create("customer@example.com"), now)],
    ["contractor-1", Account.registerVerified("contractor-1", Email.create("contractor@example.com"), now)],
  ]);
  const accountRepository = {
    save: async () => undefined,
    findById: async (id: string) => accounts.get(id) ?? null,
    findByEmail: async () => null,
  };
  const order = Order.restore({
    id: "order-1", customerId: "customer-1", contractorId: "contractor-1",
    selectedBidId: "bid-1", categoryId: "house-building", locationId: "ru-locality-1",
    title: "Дом под ключ", description: "Строительство загородного дома",
    budgetMinMinor: null, budgetMaxMinor: null, budgetCurrency: "RUB", attachmentIds: [],
    status: "completed", createdAt: now, publishedAt: now, completedAt: now,
  });
  const notifications = new MemoryNotifications();
  let nextId = 0;
  const handler = new MarketplaceNotificationHandler({
    accounts: accountRepository,
    orders: { save: async () => undefined, findById: async (id) => id === order.id ? order : null },
    notifications,
    ids: { next: () => `notification-${++nextId}` },
    transactions: { execute: async (work) => work() },
  });
  const message = (eventType: string): OutboxMessage => ({
    id: `event-${eventType}`, eventType, aggregateType: "Order",
    aggregateId: "order-1", occurredAt: now, attempts: 1,
    payload: { orderId: "order-1", customerId: "customer-1", contractorId: "contractor-1" },
  });
  return { accounts, accountRepository, notifications, handler, message };
}

test("marketplace events notify the customer, selected contractor, and both completion participants", async () => {
  const f = fixture();
  for (const eventType of ["BidSubmitted", "BidSelected", "OrderCompleted"]) {
    await f.handler.execute(f.message(eventType));
  }
  assert.deepEqual([...f.notifications.items.values()].map((item) => [item.kind, item.accountId]), [
    ["bid_submitted", "customer-1"], ["bid_selected", "contractor-1"],
    ["order_completed", "customer-1"], ["order_completed", "contractor-1"],
  ]);
  assert.match([...f.notifications.items.values()][0]!.text, /Дом под ключ/);
});

test("inactive accounts are excluded from notification fan-out", async () => {
  const f = fixture();
  f.accounts.get("contractor-1")!.suspend(now);
  await f.handler.execute(f.message("OrderCompleted"));
  assert.deepEqual([...f.notifications.items.values()].map((item) => item.accountId), ["customer-1"]);
});

test("email failure leaves delivery retryable, while successful delivery is not sent again", async () => {
  const f = fixture();
  await f.handler.execute(f.message("BidSubmitted"));
  let sends = 0;
  const handler = new SendNotificationEmailHandler({
    preferences: { findByAccountId: async () => NotificationPreferences.defaults(), save: async () => undefined },
    notifications: f.notifications, accounts: f.accountRepository, clock: { now: () => now },
    email: { sendNotification: async input => { assert.equal(input.kind, "bid_submitted"); sends++; if (sends === 1) throw new Error("SMTP down"); } },
  });
  await assert.rejects(handler.execute("notification-1"), /SMTP down/);
  assert.equal(f.notifications.items.get("notification-1")!.emailedAt, null);
  await handler.execute("notification-1");
  await handler.execute("notification-1");
  assert.equal(sends, 2);
  assert.deepEqual(f.notifications.items.get("notification-1")!.emailedAt, now);
});

test("disabled email is skipped permanently while the inbox notification is retained", async () => {
  const f = fixture();
  await f.handler.execute(f.message("BidSubmitted"));
  let preferences = NotificationPreferences.restore({ email: {
    bidSubmitted: false, bidSelected: true, orderCompleted: true,
  } });
  let sends = 0;
  const handler = new SendNotificationEmailHandler({
    notifications: f.notifications, accounts: f.accountRepository, clock: { now: () => now },
    preferences: { findByAccountId: async () => preferences, save: async () => undefined },
    email: { sendNotification: async () => { sends++; } },
  });
  await handler.execute("notification-1");
  assert.equal(sends, 0);
  const item = f.notifications.items.get("notification-1")!;
  assert.deepEqual(item.emailSkippedAt, now);
  assert.equal(item.emailedAt, null);
  assert.equal((await f.notifications.list("customer-1", { limit: 20, offset: 0 })).unreadCount, 1);
  preferences = NotificationPreferences.defaults();
  await handler.execute("notification-1");
  assert.equal(sends, 0);
});

test("email preferences are read again before retrying a failed SMTP delivery", async () => {
  const f = fixture();
  await f.handler.execute(f.message("BidSubmitted"));
  let preferences = NotificationPreferences.defaults();
  let sends = 0;
  const handler = new SendNotificationEmailHandler({
    notifications: f.notifications, accounts: f.accountRepository, clock: { now: () => now },
    preferences: { findByAccountId: async () => preferences, save: async () => undefined },
    email: { sendNotification: async () => { sends++; throw new Error("SMTP unavailable"); } },
  });
  await assert.rejects(handler.execute("notification-1"), /SMTP unavailable/);
  preferences = NotificationPreferences.restore({ email: { bidSubmitted: false, bidSelected: true, orderCompleted: true } });
  await handler.execute("notification-1");
  assert.equal(sends, 1);
  assert.ok(f.notifications.items.get("notification-1")!.emailSkippedAt);
});
