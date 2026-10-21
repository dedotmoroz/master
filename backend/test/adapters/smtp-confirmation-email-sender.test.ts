import assert from "node:assert/strict";
import test from "node:test";
import {
  SmtpConfirmationEmailSender,
  buildAuthenticationUrl,
  buildOrderConfirmationUrl,
  type MailMessage,
  type MailTransport,
} from "../../src/adapters/out/email/smtp-confirmation-email-sender.ts";

class RecordingTransport implements MailTransport {
  message: MailMessage | null = null;

  async sendMail(message: MailMessage): Promise<void> {
    this.message = message;
  }
}

test("confirmation URL safely encodes the raw token", () => {
  const url = buildOrderConfirmationUrl("https://example.com/app", "token+/with?symbols");
  const parsed = new URL(url);

  assert.equal(parsed.origin, "https://example.com");
  assert.equal(parsed.pathname, "/orders/confirm");
  assert.equal(parsed.searchParams.get("token"), "token+/with?symbols");
});

test("authentication URL selects registration and login routes", () => {
  const registration = new URL(buildAuthenticationUrl("https://example.com", "registration", "register-token"));
  const login = new URL(buildAuthenticationUrl("https://example.com", "login", "login-token"));
  assert.equal(registration.pathname, "/auth/register/confirm");
  assert.equal(registration.searchParams.get("token"), "register-token");
  assert.equal(login.pathname, "/auth/login/confirm");
  assert.equal(login.searchParams.get("token"), "login-token");
});

test("SMTP adapter builds text and escaped HTML messages", async () => {
  const transport = new RecordingTransport();
  const sender = new SmtpConfirmationEmailSender(
    {
      host: "smtp.example.com",
      port: 587,
      secure: false,
      from: "Naiti Mastera <no-reply@example.com>",
      publicWebUrl: "https://example.com",
    },
    transport,
  );

  await sender.sendOrderConfirmation({
    email: "customer@example.com",
    contactName: "<Анна>",
    rawToken: "secret-token",
    expiresAt: new Date("2026-01-02T10:00:00.000Z"),
  });

  assert.equal(transport.message?.to, "customer@example.com");
  assert.match(transport.message?.text ?? "", /secret-token/);
  assert.match(transport.message?.html ?? "", /&lt;Анна&gt;/);
  assert.equal(transport.message?.html.includes("<Анна>"), false);

  await sender.sendAuthenticationLink({
    email: "member@example.com",
    purpose: "registration",
    rawToken: "registration-token",
    expiresAt: new Date("2026-01-02T10:00:00.000Z"),
  });
  assert.equal(transport.message?.to, "member@example.com");
  assert.equal(transport.message?.subject, "Завершите регистрацию");
  assert.match(transport.message?.text ?? "", /registration-token/);

  await sender.sendNotification({
    kind: "bid_submitted",
    email: "member@example.com", notificationId: "notification-1", orderId: "order-1",
    title: "Новый отклик на заказ", text: "На заказ «<Дом & сад>» поступил отклик.",
  });
  assert.equal(transport.message?.subject, "Новый отклик на заказ");
  assert.match(transport.message?.text ?? "", /https:\/\/example.com\/account\/orders\/view\/\?id=order-1/);
  assert.match(transport.message?.html ?? "", /&lt;Дом &amp; сад&gt;/);
  assert.equal(transport.message?.html.includes("<Дом"), false);
  await sender.sendNotification({ kind: "message_received", email: "member@example.com", notificationId: "message-notification", orderId: "order-1",
    bidId: "bid-1", title: "Новое сообщение по отклику", text: "Откройте переписку в кабинете." });
  assert.match(transport.message?.text ?? "", /https:\/\/example.com\/account\/messages\/\?bidId=bid-1/);
  for (const kind of ['bid_selected', 'order_completed'] as const) {
    await sender.sendNotification({kind,email:'member@example.com',notificationId:'deal-notification',orderId:'order-1',title:'Событие сделки',text:'Откройте заказ.'});
    assert.match(transport.message?.text ?? '', /https:\/\/example.com\/account\/deals\/view\/\?id=order-1/);
  }
  await sender.sendEmailChangeLink({ email: "new@example.com", rawToken: "change+/token",
    expiresAt: new Date("2026-10-16T10:15:00Z") });
  assert.equal(transport.message?.to, "new@example.com");
  assert.match(transport.message?.text ?? "", /auth\/email-change\/confirm\?token=change%2B%2Ftoken/);
  await sender.sendEmailChangedNotice({ previousEmail: "old@example.com", email: "new@example.com" });
  assert.equal(transport.message?.to, "old@example.com");
  assert.equal(transport.message?.subject, "Email аккаунта изменён");
  await sender.sendAccountDeletionLink({ email: "owner@example.com", rawToken: "delete+/token",
    expiresAt: new Date("2026-10-16T10:15:00Z") });
  assert.equal(transport.message?.to, "owner@example.com");
  assert.equal(transport.message?.subject, "Подтвердите удаление аккаунта");
  assert.match(transport.message?.text ?? "", /account-deletion\/confirm\?token=delete%2B%2Ftoken/);
});
