import nodemailer from "nodemailer";
import type { NotificationEmailSender } from "../../../modules/notifications/application/notifications.ts";
import type { EmailChangeSender } from "../../../modules/identity/application/email-change.ts";
import type { AccountDeletionEmailSender } from "../../../modules/identity/application/account-deletion.ts";
import type { ConfirmationEmailSender } from "../../../modules/notifications/application/process-outbox.ts";
import type { AuthenticationEmailSender } from "../../../modules/identity/application/ports/authentication-ports.ts";
import type { EmailAuthPurpose } from "../../../modules/identity/domain/email-auth-request.ts";

export type MailMessage = Readonly<{
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}>;

export interface MailTransport {
  sendMail(message: MailMessage): Promise<unknown>;
}

export type SmtpConfirmationEmailOptions = Readonly<{
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  publicWebUrl: string;
}>;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildOrderConfirmationUrl(publicWebUrl: string, rawToken: string): string {
  const url = new URL("/orders/confirm", publicWebUrl);
  url.searchParams.set("token", rawToken);
  return url.toString();
}

export function buildAuthenticationUrl(
  publicWebUrl: string,
  purpose: EmailAuthPurpose,
  rawToken: string,
): string {
  const path = purpose === "registration" ? "/auth/register/confirm" : "/auth/login/confirm";
  const url = new URL(path, publicWebUrl);
  url.searchParams.set("token", rawToken);
  return url.toString();
}

export function buildNotificationUrl(publicWebUrl: string, input: Parameters<NotificationEmailSender["sendNotification"]>[0]): string {
  if (input.bidId) {
    const url = new URL("/account/messages/", publicWebUrl);
    url.searchParams.set("bidId", input.bidId);
    return url.toString();
  }
  const url = new URL(input.kind === 'bid_submitted' ? '/account/orders/view/' : '/account/deals/view/', publicWebUrl);
  url.searchParams.set('id', input.orderId);
  return url.toString();
}

export class SmtpConfirmationEmailSender implements ConfirmationEmailSender, AuthenticationEmailSender, NotificationEmailSender, EmailChangeSender {
  readonly #transport: MailTransport;
  readonly #from: string;
  readonly #publicWebUrl: string;

  constructor(options: SmtpConfirmationEmailOptions, transport?: MailTransport) {
    this.#from = options.from;
    this.#publicWebUrl = options.publicWebUrl;
    this.#transport = transport ?? nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth: options.user && options.password
        ? { user: options.user, pass: options.password }
        : undefined,
    });
  }

  async sendNotification(input: Parameters<NotificationEmailSender["sendNotification"]>[0]): Promise<void> {
    const url = buildNotificationUrl(this.#publicWebUrl, input);
    const action = input.bidId ? "Открыть переписку" : input.kind === 'bid_submitted' ? 'Открыть отклики' : "Открыть заказ";
    await this.#transport.sendMail({
      from: this.#from, to: input.email, subject: input.title,
      text: `${input.text}\n\n${action}: ${url}`,
      html: `<p>${escapeHtml(input.text)}</p><p><a href="${escapeHtml(url)}">${action}</a></p>`,
    });
  }

  async sendEmailChangeLink(input: Parameters<EmailChangeSender["sendEmailChangeLink"]>[0]): Promise<void> {
    const url = new URL("/auth/email-change/confirm", this.#publicWebUrl);
    url.searchParams.set("token", input.rawToken);
    await this.#transport.sendMail({
      from: this.#from, to: input.email, subject: "Подтвердите новый email",
      text: `Подтвердить новый email: ${url}\n\nСсылка действует до ${input.expiresAt.toISOString()}.`,
      html: `<p><a href="${escapeHtml(url.toString())}">Подтвердить новый email</a></p><p>Ссылка действует до ${input.expiresAt.toISOString()}.</p>`,
    });
  }

  async sendAccountDeletionLink(input: Parameters<AccountDeletionEmailSender["sendAccountDeletionLink"]>[0]): Promise<void> {
    const url = new URL("/auth/account-deletion/confirm", this.#publicWebUrl);
    url.searchParams.set("token", input.rawToken);
    await this.#transport.sendMail({
      from: this.#from, to: input.email, subject: "Подтвердите удаление аккаунта",
      text: `Для удаления аккаунта Naiti Mastera перейдите по ссылке: ${url}\n\nСсылка действует до ${input.expiresAt.toISOString()}. Если вы не запрашивали удаление, не переходите по ссылке.`,
      html: `<p><a href="${escapeHtml(url.toString())}">Подтвердить удаление аккаунта</a></p><p>Ссылка действует до ${input.expiresAt.toISOString()}. Если вы не запрашивали удаление, не переходите по ссылке.</p>`,
    });
  }

  async sendEmailChangedNotice(input: Parameters<EmailChangeSender["sendEmailChangedNotice"]>[0]): Promise<void> {
    const text = `Email вашего аккаунта Naiti Mastera изменён на ${input.email}. Все прежние сессии завершены. Если вы не меняли email, обратитесь в поддержку.`;
    await this.#transport.sendMail({ from: this.#from, to: input.previousEmail,
      subject: "Email аккаунта изменён", text, html: `<p>${escapeHtml(text)}</p>` });
  }

  async sendOrderConfirmation(input: Readonly<{
    email: string;
    contactName: string;
    rawToken: string;
    expiresAt: Date;
  }>): Promise<void> {
    const confirmationUrl = buildOrderConfirmationUrl(this.#publicWebUrl, input.rawToken);
    const safeName = escapeHtml(input.contactName);
    const safeUrl = escapeHtml(confirmationUrl);
    const expiry = input.expiresAt.toISOString();

    await this.#transport.sendMail({
      from: this.#from,
      to: input.email,
      subject: "Подтвердите публикацию заказа",
      text: `Здравствуйте, ${input.contactName}!\n\nПодтвердите заказ: ${confirmationUrl}\n\nСсылка действует до ${expiry}.`,
      html: `<p>Здравствуйте, ${safeName}!</p><p><a href="${safeUrl}">Подтвердить и опубликовать заказ</a></p><p>Ссылка действует до ${escapeHtml(expiry)}.</p>`,
    });
  }

  async sendAuthenticationLink(input: Readonly<{
    email: string;
    purpose: EmailAuthPurpose;
    rawToken: string;
    expiresAt: Date;
  }>): Promise<void> {
    const url = buildAuthenticationUrl(this.#publicWebUrl, input.purpose, input.rawToken);
    const safeUrl = escapeHtml(url);
    const expiry = input.expiresAt.toISOString();
    const registration = input.purpose === "registration";
    const action = registration ? "Завершить регистрацию" : "Войти в аккаунт";
    await this.#transport.sendMail({
      from: this.#from,
      to: input.email,
      subject: registration ? "Завершите регистрацию" : "Вход в Naiti Mastera",
      text: `${action}: ${url}\n\nСсылка действует до ${expiry}.`,
      html: `<p><a href="${safeUrl}">${action}</a></p><p>Ссылка действует до ${escapeHtml(expiry)}.</p>`,
    });
  }
}

export class DevelopmentConfirmationEmailSender implements ConfirmationEmailSender, AuthenticationEmailSender, NotificationEmailSender, EmailChangeSender {
  readonly #publicWebUrl: string;

  constructor(publicWebUrl: string) {
    this.#publicWebUrl = publicWebUrl;
  }

  async sendNotification(input: Parameters<NotificationEmailSender["sendNotification"]>[0]): Promise<void> {
    const url = buildNotificationUrl(this.#publicWebUrl, input);
    console.info(`[development-email] ${input.title} for ${input.email}: ${url}`);
  }

  async sendEmailChangeLink(input: Parameters<EmailChangeSender["sendEmailChangeLink"]>[0]): Promise<void> {
    const url = new URL("/auth/email-change/confirm", this.#publicWebUrl);
    url.searchParams.set("token", input.rawToken);
    console.info(`[development-email] Confirm new email for ${input.email}: ${url}`);
  }

  async sendEmailChangedNotice(input: Parameters<EmailChangeSender["sendEmailChangedNotice"]>[0]): Promise<void> {
    console.info(`[development-email] Email changed for ${input.previousEmail} to ${input.email}`);
  }

  async sendAccountDeletionLink(input: Parameters<AccountDeletionEmailSender["sendAccountDeletionLink"]>[0]): Promise<void> {
    const url = new URL("/auth/account-deletion/confirm", this.#publicWebUrl);
    url.searchParams.set("token", input.rawToken);
    console.info(`[development-email] Confirm account deletion for ${input.email}: ${url}`);
  }

  async sendOrderConfirmation(input: Readonly<{
    email: string;
    contactName: string;
    rawToken: string;
    expiresAt: Date;
  }>): Promise<void> {
    const url = buildOrderConfirmationUrl(this.#publicWebUrl, input.rawToken);
    console.info(`[development-email] Order confirmation for ${input.email}: ${url}`);
  }

  async sendAuthenticationLink(input: Readonly<{
    email: string;
    purpose: EmailAuthPurpose;
    rawToken: string;
    expiresAt: Date;
  }>): Promise<void> {
    const url = buildAuthenticationUrl(this.#publicWebUrl, input.purpose, input.rawToken);
    console.info(`[development-email] ${input.purpose} for ${input.email}: ${url}`);
  }
}
