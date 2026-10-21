import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";
import { Pool } from "pg";
import { createHttpServer } from "../../src/adapters/in/http/http-server.ts";
import { captureOpenApiResponseValidation } from "../helpers/openapi-response-validation.ts";
import { PgDatabase, PgTransactionManager } from "../../src/adapters/out/postgres/database.ts";
import { runMigrations } from "../../src/adapters/out/postgres/migrations.ts";
import { PgPublicRateLimiter } from "../../src/adapters/out/postgres/public-rate-limiter.ts";
import { PgOutboxRepository } from "../../src/adapters/out/postgres/outbox-repository.ts";
import { BidMessaging } from "../../src/modules/marketplace/application/bid-messages.ts";
import { PgBidMessageRepository } from "../../src/adapters/out/postgres/bid-message-repository.ts";
import { readOperationalDiagnostics } from "../../src/adapters/out/postgres/operational-diagnostics.ts";
import { PgNotificationRepository } from "../../src/adapters/out/postgres/notification-repository.ts";
import { PgNotificationPreferencesRepository } from "../../src/adapters/out/postgres/notification-preferences-repository.ts";
import { GetNotificationPreferencesHandler, UpdateNotificationPreferencesHandler } from "../../src/modules/notifications/application/notification-preferences.ts";
import { PgEmailChangeRepository } from "../../src/adapters/out/postgres/email-change-repository.ts";
import { PgAccountDeletionRepository, PgAccountErasure } from "../../src/adapters/out/postgres/account-deletion-repository.ts";
import { RequestAccountDeletionHandler, ConfirmAccountDeletionHandler, AccountDeletionMailHandler, CleanupDeletedAccountHandler } from "../../src/modules/identity/application/account-deletion.ts";
import { RequestEmailChangeHandler, ConfirmEmailChangeHandler, EmailChangeMailHandler } from "../../src/modules/identity/application/email-change.ts";
import { ListNotificationsHandler, ReadNotificationHandler, MarketplaceNotificationHandler, SendNotificationEmailHandler } from "../../src/modules/notifications/application/notifications.ts";
import {
  PgAccountRepository,
  PgAttachmentRepository,
  PgBidRepository,
  PgContractorProfileRepository,
  PgCustomerOrderReadRepository,
  PgEmailAuthRequestRepository,
  PgMarketplaceReadRepository,
  PgOrderRepository,
  PgOrderSubmissionRepository,
  PgReputationReadRepository,
  PgReviewRepository,
  PgRussianLocationRepository,
  PgWorkCategoryRepository,
} from "../../src/adapters/out/postgres/repositories.ts";
import {
  CryptoIdGenerator,
  HmacVerificationTokenService,
  PgSessionAuthenticator,
  PgSessionIssuer,
} from "../../src/adapters/out/security/crypto-services.ts";
import { Account } from "../../src/modules/identity/domain/account.ts";
import type {
  Clock,
  OrderRepository,
} from "../../src/modules/marketplace/application/ports/guest-order-ports.ts";
import { ConfirmGuestOrderHandler } from "../../src/modules/marketplace/application/use-cases/confirm-guest-order.ts";
import {
  CancelCustomerOrderHandler,
  GetCustomerOrderHandler,
  ListCustomerOrdersHandler,
  UpdateCustomerOrderHandler,
} from "../../src/modules/marketplace/application/use-cases/customer-orders.ts";
import {
  GetPublicOrderHandler,
  ListContractorBidsHandler,
  ListOrderBidsHandler,
  ListPublicOrdersHandler,
  SelectBidHandler,
  SubmitBidHandler,
  WithdrawBidHandler,
} from "../../src/modules/marketplace/application/use-cases/marketplace-bids.ts";
import { SubmitGuestOrderHandler } from "../../src/modules/marketplace/application/use-cases/submit-guest-order.ts";
import { CompleteOrderHandler } from "../../src/modules/marketplace/application/use-cases/order-lifecycle.ts";
import type { Order } from "../../src/modules/marketplace/domain/order.ts";
import {
  GuestOrderSubmittedHandler,
  ProcessOutboxBatchHandler,
  type ConfirmationEmailSender,
} from "../../src/modules/notifications/application/process-outbox.ts";
import { DomainError } from "../../src/shared/domain/domain-error.ts";
import { Email } from "../../src/shared/domain/value-objects.ts";
import {
  GetOwnContractorProfileHandler,
  UpsertContractorProfileHandler,
} from "../../src/modules/contractors/application/contractor-profiles.ts";
import type { ObjectStorage } from "../../src/modules/attachments/application/ports/attachment-ports.ts";
import {
  ConfirmAttachmentUploadHandler,
  ConfirmGuestAttachmentUploadHandler,
  GetPublicAttachmentPreviewUrlHandler,
  GetPublicAttachmentUrlHandler,
  GuestAttachmentClaimsService,
  RequestAttachmentUploadHandler,
  RequestGuestAttachmentUploadHandler,
  UploadedAttachmentUsagePolicy,
} from "../../src/modules/attachments/application/attachments.ts";
import { ProcessAttachmentHandler } from "../../src/modules/attachments/application/process-attachment.ts";
import { CleanupExpiredGuestAttachmentsHandler } from "../../src/modules/attachments/application/cleanup-attachments.ts";
import {
  ConfirmEmailAuthenticationHandler,
  GetOwnAccountHandler,
  LogoutHandler,
  RequestEmailAuthenticationHandler,
} from "../../src/modules/identity/application/authentication.ts";
import {
  GetContractorProfileHandler,
  ListContractorsHandler,
  ListContractorReviewsHandler,
  SubmitReviewHandler,
  GetOrderDealHandler,
} from "../../src/modules/reputation/application/reputation.ts";
import {
  ActiveWorkCategorySelectionPolicy,
  ListWorkCategoriesHandler,
} from "../../src/modules/catalog/application/work-categories.ts";
import {
  ActiveRussianLocationSelectionPolicy,
  ListRussianRegionsHandler,
  SearchRussianLocalitiesHandler,
} from "../../src/modules/geography/application/russian-locations.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const tokenSecret = "integration-test-secret-with-at-least-32-bytes";

class MutableClock implements Clock {
  current: Date;

  constructor(current: Date) {
    this.current = current;
  }

  now(): Date {
    return new Date(this.current);
  }
}

class RecordingEmailSender implements ConfirmationEmailSender {
  readonly messages: Array<{
    email: string;
    contactName: string;
    rawToken: string;
    expiresAt: Date;
  }> = [];

  async sendOrderConfirmation(input: Readonly<{
    email: string;
    contactName: string;
    rawToken: string;
    expiresAt: Date;
  }>): Promise<void> {
    this.messages.push({ ...input });
  }
}

class RecordingObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, { contentType: string; sizeBytes: number; body: Buffer }>();

  async createUploadUrl(input: Readonly<{
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }>): Promise<Readonly<{ url: string; headers: Readonly<Record<string, string>> }>> {
    const body = Buffer.alloc(input.sizeBytes, 1);
    if (input.contentType === "application/pdf") body.write("%PDF-1.7");
    this.objects.set(input.key, {
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      body,
    });
    return {
      url: `https://storage.test/upload/${encodeURIComponent(input.key)}`,
      headers: { "content-type": input.contentType },
    };
  }

  async stat(key: string): Promise<{ contentType: string; sizeBytes: number } | null> {
    const object = this.objects.get(key);
    return object ? { contentType: object.contentType, sizeBytes: object.sizeBytes } : null;
  }

  async get(key: string): Promise<Buffer> {
    const object = this.objects.get(key);
    if (!object) throw new Error(`Missing object: ${key}`);
    return object.body;
  }

  async put(input: Readonly<{ key: string; contentType: string; body: Buffer }>): Promise<void> {
    this.objects.set(input.key, {
      contentType: input.contentType,
      sizeBytes: input.body.byteLength,
      body: input.body,
    });
  }

  async createDownloadUrl(input: Readonly<{
    key: string;
    fileName: string;
    expiresInSeconds: number;
    disposition: "inline" | "attachment";
  }>): Promise<string> {
    return `https://storage.test/download/${encodeURIComponent(input.key)}?name=${encodeURIComponent(input.fileName)}`;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

const command = {
  email: "Customer@Example.com",
  contactName: "Анна",
  categoryId: "house-building",
  locationId: "ru-locality-1",
  title: "Построить загородный дом",
  description: "Ищу бригаду для строительства дома по готовому проекту.",
  budgetMinMinor: 5_000_000_00,
  budgetMaxMinor: 7_000_000_00,
  temporaryAttachments: [],
  consentVersion: "2026-01",
} as const;

test("PostgreSQL guest order workflow", { skip: !databaseUrl }, async (suite) => {
  assert.ok(databaseUrl);
  const schema = `integration_${randomUUID().replaceAll("-", "_")}`;
  const administrationPool = new Pool({ connectionString: databaseUrl, max: 1 });
  await administrationPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    options: `-c search_path=${schema}`,
  });

  suite.after(async () => {
    await pool.end();
    await administrationPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await administrationPool.end();
  });

  await runMigrations(pool, resolve("migrations"));

  async function resetDatabase(): Promise<void> {
    await pool.query(
      `TRUNCATE TABLE
         public_rate_limits, outbox_events, sessions, email_auth_requests, reviews, contractor_profiles, attachments, bids, order_submissions,
         orders, account_capabilities, accounts
       RESTART IDENTITY CASCADE`,
    );
  }

  function createFixture() {
    const database = new PgDatabase(pool);
    const notifications = new PgNotificationRepository(database);
    const notificationPreferences = new PgNotificationPreferencesRepository(database);
    const transactions = new PgTransactionManager(database);
    const submissions = new PgOrderSubmissionRepository(database);
    const accounts = new PgAccountRepository(database);
    const emailAuthRequests = new PgEmailAuthRequestRepository(database);
    const emailChanges = new PgEmailChangeRepository(database);
    const deletionRequests = new PgAccountDeletionRepository(database);
    const erasure = new PgAccountErasure(database);
    const orders = new PgOrderRepository(database);
    const bids = new PgBidRepository(database);
    const customerOrderReads = new PgCustomerOrderReadRepository(database);
    const marketplaceReads = new PgMarketplaceReadRepository(database);
    const reviews = new PgReviewRepository(database);
    const reputationReads = new PgReputationReadRepository(database);
    const contractorProfiles = new PgContractorProfileRepository(database);
    const attachments = new PgAttachmentRepository(database);
    const workCategories = new PgWorkCategoryRepository(database);
    const russianLocations = new PgRussianLocationRepository(database);
    const categorySelection = new ActiveWorkCategorySelectionPolicy(workCategories);
    const listWorkCategories = new ListWorkCategoriesHandler(workCategories);
    const locationSelection = new ActiveRussianLocationSelectionPolicy(russianLocations);
    const listRussianRegions = new ListRussianRegionsHandler(russianLocations);
    const searchRussianLocalities = new SearchRussianLocalitiesHandler(russianLocations);
    const storage = new RecordingObjectStorage();
    const attachmentUsage = new UploadedAttachmentUsagePolicy(attachments);
    const tokens = new HmacVerificationTokenService(tokenSecret);
    const ids = new CryptoIdGenerator();
    const clock = new MutableClock(new Date("2026-01-01T10:00:00.000Z"));
    const guestAttachments = new GuestAttachmentClaimsService({ attachments, tokens, clock });
    const rateLimiter = new PgPublicRateLimiter(database, tokenSecret);
    const sessions = new PgSessionIssuer(database, clock);
    const submit = new SubmitGuestOrderHandler({
      submissions,
      tokens,
      ids,
      clock,
      transactions,
      guestAttachments,
      categories: categorySelection,
      locations: locationSelection,
    });
    const confirm = new ConfirmGuestOrderHandler({
      submissions,
      accounts,
      orders,
      sessions,
      tokens,
      accountIds: ids,
      orderIds: ids,
      clock,
      transactions,
      guestAttachments,
    });
    const sessionAuthenticator = new PgSessionAuthenticator(database, clock);
    const requestEmailAuthentication = new RequestEmailAuthenticationHandler({
      requests: emailAuthRequests,
      accounts,
      access: { assertAllowed: async () => undefined },
      tokens,
      ids,
      clock,
      transactions,
    });
    const confirmEmailAuthentication = new ConfirmEmailAuthenticationHandler({
      requests: emailAuthRequests,
      accounts,
      sessions,
      tokens,
      ids,
      clock,
      transactions,
    });
    const logout = new LogoutHandler(sessions, clock);
    const requestAccountDeletion = new RequestAccountDeletionHandler({
      requests: deletionRequests, accounts, erasure, transactions, tokens, clock, ids,
      access: { assertAllowed: async () => undefined },
    });
    const confirmAccountDeletion = new ConfirmAccountDeletionHandler({
      requests: deletionRequests, accounts, erasure, transactions, tokens, clock,
      sessions, authenticationRequests: emailAuthRequests, emailChanges,
    });
    const requestEmailChange = new RequestEmailChangeHandler({
      requests: emailChanges, accounts, tokens, ids, clock, transactions,
      access: { assertAllowed: async () => undefined },
    });
    const confirmEmailChange = new ConfirmEmailChangeHandler({
      requests: emailChanges, accounts, tokens, clock, transactions, sessions, authenticationRequests: emailAuthRequests,
    });
    const getOwnAccount = new GetOwnAccountHandler(accounts);
    const listCustomerOrders = new ListCustomerOrdersHandler(customerOrderReads);
    const getCustomerOrder = new GetCustomerOrderHandler(orders);
    const updateCustomerOrder = new UpdateCustomerOrderHandler({
      orders, categories: categorySelection, locations: locationSelection,
      attachments: attachmentUsage, clock, transactions,
    });
    const cancelCustomerOrder = new CancelCustomerOrderHandler({ orders, bids, clock, transactions });
    const listPublicOrders = new ListPublicOrdersHandler(marketplaceReads);
    const getPublicOrder = new GetPublicOrderHandler(marketplaceReads);
    const submitBid = new SubmitBidHandler({ orders, bids, accounts, ids, clock, transactions });
    const withdrawBid = new WithdrawBidHandler({ bids, clock, transactions });
    const listContractorBids = new ListContractorBidsHandler(marketplaceReads);
    const listOrderBids = new ListOrderBidsHandler(orders, marketplaceReads);
    const selectBid = new SelectBidHandler({ orders, bids, accounts, clock, transactions });
    const completeOrder = new CompleteOrderHandler({ orders, clock, transactions });
    const getOrderDeal = new GetOrderDealHandler({ orders, reviews, transactions });
    const submitReview = new SubmitReviewHandler({ orders, reviews, ids, clock, transactions });
    const getContractorProfile = new GetContractorProfileHandler(reputationReads);
    const listContractors = new ListContractorsHandler(reputationReads);
    const listContractorReviews = new ListContractorReviewsHandler(reputationReads);
    const upsertContractorProfile = new UpsertContractorProfileHandler({
      accounts,
      profiles: contractorProfiles,
      clock,
      transactions,
      attachments: attachmentUsage,
      categories: categorySelection,
      locations: locationSelection,
    });
    const getOwnContractorProfile = new GetOwnContractorProfileHandler(contractorProfiles);
    const requestAttachmentUpload = new RequestAttachmentUploadHandler({
      accounts,
      attachments,
      storage,
      ids,
      clock,
      transactions,
      uploadUrlTtlSeconds: 900,
    });
    const confirmAttachmentUpload = new ConfirmAttachmentUploadHandler({
      attachments,
      storage,
      clock,
      transactions,
    });
    const requestGuestAttachmentUpload = new RequestGuestAttachmentUploadHandler({
      attachments,
      storage,
      tokens,
      ids,
      clock,
      transactions,
      uploadUrlTtlSeconds: 900,
    });
    const confirmGuestAttachmentUpload = new ConfirmGuestAttachmentUploadHandler({
      attachments,
      storage,
      tokens,
      clock,
      transactions,
    });
    const getPublicAttachmentUrl = new GetPublicAttachmentUrlHandler({
      attachments,
      storage,
      downloadUrlTtlSeconds: 900,
    });
    const getPublicAttachmentPreviewUrl = new GetPublicAttachmentPreviewUrlHandler({
      attachments,
      storage,
      downloadUrlTtlSeconds: 900,
    });
    const processAttachment = new ProcessAttachmentHandler({
      attachments,
      storage,
      scanner: { scan: async () => ({ clean: true }) },
      images: {
        sanitize: async () => ({
          content: Buffer.from("sanitized-image"),
          preview: Buffer.from("preview-image"),
          contentType: "image/webp",
        }),
      },
      transactions,
      clock,
    });

    return {
      notificationPreferences,
      getNotificationPreferences: new GetNotificationPreferencesHandler({ accounts, preferences: notificationPreferences }),
      updateNotificationPreferences: new UpdateNotificationPreferencesHandler({ accounts, preferences: notificationPreferences, transactions }),
      deletionRequests,
      erasure,
      requestAccountDeletion,
      confirmAccountDeletion,
      emailChanges,
      requestEmailChange,
      confirmEmailChange,
      notifications,
      bidMessaging: new BidMessaging({ accounts, bids, orders, messages: new PgBidMessageRepository(database),
        transactions, notifications, ids, clock, rateLimiter }),
      listNotifications: new ListNotificationsHandler(notifications),
      readNotification: new ReadNotificationHandler(notifications, clock),
      database,
      transactions,
      submissions,
      accounts,
      orders,
      bids,
      tokens,
      clock,
      storage,
      listWorkCategories,
      listRussianRegions,
      searchRussianLocalities,
      submit,
      confirm,
      sessionAuthenticator,
      listCustomerOrders,
      getCustomerOrder,
      updateCustomerOrder,
      cancelCustomerOrder,
      listPublicOrders,
      getPublicOrder,
      submitBid,
      withdrawBid,
      listContractorBids,
      listOrderBids,
      selectBid,
      completeOrder,
      getOrderDeal,
      submitReview,
      getContractorProfile,
      listContractors,
      listContractorReviews,
      upsertContractorProfile,
      getOwnContractorProfile,
      requestAttachmentUpload,
      confirmAttachmentUpload,
      requestGuestAttachmentUpload,
      confirmGuestAttachmentUpload,
      guestAttachments,
      guestUploadAccess: { assertAllowed: async () => undefined },
      rateLimiter,
      cleanupGuestAttachments: new CleanupExpiredGuestAttachmentsHandler({
        attachments,
        storage,
        transactions,
        clock,
        unclaimedRetentionMs: 0,
      }),
      getPublicAttachmentUrl,
      getPublicAttachmentPreviewUrl,
      processAttachment,
      requestEmailAuthentication,
      confirmEmailAuthentication,
      logout,
      getOwnAccount,
    };
  }

  await suite.test("operational diagnostics detect delayed, retrying and stale events without exposing payloads", async () => {
    await resetDatabase();
    const database = new PgDatabase(pool);
    const empty = await readOperationalDiagnostics(database);
    assert.equal(empty.status, "ok");
    assert.deepEqual(empty.issues, []);
    for (const kind of ["failed", "scheduled", "done"]) {
      await pool.query(`INSERT INTO outbox_events
        (id, event_type, aggregate_type, aggregate_id, payload, occurred_at, available_at, attempts, last_error, locked_at, processed_at)
        VALUES ($1, $2, 'Notification', $3, '{"email":"private@example.com","token":"private-token"}',
          now() - interval '1 hour',
          CASE WHEN $2 = 'scheduled' THEN now() + interval '1 hour' ELSE now() - interval '20 minutes' END,
          5, 'private-error', now() - interval '6 minutes', CASE WHEN $2 = 'done' THEN now() ELSE NULL END)`,
      [randomUUID(), kind, randomUUID()]);
    }
    const report = await readOperationalDiagnostics(database);
    assert.equal(report.status, "degraded");
    assert.deepEqual(report.issues, ["OUTBOX_REPEATED_FAILURES", "OUTBOX_STALE_LOCKS", "OUTBOX_OVERDUE"]);
    assert.equal(report.queues.length, 2);
    assert.equal(report.queues.find((q) => q.eventType === "failed")?.overdue, 1);
    assert.equal(report.queues.find((q) => q.eventType === "scheduled")?.overdue, 0);
    assert.doesNotMatch(JSON.stringify(report), /private@example.com|private-token|private-error/);
    const f = createFixture();
    const upload = await f.requestGuestAttachmentUpload.execute({ originalFileName: "private-file.pdf", contentType: "application/pdf", sizeBytes: 1024 });
    await pool.query(`UPDATE attachments SET status = 'processing',
      uploaded_at = now() - interval '20 minutes' WHERE id = $1`, [upload.attachment.id]);
    const stalled = await readOperationalDiagnostics(database);
    assert.ok(stalled.issues.includes("ATTACHMENTS_STALLED"));
    assert.deepEqual(stalled.attachments, [{ status: "processing", count: 1, stalled: 1 }]);
    assert.doesNotMatch(JSON.stringify(stalled), /private-file|private-token/);
    await resetDatabase();
  });

  await suite.test("work category migration seeds the canonical tree and all legacy mappings", async () => {
    const [categoryCount, legacyCount, constraints] = await Promise.all([
      pool.query<{ total: string }>("SELECT count(*) AS total FROM work_categories"),
      pool.query<{ total: string }>("SELECT count(*) AS total FROM work_category_legacy_refs"),
      pool.query<{ conname: string; convalidated: boolean }>(
        `SELECT conname, convalidated
         FROM pg_constraint
         WHERE conname IN ('orders_category_fk', 'order_submissions_category_fk')
           AND connamespace = current_schema()::regnamespace
         ORDER BY conname`,
      ),
    ]);

    assert.equal(categoryCount.rows[0]?.total, "50");
    assert.equal(legacyCount.rows[0]?.total, "92");
    assert.equal(constraints.rows.length, 2);
    assert.equal(constraints.rows.every((constraint) => constraint.convalidated), true);

    const tree = await createFixture().listWorkCategories.execute();
    assert.deepEqual(tree.map((category) => category.id), ["construction", "renovation", "services"]);
    assert.equal(tree.find((category) => category.id === "construction")?.children.length, 21);
  });

  await suite.test("Russian geography migration seeds regions, localities, legacy mappings, and valid foreign keys", async () => {
    const [regions, localities, legacyRefs, constraints] = await Promise.all([
      pool.query<{ total: string }>("SELECT count(*) AS total FROM russian_locations WHERE kind = 'region'"),
      pool.query<{ total: string }>("SELECT count(*) AS total FROM russian_locations WHERE kind = 'locality'"),
      pool.query<{ total: string }>("SELECT count(*) AS total FROM russian_location_legacy_refs"),
      pool.query<{ conname: string; convalidated: boolean }>(
        `SELECT conname, convalidated
         FROM pg_constraint
         WHERE conname IN ('orders_location_fk', 'order_submissions_location_fk')
           AND connamespace = current_schema()::regnamespace
         ORDER BY conname`,
      ),
    ]);

    assert.equal(regions.rows[0]?.total, "83");
    assert.equal(localities.rows[0]?.total, "668");
    assert.equal(legacyRefs.rows[0]?.total, "840");
    assert.equal(constraints.rows.length, 2);
    assert.equal(constraints.rows.every((constraint) => constraint.convalidated), true);

    const fixture = createFixture();
    const regionViews = await fixture.listRussianRegions.execute();
    const localityViews = await fixture.searchRussianLocalities.execute({ query: "Москва", limit: 10 });
    assert.equal(regionViews.length, 83);
    assert.equal(localityViews.some((location) => location.name === "Москва"), true);
  });

  await suite.test("submission and outbox are persisted without the raw token", async () => {
    await resetDatabase();
    const fixture = createFixture();
    const submitted = await fixture.submit.execute(command);
    const rawToken = fixture.tokens.issue(submitted.submissionId).raw;
    const stored = await pool.query<{
      token_hash: string;
      status: string;
      event_type: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT s.token_hash, s.status, e.event_type, e.payload
       FROM order_submissions s
       JOIN outbox_events e ON e.aggregate_id = s.id
       WHERE s.id = $1`,
      [submitted.submissionId],
    );

    assert.equal(stored.rowCount, 1);
    assert.equal(stored.rows[0]?.status, "pending_email");
    assert.equal(stored.rows[0]?.event_type, "GuestOrderSubmitted");
    assert.equal(stored.rows[0]?.token_hash, fixture.tokens.hash(rawToken));
    assert.equal(JSON.stringify(stored.rows[0]).includes(rawToken), false);
  });

  await suite.test("passwordless registration and login create revocable hashed sessions", async () => {
    await resetDatabase();
    const fixture = createFixture();
    await fixture.requestEmailAuthentication.execute({
      email: "Member@Example.com",
      purpose: "registration",
      clientAddress: "127.0.0.1",
    });
    const registration = await pool.query<{ id: string; token_hash: string }>(
      "SELECT id, token_hash FROM email_auth_requests WHERE email = 'member@example.com'",
    );
    const registrationId = registration.rows[0]?.id as string;
    const rawRegistrationToken = fixture.tokens.issue(`email-auth:${registrationId}`).raw;
    assert.equal(registration.rows[0]?.token_hash, fixture.tokens.hash(rawRegistrationToken));

    const registered = await fixture.confirmEmailAuthentication.execute(rawRegistrationToken, "registration");
    assert.equal(registered.createdAccount, true);
    assert.equal((await fixture.sessionAuthenticator.authenticate(registered.sessionToken))?.accountId, registered.accountId);
    await assert.rejects(
      fixture.confirmEmailAuthentication.execute(rawRegistrationToken, "registration"),
      (error: unknown) => error instanceof DomainError && error.code === "INVALID_AUTHENTICATION_TOKEN",
    );

    await fixture.logout.revokeCurrent(registered.sessionToken);
    assert.equal(await fixture.sessionAuthenticator.authenticate(registered.sessionToken), null);

    await fixture.requestEmailAuthentication.execute({
      email: "member@example.com",
      purpose: "login",
      clientAddress: "127.0.0.1",
    });
    const login = await pool.query<{ id: string }>(
      "SELECT id FROM email_auth_requests WHERE email = 'member@example.com' AND purpose = 'login'",
    );
    const rawLoginToken = fixture.tokens.issue(`email-auth:${login.rows[0]?.id as string}`).raw;
    const loggedIn = await fixture.confirmEmailAuthentication.execute(rawLoginToken, "login");
    assert.equal(loggedIn.createdAccount, false);
    assert.equal(loggedIn.accountId, registered.accountId);
    await fixture.logout.revokeAll(loggedIn.accountId);
    assert.equal(await fixture.sessionAuthenticator.authenticate(loggedIn.sessionToken), null);
  });

  await suite.test("an invalid attachment claim rolls the whole guest submission back", async () => {
    await resetDatabase();
    const fixture = createFixture();
    const requested = await fixture.requestGuestAttachmentUpload.execute({
      originalFileName: "plan.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
    });
    await fixture.confirmGuestAttachmentUpload.execute(requested.attachment.id, requested.claimToken);

    await assert.rejects(
      fixture.submit.execute({
        ...command,
        temporaryAttachments: [{
          attachmentId: requested.attachment.id,
          claimToken: "invalid-claim-token",
        }],
      }),
      (error: unknown) => error instanceof DomainError && error.code === "ATTACHMENT_NOT_FOUND",
    );
    const state = await pool.query<{ submissions: string; claimed_submission_id: string | null }>(
      `SELECT
         (SELECT count(*) FROM order_submissions) AS submissions,
         claimed_submission_id
       FROM attachments WHERE id = $1`,
      [requested.attachment.id],
    );
    assert.deepEqual(state.rows[0], { submissions: "0", claimed_submission_id: null });
  });

  await suite.test("email change confirms ownership, revokes old credentials and queues both emails", async () => {
    await resetDatabase();
    const fixture = createFixture();
    const submitted = await fixture.submit.execute(command);
    const owner = await fixture.confirm.execute(fixture.tokens.issue(submitted.submissionId).raw);
    await fixture.requestEmailAuthentication.execute({ email: command.email, purpose: "login", clientAddress: "127.0.0.1" });
    const pendingLogin = await pool.query<{ id: string }>("SELECT id FROM email_auth_requests WHERE purpose = 'login'");
    const oldLoginToken = fixture.tokens.issue(`email-auth:${pendingLogin.rows[0]!.id}`).raw;
    const request = async (email: string) => {
      await fixture.requestEmailChange.execute({ accountId: owner.accountId, email, clientAddress: "127.0.0.1" });
      const rows = await pool.query<{ id: string; token_hash: string }>(
        "SELECT id, token_hash FROM email_change_requests WHERE account_id = $1 AND status = 'pending'", [owner.accountId]);
      return rows.rows[0]!;
    };
    const first = await request("discarded@example.com");
    const second = await request("New@Example.com");
    const token = fixture.tokens.issue(`email-change:${second.id}`).raw;
    assert.equal(second.token_hash, fixture.tokens.hash(token));
    assert.equal(JSON.stringify(second).includes(token), false);
    assert.equal((await fixture.accounts.findById(owner.accountId))!.email.value, "customer@example.com");
    await assert.rejects(fixture.confirmEmailChange.execute(fixture.tokens.issue(`email-change:${first.id}`).raw),
      (error: unknown) => error instanceof DomainError && error.code === "INVALID_EMAIL_CHANGE_TOKEN");

    const links: Array<{ email: string; rawToken: string }> = [];
    const notices: Array<{ previousEmail: string; email: string }> = [];
    const mail = new EmailChangeMailHandler({
      requests: fixture.emailChanges, tokens: fixture.tokens, clock: fixture.clock,
      email: {
        sendEmailChangeLink: async (input) => { links.push(input); },
        sendEmailChangedNotice: async (input) => { notices.push(input); },
      },
    });
    const outbox = new PgOutboxRepository(fixture.database);
    const worker = new ProcessOutboxBatchHandler(outbox, new Map([
      ["EmailChangeRequested", (message) => mail.requested(message.aggregateId)],
      ["AccountEmailChanged", (message) => mail.changed(message)],
    ]));
    await worker.execute("email-change", 100);
    assert.deepEqual(links.map((item) => item.email), ["new@example.com"]);
    assert.equal(links[0]!.rawToken, token);

    const confirmations = await Promise.allSettled([
      fixture.confirmEmailChange.execute(token), fixture.confirmEmailChange.execute(token),
    ]);
    assert.equal(confirmations.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await fixture.accounts.findById(owner.accountId))!.email.value, "new@example.com");
    assert.equal(await fixture.sessionAuthenticator.authenticate(owner.sessionToken), null);
    await assert.rejects(fixture.confirmEmailAuthentication.execute(oldLoginToken, "login"),
      (error: unknown) => error instanceof DomainError && error.code === "INVALID_AUTHENTICATION_TOKEN");
    await worker.execute("email-change", 100);
    assert.deepEqual(notices, [{ previousEmail: "customer@example.com", email: "new@example.com" }]);

    await fixture.requestEmailAuthentication.execute({ email: "new@example.com", purpose: "login", clientAddress: "127.0.0.1" });
    const login = await pool.query<{ id: string }>("SELECT id FROM email_auth_requests WHERE email = 'new@example.com'");
    const authenticated = await fixture.confirmEmailAuthentication.execute(fixture.tokens.issue(`email-auth:${login.rows[0]!.id}`).raw, "login");
    assert.equal(authenticated.accountId, owner.accountId);
  });

  await suite.test("email change rejects occupied and expired addresses without mutating the account", async () => {
    await resetDatabase();
    const fixture = createFixture();
    const submitted = await fixture.submit.execute(command);
    const owner = await fixture.confirm.execute(fixture.tokens.issue(submitted.submissionId).raw);
    const input = { accountId: owner.accountId, email: "reserved@example.com", clientAddress: "127.0.0.1" };
    await fixture.requestEmailChange.execute(input);
    const rows = await pool.query<{ id: string }>("SELECT id FROM email_change_requests WHERE status = 'pending'");
    const token = fixture.tokens.issue(`email-change:${rows.rows[0]!.id}`).raw;
    await fixture.accounts.save(Account.registerVerified(randomUUID(), Email.create(input.email), fixture.clock.now()));
    await assert.rejects(fixture.confirmEmailChange.execute(token),
      (error: unknown) => error instanceof DomainError && error.code === "EMAIL_ALREADY_IN_USE");
    await assert.rejects(fixture.requestEmailChange.execute(input),
      (error: unknown) => error instanceof DomainError && error.code === "EMAIL_ALREADY_IN_USE");
    assert.equal((await fixture.emailChanges.findById(rows.rows[0]!.id))!.status, "pending");
    assert.equal((await fixture.accounts.findById(owner.accountId))!.email.value, "customer@example.com");
    assert.ok(await fixture.sessionAuthenticator.authenticate(owner.sessionToken));

    await fixture.requestEmailChange.execute({ ...input, email: "expired@example.com" });
    const expired = await pool.query<{ id: string }>("SELECT id FROM email_change_requests WHERE status = 'pending'");
    fixture.clock.current = new Date("2026-01-01T10:16:00Z");
    await assert.rejects(fixture.confirmEmailChange.execute(fixture.tokens.issue(`email-change:${expired.rows[0]!.id}`).raw),
      (error: unknown) => error instanceof DomainError && error.code === "EMAIL_CHANGE_EXPIRED");
    assert.equal((await fixture.accounts.findById(owner.accountId))!.email.value, "customer@example.com");
  });

  await suite.test("PostgreSQL rate limiting is atomic and stores only a hashed client key", async () => {
    await resetDatabase();
    const fixture = createFixture();
    const input = {
      action: "guest_attachment_upload",
      clientAddress: "203.0.113.10",
      limit: 1,
      windowSeconds: 900,
      occurredAt: fixture.clock.now(),
    } as const;

    const results = await Promise.all([
      fixture.rateLimiter.consume(input),
      fixture.rateLimiter.consume(input),
    ]);
    assert.deepEqual(results.map((result) => result.allowed).sort(), [false, true]);
    const denied = results.find((result) => !result.allowed) as { retryAfterSeconds: number };
    assert.equal(denied.retryAfterSeconds, 900);
    const stored = await pool.query<{ client_key: string; request_count: number }>(
      "SELECT client_key, request_count FROM public_rate_limits",
    );
    assert.equal(stored.rows[0]?.request_count, 2);
    assert.equal(stored.rows[0]?.client_key.includes(input.clientAddress), false);
  });

  await suite.test("notification preferences persist per account and suppress queued email without suppressing the inbox", async () => {
    await resetDatabase();
    const f = createFixture();
    const register = async (email: string) => {
      const submission = await f.submit.execute({ ...command, email });
      return f.confirm.execute(f.tokens.issue(submission.submissionId).raw);
    };
    const customer = await register("preferences-owner@example.com");
    const contractor = await register("preferences-contractor@example.com");
    const defaults = { email: { bidSubmitted: true, bidSelected: true, orderCompleted: true, messageReceived: true } };
    assert.deepEqual(await f.getNotificationPreferences.execute(customer.accountId), defaults);
    const notificationHandler = new MarketplaceNotificationHandler({ orders: f.orders, accounts: f.accounts,
      notifications: f.notifications, transactions: f.transactions, ids: new CryptoIdGenerator() });
    const sent: Array<{ email: string; notificationId: string }> = [];
    const mail = new SendNotificationEmailHandler({
      notifications: f.notifications, accounts: f.accounts, preferences: f.notificationPreferences,
      clock: f.clock, email: { sendNotification: async (input) => { sent.push(input); } },
    });
    const worker = new ProcessOutboxBatchHandler(new PgOutboxRepository(f.database), new Map([
      ["BidSubmitted", (message) => notificationHandler.execute(message)],
      ["BidSelected", (message) => notificationHandler.execute(message)],
      ["OrderCompleted", (message) => notificationHandler.execute(message)],
      ["NotificationEmailRequested", (message) => mail.execute(message.aggregateId)],
    ]));
    const bid = await f.submitBid.execute({ orderId: customer.orderId, contractorId: contractor.accountId,
      message: "Готов выполнить строительство.", priceMinMinor: null, priceMaxMinor: null,
      durationDaysMin: null, durationDaysMax: null, visibility: "public" });
    await worker.execute("preferences-test", 100);
    const inbox = await f.listNotifications.execute(customer.accountId, { limit: 20, offset: 0 });
    assert.equal(inbox.total, 1);
    assert.equal(inbox.unreadCount, 1);
    const disabled = { email: { bidSubmitted: false, bidSelected: true, orderCompleted: true, messageReceived: true } };
    await f.updateNotificationPreferences.execute(customer.accountId, disabled);
    await f.updateNotificationPreferences.execute(customer.accountId, disabled);
    assert.deepEqual(await f.getNotificationPreferences.execute(customer.accountId), disabled);
    assert.deepEqual(await f.getNotificationPreferences.execute(contractor.accountId), defaults);
    await worker.execute("preferences-test", 100);
    assert.equal(sent.length, 0);
    const skipped = await f.notifications.findById(inbox.items[0]!.id);
    assert.ok(skipped?.emailSkippedAt);
    assert.equal(skipped?.emailedAt, null);
    assert.equal((await f.listNotifications.execute(customer.accountId, { limit: 20, offset: 0 })).unreadCount, 1);

    await f.selectBid.execute(customer.accountId, customer.orderId, bid.id);
    await f.completeOrder.execute(customer.accountId, customer.orderId);
    await worker.execute("preferences-test", 100);
    await worker.execute("preferences-test", 100);
    assert.equal(sent.length, 3);
    assert.deepEqual(sent.map((item) => item.email).sort(), [
      "preferences-contractor@example.com", "preferences-contractor@example.com", "preferences-owner@example.com",
    ]);
    await f.updateNotificationPreferences.execute(customer.accountId, defaults);
    await mail.execute(inbox.items[0]!.id);
    assert.equal(sent.length, 3);
  });

  await suite.test("account deletion anonymizes identity, invalidates links and removes files while retaining completed deals", async () => {
    await resetDatabase();
    const f = createFixture();
    const register = async (email: string) => {
      const submitted = await f.submit.execute({ ...command, email });
      return f.confirm.execute(f.tokens.issue(submitted.submissionId).raw);
    };
    const customer = await register("erase-owner@example.com");
    const contractor = await register("erase-contractor@example.com");
    const bid = await f.submitBid.execute({ orderId: customer.orderId, contractorId: contractor.accountId,
      message: "Выполню строительство дома.", priceMinMinor: null, priceMaxMinor: null,
      durationDaysMin: null, durationDaysMax: null, visibility: "public" });
    await f.selectBid.execute(customer.accountId, customer.orderId, bid.id);
    await f.completeOrder.execute(customer.accountId, customer.orderId);
    const review = await f.submitReview.execute({ orderId: customer.orderId, authorId: customer.accountId,
      score: 5, text: "Работа выполнена качественно." });
    const file = await f.requestAttachmentUpload.execute({ ownerId: contractor.accountId, purpose: "profile_avatar",
      originalFileName: "private-avatar.webp", contentType: "image/webp", sizeBytes: 1024 });
    await f.confirmAttachmentUpload.execute(contractor.accountId, file.attachment.id);
    await f.processAttachment.execute(file.attachment.id);
    await f.upsertContractorProfile.execute({ accountId: contractor.accountId, displayName: "Частное имя",
      bio: "Личное описание", avatarAttachmentId: file.attachment.id,
      specializationIds: ["house-building"], serviceLocationIds: ["ru-region-43"], portfolio: [] });
    const pendingGuest = await f.submit.execute({ ...command, email: "erase-contractor@example.com" });
    const pendingGuestToken = f.tokens.issue(pendingGuest.submissionId).raw;
    await f.requestEmailAuthentication.execute({ email: "erase-contractor@example.com", purpose: "login", clientAddress: "127.0.0.1" });
    await f.requestEmailChange.execute({ accountId: contractor.accountId, email: "change-before-deletion@example.com", clientAddress: "127.0.0.1" });
    await f.updateNotificationPreferences.execute(contractor.accountId, { email: {
      bidSubmitted: false, bidSelected: false, orderCompleted: false,
    } });
    const change = await pool.query<{ id: string }>("SELECT id FROM email_change_requests WHERE account_id = $1", [contractor.accountId]);

    await f.requestAccountDeletion.execute({ accountId: contractor.accountId, clientAddress: "127.0.0.1" });
    const first = await pool.query<{ id: string }>("SELECT id FROM account_deletion_requests WHERE account_id = $1 AND status = 'pending'", [contractor.accountId]);
    await f.requestAccountDeletion.execute({ accountId: contractor.accountId, clientAddress: "127.0.0.1" });
    const current = await pool.query<{ id: string; token_hash: string }>("SELECT id, token_hash FROM account_deletion_requests WHERE account_id = $1 AND status = 'pending'", [contractor.accountId]);
    const token = f.tokens.issue(`account-deletion:${current.rows[0]!.id}`).raw;
    assert.equal(current.rows[0]!.token_hash, f.tokens.hash(token));
    assert.ok(await f.sessionAuthenticator.authenticate(contractor.sessionToken));
    await assert.rejects(f.confirmAccountDeletion.execute(f.tokens.issue(`account-deletion:${first.rows[0]!.id}`).raw),
      (error: unknown) => error instanceof DomainError && error.code === "INVALID_DELETION_TOKEN");
    const mails: string[] = [];
    const mail = new AccountDeletionMailHandler({ requests: f.deletionRequests, accounts: f.accounts, tokens: f.tokens,
      clock: f.clock, email: { sendAccountDeletionLink: async (input) => { mails.push(input.email); assert.equal(input.rawToken, token); } } });
    await mail.execute(first.rows[0]!.id);
    await mail.execute(current.rows[0]!.id);
    assert.deepEqual(mails, ["erase-contractor@example.com"]);

    const results = await Promise.allSettled([f.confirmAccountDeletion.execute(token), f.confirmAccountDeletion.execute(token)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const erased = (await f.accounts.findById(contractor.accountId))!;
    assert.equal(erased.status, "deleted");
    assert.equal(erased.email.value, `deleted-${contractor.accountId}@accounts.invalid`);
    assert.deepEqual(erased.capabilities, []);
    const preferencesRows = await pool.query<{ count: string }>("SELECT count(*) AS count FROM notification_preferences WHERE account_id = $1", [contractor.accountId]);
    assert.equal(preferencesRows.rows[0]!.count, "0");
    await assert.rejects(f.updateNotificationPreferences.execute(contractor.accountId, { email: {
      bidSubmitted: true, bidSelected: true, orderCompleted: true,
    } }), (error: unknown) => error instanceof DomainError && error.code === "ACCOUNT_NOT_ACTIVE");
    assert.equal(await f.sessionAuthenticator.authenticate(contractor.sessionToken), null);
    await assert.rejects(f.getContractorProfile.execute(contractor.accountId));
    await assert.rejects(f.getPublicOrder.execute(contractor.orderId));
    await assert.rejects(f.getPublicAttachmentUrl.execute(file.attachment.id));
    await assert.rejects(f.confirm.execute(pendingGuestToken),
      (error: unknown) => error instanceof DomainError && error.code === "INVALID_CONFIRMATION_TOKEN");
    await assert.rejects(f.confirmEmailChange.execute(f.tokens.issue(`email-change:${change.rows[0]!.id}`).raw));
    const identifiers = await pool.query<{ count: string }>(
      "SELECT count(*) AS count FROM order_submissions WHERE email = 'erase-contractor@example.com' OR contact_name = 'Частное имя'");
    assert.equal(identifiers.rows[0]!.count, "0");

    const cleanup = new CleanupDeletedAccountHandler(f.erasure, f.storage);
    await pool.query("UPDATE attachments SET expires_at = now() + interval '1 hour' WHERE id = $1", [file.attachment.id]);
    await assert.rejects(cleanup.execute(contractor.accountId), /waiting for upload URLs/);
    await pool.query("UPDATE attachments SET expires_at = now() - interval '1 second' WHERE id = $1", [file.attachment.id]);
    const removeObject = f.storage.delete.bind(f.storage);
    let storageFailure = true;
    f.storage.delete = async (key) => {
      if (storageFailure) { storageFailure = false; throw new Error("Storage unavailable"); }
      await removeObject(key);
    };
    await assert.rejects(cleanup.execute(contractor.accountId), /Storage unavailable/);
    await cleanup.execute(contractor.accountId);
    await cleanup.execute(contractor.accountId);
    assert.equal((await f.orders.findById(customer.orderId))!.status, "completed");
    assert.equal((await f.orders.findById(contractor.orderId))!.status, "cancelled");
    const history = await pool.query<{ id: string }>("SELECT id FROM reviews WHERE id = $1", [review.id]);
    assert.equal(history.rowCount, 1);
    const remainingFiles = await pool.query<{ count: string }>("SELECT count(*) AS count FROM attachments WHERE owner_id = $1", [contractor.accountId]);
    assert.equal(remainingFiles.rows[0]!.count, "0");
    assert.equal([...f.storage.objects.keys()].some((key) => key.includes(file.attachment.id)), false);
  });

  await suite.test("deletion checks ongoing work in both roles again at confirmation", async () => {
    await resetDatabase();
    const f = createFixture();
    const register = async (email: string) => {
      const submitted = await f.submit.execute({ ...command, email });
      return f.confirm.execute(f.tokens.issue(submitted.submissionId).raw);
    };
    const customer = await register("ongoing-owner@example.com");
    const contractor = await register("ongoing-contractor@example.com");
    for (const user of [customer, contractor]) {
      await f.requestAccountDeletion.execute({ accountId: user.accountId, clientAddress: "127.0.0.1" });
    }
    const bid = await f.submitBid.execute({ orderId: customer.orderId, contractorId: contractor.accountId,
      message: "Готов выполнить работу.", priceMinMinor: null, priceMaxMinor: null,
      durationDaysMin: null, durationDaysMax: null, visibility: "public" });
    await f.selectBid.execute(customer.accountId, customer.orderId, bid.id);
    for (const user of [customer, contractor]) {
      await assert.rejects(f.requestAccountDeletion.execute({ accountId: user.accountId, clientAddress: "127.0.0.1" }),
        (error: unknown) => error instanceof DomainError && error.code === "ACCOUNT_HAS_ONGOING_ORDERS");
      const request = await pool.query<{ id: string }>("SELECT id FROM account_deletion_requests WHERE account_id = $1 AND status = 'pending'", [user.accountId]);
      await assert.rejects(f.confirmAccountDeletion.execute(f.tokens.issue(`account-deletion:${request.rows[0]!.id}`).raw),
        (error: unknown) => error instanceof DomainError && error.code === "ACCOUNT_HAS_ONGOING_ORDERS");
      assert.equal((await f.accounts.findById(user.accountId))!.status, "active");
      assert.ok(await f.sessionAuthenticator.authenticate(user.sessionToken));
    }
  });

  await suite.test("selection and account deletion cannot leave a deleted contractor assigned to ongoing work", async () => {
    await resetDatabase();
    const f = createFixture();
    const register = async (email: string) => {
      const submitted = await f.submit.execute({ ...command, email });
      return f.confirm.execute(f.tokens.issue(submitted.submissionId).raw);
    };
    const customer = await register("race-owner@example.com");
    const contractor = await register("race-contractor@example.com");
    const bid = await f.submitBid.execute({ orderId: customer.orderId, contractorId: contractor.accountId,
      message: "Готов выполнить работу.", priceMinMinor: null, priceMaxMinor: null,
      durationDaysMin: null, durationDaysMax: null, visibility: "public" });
    await f.requestAccountDeletion.execute({ accountId: contractor.accountId, clientAddress: "127.0.0.1" });
    const requests = await pool.query<{ id: string }>("SELECT id FROM account_deletion_requests WHERE status = 'pending'");
    const token = f.tokens.issue(`account-deletion:${requests.rows[0]!.id}`).raw;
    const results = await Promise.allSettled([
      f.selectBid.execute(customer.accountId, customer.orderId, bid.id), f.confirmAccountDeletion.execute(token),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    for (const result of results) if (result.status === "rejected") {
      assert.ok(result.reason instanceof DomainError);
      assert.ok(["ACCOUNT_NOT_ACTIVE", "ACCOUNT_HAS_ONGOING_ORDERS"].includes(result.reason.code));
    }
    const status = (await f.accounts.findById(contractor.accountId))!.status;
    const orderStatus = (await f.orders.findById(customer.orderId))!.status;
    assert.equal(status === "deleted" && orderStatus === "in_progress", false);
  });

  await suite.test("cleanup removes an expired unclaimed guest object and its database row", async () => {
    await resetDatabase();
    const fixture = createFixture();
    const requested = await fixture.requestGuestAttachmentUpload.execute({
      originalFileName: "abandoned.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
    });
    const storageKey = requested.attachment.storageKey;
    fixture.clock.current = new Date("2026-01-01T10:16:00.000Z");

    assert.equal(await fixture.cleanupGuestAttachments.execute("cleanup-1", 10), 1);
    const stored = await pool.query<{ count: string }>(
      "SELECT count(*) FROM attachments WHERE id = $1",
      [requested.attachment.id],
    );
    assert.equal(stored.rows[0]?.count, "0");
    assert.equal(fixture.storage.objects.has(storageKey), false);
  });

  await suite.test("HTTP API submits and confirms an order end to end", async () => {
    await resetDatabase();
    const fixture = createFixture();
    const server = createHttpServer({
      bidMessaging: fixture.bidMessaging,
      getNotificationPreferences: fixture.getNotificationPreferences,
      updateNotificationPreferences: fixture.updateNotificationPreferences,
      requestAccountDeletion: fixture.requestAccountDeletion,
      confirmAccountDeletion: fixture.confirmAccountDeletion,
      requestEmailChange: fixture.requestEmailChange,
      confirmEmailChange: fixture.confirmEmailChange,
      listNotifications: fixture.listNotifications,
      readNotification: fixture.readNotification,
      listWorkCategories: fixture.listWorkCategories,
      listRussianRegions: fixture.listRussianRegions,
      searchRussianLocalities: fixture.searchRussianLocalities,
      submitGuestOrder: fixture.submit,
      confirmGuestOrder: fixture.confirm,
      sessionAuthenticator: fixture.sessionAuthenticator,
      listCustomerOrders: fixture.listCustomerOrders,
      getCustomerOrder: fixture.getCustomerOrder,
      updateCustomerOrder: fixture.updateCustomerOrder,
      cancelCustomerOrder: fixture.cancelCustomerOrder,
      listPublicOrders: fixture.listPublicOrders,
      listContractors: fixture.listContractors,
      getPublicOrder: fixture.getPublicOrder,
      submitBid: fixture.submitBid,
      withdrawBid: fixture.withdrawBid,
      listContractorBids: fixture.listContractorBids,
      listOrderBids: fixture.listOrderBids,
      selectBid: fixture.selectBid,
      completeOrder: fixture.completeOrder,
      getOrderDeal: fixture.getOrderDeal,
      submitReview: fixture.submitReview,
      getContractorProfile: fixture.getContractorProfile,
      listContractorReviews: fixture.listContractorReviews,
      upsertContractorProfile: fixture.upsertContractorProfile,
      getOwnContractorProfile: fixture.getOwnContractorProfile,
      requestAttachmentUpload: fixture.requestAttachmentUpload,
      confirmAttachmentUpload: fixture.confirmAttachmentUpload,
      requestGuestAttachmentUpload: fixture.requestGuestAttachmentUpload,
      confirmGuestAttachmentUpload: fixture.confirmGuestAttachmentUpload,
      guestUploadAccess: fixture.guestUploadAccess,
      getPublicAttachmentUrl: fixture.getPublicAttachmentUrl,
      getPublicAttachmentPreviewUrl: fixture.getPublicAttachmentPreviewUrl,
      requestEmailAuthentication: fixture.requestEmailAuthentication,
      confirmEmailAuthentication: fixture.confirmEmailAuthentication,
      logout: fixture.logout,
      getOwnAccount: fixture.getOwnAccount,
      readinessCheck: async () => {
        await fixture.database.query("SELECT 1");
      },
    });

    const verifyContract = captureOpenApiResponseValidation(server);
    try {
      const invalidCategoryResponse = await server.inject({
        method: "POST",
        url: "/api/v1/guest-orders",
        payload: { ...command, categoryId: "construction" },
      });
      assert.equal(invalidCategoryResponse.statusCode, 422);
      assert.equal(invalidCategoryResponse.json().error.code, "WORK_CATEGORY_NOT_SELECTABLE");

      const invalidLocationResponse = await server.inject({
        method: "POST",
        url: "/api/v1/guest-orders",
        payload: { ...command, locationId: "outside-russia" },
      });
      assert.equal(invalidLocationResponse.statusCode, 422);
      assert.equal(invalidLocationResponse.json().error.code, "RUSSIAN_LOCATION_NOT_FOUND");

      const guestUploadResponse = await server.inject({
        method: "POST",
        url: "/api/v1/guest-attachments/upload-requests",
        payload: {
          originalFileName: "project-plan.pdf",
          contentType: "application/pdf",
          sizeBytes: 4096,
        },
      });
      assert.equal(guestUploadResponse.statusCode, 201);
      const guestUpload = guestUploadResponse.json<{
        attachment: { id: string };
        claimToken: string;
      }>();
      const guestConfirmResponse = await server.inject({
        method: "POST",
        url: `/api/v1/guest-attachments/${guestUpload.attachment.id}/confirm`,
        payload: { claimToken: guestUpload.claimToken },
      });
      assert.equal(guestConfirmResponse.statusCode, 200);
      assert.equal(guestConfirmResponse.json().status, "processing");
      await fixture.processAttachment.execute(guestUpload.attachment.id);

      const submissionResponse = await server.inject({
        method: "POST",
        url: "/api/v1/guest-orders",
        payload: {
          ...command,
          temporaryAttachments: [{
            attachmentId: guestUpload.attachment.id,
            claimToken: guestUpload.claimToken,
          }],
        },
      });
      assert.equal(submissionResponse.statusCode, 202);
      const submission = submissionResponse.json<{ submissionId: string }>();

      const confirmationResponse = await server.inject({
        method: "POST",
        url: "/api/v1/guest-orders/confirm",
        payload: { token: fixture.tokens.issue(submission.submissionId).raw },
      });
      assert.equal(confirmationResponse.statusCode, 200);
      const confirmation = confirmationResponse.json<{
        accountId: string;
        orderId: string;
        session: { type: string; token: string };
      }>();
      assert.equal(confirmation.session.type, "Bearer");
      assert.ok(confirmation.session.token.length > 20);
      const authorization = { authorization: `Bearer ${confirmation.session.token}` };

      const persistedAttachment = await pool.query<{
        owner_id: string | null;
        guest_claim_token_hash: string | null;
        claimed_submission_id: string | null;
      }>(
        `SELECT owner_id, guest_claim_token_hash, claimed_submission_id
         FROM attachments WHERE id = $1`,
        [guestUpload.attachment.id],
      );
      assert.deepEqual(persistedAttachment.rows[0], {
        owner_id: confirmation.accountId,
        guest_claim_token_hash: null,
        claimed_submission_id: submission.submissionId,
      });
      const publicGuestAttachment = await server.inject({
        method: "GET",
        url: `/api/v1/attachments/${guestUpload.attachment.id}/download-url`,
      });
      assert.equal(publicGuestAttachment.statusCode, 200);

      const listResponse = await server.inject({
        method: "GET",
        url: "/api/v1/customer/orders",
        headers: authorization,
      });
      assert.equal(listResponse.statusCode, 200);
      assert.equal(listResponse.json<{ total: number }>().total, 1);

      const editUrl = `/api/v1/customer/orders/${confirmation.orderId}`;
      const editBody = {
        categoryId: "foundation", locationId: "ru-region-43",
        title: "Фундамент нового дома", description: "Нужно залить монолитный фундамент.",
        budgetMinMinor: 100_000_000, budgetMaxMinor: 200_000_000,
        attachmentIds: [guestUpload.attachment.id],
      };
      const originalOrder = (await fixture.orders.findById(confirmation.orderId))!.toSnapshot();
      const newUpload = await server.inject({
        method: "POST", url: "/api/v1/attachments/upload-requests", headers: authorization,
        payload: { purpose: "order", originalFileName: "foundation.pdf", contentType: "application/pdf", sizeBytes: 1024 },
      });
      assert.equal(newUpload.statusCode, 201);
      const newAttachmentId = newUpload.json().attachment.id as string;
      const pendingFileEdit = await server.inject({
        method: "PUT", url: editUrl, headers: authorization,
        payload: { ...editBody, attachmentIds: [newAttachmentId] },
      });
      assert.equal(pendingFileEdit.statusCode, 422);
      assert.equal(pendingFileEdit.json().error.code, "ATTACHMENT_NOT_USABLE");
      await fixture.confirmAttachmentUpload.execute(confirmation.accountId, newAttachmentId);
      await fixture.processAttachment.execute(newAttachmentId);

      const edited = await server.inject({ method: "PUT", url: editUrl, headers: authorization, payload: editBody });
      assert.equal(edited.statusCode, 200);
      assert.equal(edited.json().title, editBody.title);
      const storedEdit = (await fixture.orders.findById(confirmation.orderId))!.toSnapshot();
      assert.equal(storedEdit.categoryId, editBody.categoryId);
      assert.equal(storedEdit.locationId, editBody.locationId);
      assert.equal(storedEdit.description, editBody.description);
      assert.equal(storedEdit.budgetMaxMinor, editBody.budgetMaxMinor);
      assert.deepEqual(storedEdit.publishedAt, originalOrder.publishedAt);
      await server.inject({ method: "PUT", url: editUrl, headers: authorization, payload: editBody });
      const editEvents = await pool.query<{ total: string }>(
        "SELECT count(*) AS total FROM outbox_events WHERE event_type = 'OrderUpdated' AND aggregate_id = $1",
        [confirmation.orderId],
      );
      assert.equal(editEvents.rows[0]?.total, "1");
      const newFileEdit = await server.inject({
        method: "PUT", url: editUrl, headers: authorization,
        payload: { ...editBody, attachmentIds: [newAttachmentId] },
      });
      assert.equal(newFileEdit.statusCode, 200);
      const removedFile = await server.inject({ method: "GET", url: `/api/v1/attachments/${guestUpload.attachment.id}/download-url` });
      assert.equal(removedFile.statusCode, 404);
      const publicEditedOrder = await server.inject({ method: "GET", url: `/api/v1/orders/${confirmation.orderId}` });
      assert.equal(publicEditedOrder.json().title, editBody.title);
      assert.deepEqual(publicEditedOrder.json().attachmentIds, [newAttachmentId]);

      for (const invalid of [
        { categoryId: "construction" }, { locationId: "outside-russia" },
        { budgetMinMinor: 300_000_000 },
      ]) {
        const rejected = await server.inject({ method: "PUT", url: editUrl, headers: authorization, payload: { ...editBody, ...invalid } });
        assert.equal(rejected.statusCode, 422);
      }

      const otherSubmissionResponse = await server.inject({
        method: "POST",
        url: "/api/v1/guest-orders",
        payload: { ...command, email: "other@example.com" },
      });
      const otherSubmission = otherSubmissionResponse.json<{ submissionId: string }>();
      const otherConfirmationResponse = await server.inject({
        method: "POST",
        url: "/api/v1/guest-orders/confirm",
        payload: { token: fixture.tokens.issue(otherSubmission.submissionId).raw },
      });
      const otherOrderId = otherConfirmationResponse.json<{ orderId: string }>().orderId;
      const forbiddenDetail = await server.inject({
        method: "GET",
        url: `/api/v1/customer/orders/${otherOrderId}`,
        headers: authorization,
      });
      assert.equal(forbiddenDetail.statusCode, 404);
      assert.equal(forbiddenDetail.json().error.code, "ORDER_NOT_FOUND");
      const foreignEdit = await server.inject({
        method: "PUT", url: `/api/v1/customer/orders/${otherOrderId}`, headers: authorization, payload: editBody,
      });
      assert.equal(foreignEdit.statusCode, 404);
      const otherSession = otherConfirmationResponse.json().session.token as string;
      const foreignFileEdit = await server.inject({
        method: "PUT", url: `/api/v1/customer/orders/${otherOrderId}`,
        headers: { authorization: `Bearer ${otherSession}` },
        payload: { ...editBody, attachmentIds: [newAttachmentId] },
      });
      assert.equal(foreignFileEdit.statusCode, 422);
      assert.equal(foreignFileEdit.json().error.code, "ATTACHMENT_NOT_USABLE");

      const cancelResponse = await server.inject({
        method: "POST",
        url: `/api/v1/customer/orders/${confirmation.orderId}/cancel`,
        headers: authorization,
      });
      assert.equal(cancelResponse.statusCode, 200);
      assert.equal(cancelResponse.json<{ status: string }>().status, "cancelled");

      const order = await fixture.orders.findById(confirmation.orderId);
      assert.equal(order?.status, "cancelled");
      assert.equal(order?.customerId, confirmation.accountId);
      const cancelledEdit = await server.inject({ method: "PUT", url: editUrl, headers: authorization, payload: editBody });
      assert.equal(cancelledEdit.statusCode, 409);
      assert.equal(cancelledEdit.json().error.code, "ORDER_NOT_EDITABLE");

      fixture.clock.current = new Date("2026-02-01T10:00:00.000Z");
      const expiredSession = await server.inject({
        method: "GET",
        url: "/api/v1/customer/orders",
        headers: authorization,
      });
      assert.equal(expiredSession.statusCode, 401);
    } finally {
      await server.close();
      verifyContract();
    }
  });

  await suite.test("public marketplace and bid selection work end to end", async () => {
    await resetDatabase();
    const fixture = createFixture();
    const server = createHttpServer({
      bidMessaging: fixture.bidMessaging,
      getNotificationPreferences: fixture.getNotificationPreferences,
      updateNotificationPreferences: fixture.updateNotificationPreferences,
      requestAccountDeletion: fixture.requestAccountDeletion,
      confirmAccountDeletion: fixture.confirmAccountDeletion,
      requestEmailChange: fixture.requestEmailChange,
      confirmEmailChange: fixture.confirmEmailChange,
      listNotifications: fixture.listNotifications,
      readNotification: fixture.readNotification,
      listWorkCategories: fixture.listWorkCategories,
      listRussianRegions: fixture.listRussianRegions,
      searchRussianLocalities: fixture.searchRussianLocalities,
      submitGuestOrder: fixture.submit,
      confirmGuestOrder: fixture.confirm,
      sessionAuthenticator: fixture.sessionAuthenticator,
      listCustomerOrders: fixture.listCustomerOrders,
      getCustomerOrder: fixture.getCustomerOrder,
      updateCustomerOrder: fixture.updateCustomerOrder,
      cancelCustomerOrder: fixture.cancelCustomerOrder,
      listPublicOrders: fixture.listPublicOrders,
      listContractors: fixture.listContractors,
      getPublicOrder: fixture.getPublicOrder,
      submitBid: fixture.submitBid,
      withdrawBid: fixture.withdrawBid,
      listContractorBids: fixture.listContractorBids,
      listOrderBids: fixture.listOrderBids,
      selectBid: fixture.selectBid,
      completeOrder: fixture.completeOrder,
      getOrderDeal: fixture.getOrderDeal,
      submitReview: fixture.submitReview,
      getContractorProfile: fixture.getContractorProfile,
      listContractorReviews: fixture.listContractorReviews,
      upsertContractorProfile: fixture.upsertContractorProfile,
      getOwnContractorProfile: fixture.getOwnContractorProfile,
      requestAttachmentUpload: fixture.requestAttachmentUpload,
      confirmAttachmentUpload: fixture.confirmAttachmentUpload,
      requestGuestAttachmentUpload: fixture.requestGuestAttachmentUpload,
      confirmGuestAttachmentUpload: fixture.confirmGuestAttachmentUpload,
      guestUploadAccess: fixture.guestUploadAccess,
      getPublicAttachmentUrl: fixture.getPublicAttachmentUrl,
      getPublicAttachmentPreviewUrl: fixture.getPublicAttachmentPreviewUrl,
      requestEmailAuthentication: fixture.requestEmailAuthentication,
      confirmEmailAuthentication: fixture.confirmEmailAuthentication,
      logout: fixture.logout,
      getOwnAccount: fixture.getOwnAccount,
      readinessCheck: async () => {
        await fixture.database.query("SELECT 1");
      },
    });

    const verifyContract = captureOpenApiResponseValidation(server);
    async function register(email: string) {
      const submitted = await server.inject({
        method: "POST",
        url: "/api/v1/guest-orders",
        payload: { ...command, email },
      });
      const submissionId = submitted.json<{ submissionId: string }>().submissionId;
      const confirmed = await server.inject({
        method: "POST",
        url: "/api/v1/guest-orders/confirm",
        payload: { token: fixture.tokens.issue(submissionId).raw },
      });
      assert.equal(confirmed.statusCode, 200);
      return confirmed.json<{
        accountId: string;
        orderId: string;
        session: { token: string };
      }>();
    }

    const bidPayload = {
      message: "Готов выполнить работу качественно и точно в срок.",
      priceMinMinor: 510_000_000,
      priceMaxMinor: 620_000_000,
      durationDaysMin: 90,
      durationDaysMax: 120,
      visibility: "private",
    } as const;

    try {
      const customer = await register("owner@example.com");
      const contractorA = await register("contractor-a@example.com");
      const contractorB = await register("contractor-b@example.com");
      const customerAuth = { authorization: `Bearer ${customer.session.token}` };
      const contractorAAuth = { authorization: `Bearer ${contractorA.session.token}` };
      const contractorBAuth = { authorization: `Bearer ${contractorB.session.token}` };

      async function uploadAttachment(
        purpose: "profile_avatar" | "portfolio",
        originalFileName: string,
        contentType: "image/webp" | "image/jpeg",
        sizeBytes: number,
      ): Promise<string> {
        const requested = await server.inject({
          method: "POST",
          url: "/api/v1/attachments/upload-requests",
          headers: contractorAAuth,
          payload: { purpose, originalFileName, contentType, sizeBytes },
        });
        assert.equal(requested.statusCode, 201);
        assert.ok(requested.json().uploadUrl.startsWith("https://storage.test/upload/"));
        const attachmentId = requested.json().attachment.id as string;
        const confirmed = await server.inject({
          method: "POST",
          url: `/api/v1/attachments/${attachmentId}/confirm`,
          headers: contractorAAuth,
        });
        assert.equal(confirmed.statusCode, 200);
        assert.equal(confirmed.json().status, "processing");
        await fixture.processAttachment.execute(attachmentId);
        return attachmentId;
      }

      const avatarId = await uploadAttachment("profile_avatar", "avatar.webp", "image/webp", 1_024);
      const portfolioPhotoA = await uploadAttachment("portfolio", "facade.webp", "image/webp", 2_048);
      const portfolioPhotoB = await uploadAttachment("portfolio", "interior.jpg", "image/jpeg", 4_096);

      const contractorProfile = {
        displayName: "Бригада Мастер",
        bio: "Строим загородные дома под ключ.",
        avatarAttachmentId: avatarId,
        specializationIds: ["house-building"],
        serviceLocationIds: ["ru-region-43"],
        portfolio: [{
          title: "Дом в Истре",
          description: "Газобетонный дом площадью 180 м².",
          attachmentIds: [portfolioPhotoA, portfolioPhotoB],
        }],
      };
      const savedProfile = await server.inject({
        method: "PUT",
        url: "/api/v1/contractor/profile",
        headers: contractorAAuth,
        payload: contractorProfile,
      });
      assert.equal(savedProfile.statusCode, 200);
      assert.equal(savedProfile.json().displayName, contractorProfile.displayName);

      const ownProfile = await server.inject({
        method: "GET",
        url: "/api/v1/contractor/profile",
        headers: contractorAAuth,
      });
      assert.equal(ownProfile.statusCode, 200);
      assert.deepEqual(ownProfile.json().specializationIds, ["house-building"]);

      const publicAttachment = await server.inject({
        method: "GET",
        url: `/api/v1/attachments/${portfolioPhotoA}/download-url`,
      });
      assert.equal(publicAttachment.statusCode, 200);
      assert.ok(publicAttachment.json().url.startsWith("https://storage.test/download/"));

      const publicFeed = await server.inject({
        method: "GET",
        url: "/api/v1/orders?categoryId=house-building",
      });
      assert.equal(publicFeed.statusCode, 200);
      assert.equal(publicFeed.json<{ total: number }>().total, 3);
      assert.equal(publicFeed.json().items[0].categoryName, "Строительство домов и коттеджей");
      assert.equal(publicFeed.json().items[0].locationName, "Москва");
      assert.equal(publicFeed.json().items[0].regionId, "ru-region-1");

      const searchedOrders = await server.inject({
        method: "GET",
        url: "/api/v1/orders?query=%D0%B7%D0%B0%D0%B3%D0%BE%D1%80%D0%BE%D0%B4%D0%BD%D1%8B%D0%B9&regionId=ru-region-1&budgetMinMinor=500000000&sort=relevance",
      });
      assert.equal(searchedOrders.statusCode, 200);
      assert.equal(searchedOrders.json<{ total: number }>().total, 3);

      const searchedContractors = await server.inject({
        method: "GET",
        url: "/api/v1/contractors?query=%D0%B7%D0%B0%D0%B3%D0%BE%D1%80%D0%BE%D0%B4%D0%BD%D1%8B%D0%B5&specializationId=house-building&regionId=ru-region-43",
      });
      assert.equal(searchedContractors.statusCode, 200);
      assert.equal(searchedContractors.json<{ total: number }>().total, 1);
      assert.equal(searchedContractors.json().items[0].displayName, "Бригада Мастер");
      assert.equal(
        searchedContractors.json().items[0].specializations[0].name,
        "Строительство домов и коттеджей",
      );
      assert.equal(
        searchedContractors.json().items[0].serviceLocations[0].name,
        "Московская область",
      );

      const bidAResponse = await server.inject({
        method: "POST",
        url: `/api/v1/orders/${customer.orderId}/bids`,
        headers: contractorAAuth,
        payload: bidPayload,
      });
      const bidBResponse = await server.inject({
        method: "POST",
        url: `/api/v1/orders/${customer.orderId}/bids`,
        headers: contractorBAuth,
        payload: { ...bidPayload, visibility: "public" },
      });
      assert.equal(bidAResponse.statusCode, 201);
      assert.equal(bidBResponse.statusCode, 201);
      const bidA = bidAResponse.json<{ id: string }>();
      const bidB = bidBResponse.json<{ id: string }>();

      const duplicate = await server.inject({
        method: "POST",
        url: `/api/v1/orders/${customer.orderId}/bids`,
        headers: contractorAAuth,
        payload: bidPayload,
      });
      assert.equal(duplicate.statusCode, 409);
      assert.equal(duplicate.json().error.code, "BID_ALREADY_EXISTS");

      const customerBids = await server.inject({
        method: "GET",
        url: `/api/v1/customer/orders/${customer.orderId}/bids`,
        headers: customerAuth,
      });
      assert.equal(customerBids.statusCode, 200);
      assert.equal(customerBids.json<{ total: number }>().total, 2);

      const selected = await server.inject({
        method: "POST",
        url: `/api/v1/customer/orders/${customer.orderId}/bids/${bidA.id}/select`,
        headers: customerAuth,
      });
      assert.equal(selected.statusCode, 200);
      assert.equal(selected.json().orderStatus, "in_progress");
      assert.equal((await fixture.bids.findById(bidA.id))?.status, "selected");
      assert.equal((await fixture.bids.findById(bidB.id))?.status, "rejected");

      const assignedEdit = await server.inject({
        method: "PUT", url: `/api/v1/customer/orders/${customer.orderId}`, headers: customerAuth,
        payload: {
          categoryId: command.categoryId, locationId: command.locationId,
          title: "Попытка изменения условий", description: command.description,
          budgetMinMinor: null, budgetMaxMinor: null, attachmentIds: [],
        },
      });
      assert.equal(assignedEdit.statusCode, 409);
      assert.equal(assignedEdit.json().error.code, "ORDER_NOT_EDITABLE");

      const noLongerPublic = await server.inject({
        method: "GET",
        url: `/api/v1/orders/${customer.orderId}`,
      });
      assert.equal(noLongerPublic.statusCode, 404);

      const prematureReview = await server.inject({
        method: "POST",
        url: `/api/v1/orders/${customer.orderId}/reviews`,
        headers: customerAuth,
        payload: { score: 5, text: "Заказ пока ещё не завершён." },
      });
      assert.equal(prematureReview.statusCode, 409);
      assert.equal(prematureReview.json().error.code, "ORDER_NOT_COMPLETED");

      const strangerCompletion = await server.inject({
        method: "POST",
        url: `/api/v1/orders/${customer.orderId}/complete`,
        headers: contractorBAuth,
      });
      assert.equal(strangerCompletion.statusCode, 404);

      const completed = await server.inject({
        method: "POST",
        url: `/api/v1/orders/${customer.orderId}/complete`,
        headers: contractorAAuth,
      });
      assert.equal(completed.statusCode, 200);
      assert.equal(completed.json().status, "completed");

      const repeatedCompletion = await server.inject({
        method: "POST",
        url: `/api/v1/orders/${customer.orderId}/complete`,
        headers: customerAuth,
      });
      assert.equal(repeatedCompletion.statusCode, 200);
      assert.equal(repeatedCompletion.json().completedAt, completed.json().completedAt);

      const review = await server.inject({
        method: "POST",
        url: `/api/v1/orders/${customer.orderId}/reviews`,
        headers: customerAuth,
        payload: { score: 5, text: "Работа выполнена качественно и точно в срок." },
      });
      assert.equal(review.statusCode, 201);
      assert.equal(review.json().subjectId, contractorA.accountId);

      const duplicateReview = await server.inject({
        method: "POST",
        url: `/api/v1/orders/${customer.orderId}/reviews`,
        headers: customerAuth,
        payload: { score: 4, text: "Повторно оставить отзыв нельзя." },
      });
      assert.equal(duplicateReview.statusCode, 409);
      assert.equal(duplicateReview.json().error.code, "REVIEW_ALREADY_EXISTS");

      const profile = await server.inject({
        method: "GET",
        url: `/api/v1/contractors/${contractorA.accountId}`,
      });
      assert.equal(profile.statusCode, 200);
      assert.equal(profile.json().displayName, contractorProfile.displayName);
      assert.equal(profile.json().portfolio[0].attachmentIds.length, 2);
      assert.equal(profile.json().ratingAverage, 5);
      assert.equal(profile.json().reviewCount, 1);
      assert.equal(profile.json().completedOrderCount, 1);
      assert.equal("email" in profile.json(), false);

      const publicReviews = await server.inject({
        method: "GET",
        url: `/api/v1/contractors/${contractorA.accountId}/reviews`,
      });
      assert.equal(publicReviews.statusCode, 200);
      assert.equal(publicReviews.json<{ total: number }>().total, 1);
      assert.equal(publicReviews.json().items[0].orderTitle, command.title);

      const cannotCancelInProgress = await server.inject({
        method: "POST",
        url: `/api/v1/customer/orders/${customer.orderId}/cancel`,
        headers: customerAuth,
      });
      assert.equal(cannotCancelInProgress.statusCode, 409);

      const notificationHandler = new MarketplaceNotificationHandler({
        orders: fixture.orders, accounts: fixture.accounts, notifications: fixture.notifications,
        transactions: fixture.transactions, ids: new CryptoIdGenerator(),
      });
      const delivered: Array<{ email: string; notificationId: string }> = [];
      let failNextEmail = true;
      const emailHandler = new SendNotificationEmailHandler({
        preferences: fixture.notificationPreferences,
        notifications: fixture.notifications, accounts: fixture.accounts, clock: fixture.clock,
        email: { sendNotification: async (input) => {
          if (failNextEmail) { failNextEmail = false; throw new Error("SMTP unavailable"); }
          delivered.push(input);
        } },
      });
      const notificationWorker = new ProcessOutboxBatchHandler(
        new PgOutboxRepository(fixture.database),
        new Map([
          ["BidSubmitted", (message) => notificationHandler.execute(message)],
          ["BidSelected", (message) => notificationHandler.execute(message)],
          ["OrderCompleted", (message) => notificationHandler.execute(message)],
          ["NotificationEmailRequested", (message) => emailHandler.execute(message.aggregateId)],
        ]),
      );
      await notificationWorker.execute("notifications-test", 100);
      const notificationsState = await pool.query<{ total: string; queued: string }>(
        `SELECT (SELECT count(*) FROM notifications) AS total,
                (SELECT count(*) FROM outbox_events WHERE event_type = 'NotificationEmailRequested') AS queued`,
      );
      assert.deepEqual(notificationsState.rows[0], { total: "5", queued: "5" });

      // Re-delivery of the same source event, including concurrent workers, must not fan out twice.
      const source = await pool.query<{ id: string; aggregate_id: string; payload: Record<string, unknown>; occurred_at: Date }>(
        "SELECT id, aggregate_id, payload, occurred_at FROM outbox_events WHERE event_type = 'OrderCompleted'",
      );
      const sourceEvent = source.rows[0]!;
      const replay = {
        id: sourceEvent.id, eventType: "OrderCompleted", aggregateType: "Order",
        aggregateId: sourceEvent.aggregate_id, payload: sourceEvent.payload,
        occurredAt: sourceEvent.occurred_at, attempts: 2,
      };
      await Promise.all([notificationHandler.execute(replay), notificationHandler.execute(replay)]);
      const replayState = await pool.query<{ total: string }>("SELECT count(*) AS total FROM notifications");
      assert.equal(replayState.rows[0]?.total, "5");

      // The inbox remains available even when SMTP fails; only failed delivery is retried.
      await notificationWorker.execute("notifications-test", 100);
      assert.equal(delivered.length, 4);
      const failedMail = await pool.query<{ total: string }>(
        "SELECT count(*) AS total FROM outbox_events WHERE event_type = 'NotificationEmailRequested' AND last_error IS NOT NULL AND processed_at IS NULL",
      );
      assert.equal(failedMail.rows[0]?.total, "1");
      await pool.query(
        "UPDATE outbox_events SET available_at = now() WHERE event_type = 'NotificationEmailRequested' AND processed_at IS NULL",
      );
      await notificationWorker.execute("notifications-test", 100);
      assert.equal(delivered.length, 5);
      assert.equal(new Set(delivered.map((item) => item.notificationId)).size, 5);
      assert.deepEqual(delivered.map((item) => item.email).sort(), [
        "contractor-a@example.com", "contractor-a@example.com", "owner@example.com", "owner@example.com", "owner@example.com",
      ]);
      await emailHandler.execute(delivered[0]!.notificationId);
      assert.equal(delivered.length, 5);

      const inbox = await server.inject({ method: "GET", url: "/api/v1/notifications?limit=2&offset=0", headers: customerAuth });
      assert.equal(inbox.statusCode, 200);
      assert.equal(inbox.json().total, 3);
      assert.equal(inbox.json().unreadCount, 3);
      assert.equal(inbox.json().items.length, 2);
      assert.equal("sourceEventId" in inbox.json().items[0], false);
      const notificationId = inbox.json().items[0].id as string;
      const forbiddenRead = await server.inject({
        method: "POST", url: `/api/v1/notifications/${notificationId}/read`, headers: contractorBAuth,
      });
      assert.equal(forbiddenRead.statusCode, 404);
      for (let attempt = 0; attempt < 2; attempt++) {
        const read = await server.inject({
          method: "POST", url: `/api/v1/notifications/${notificationId}/read`, headers: customerAuth,
        });
        assert.equal(read.statusCode, 204);
      }
      const readInbox = await server.inject({ method: "GET", url: "/api/v1/notifications", headers: customerAuth });
      assert.equal(readInbox.json().unreadCount, 2);
      const strangerInbox = await server.inject({ method: "GET", url: "/api/v1/notifications", headers: contractorBAuth });
      assert.equal(strangerInbox.json().total, 0);

      const withdrawable = await server.inject({
        method: "POST",
        url: `/api/v1/orders/${contractorA.orderId}/bids`,
        headers: customerAuth,
        payload: bidPayload,
      });
      const withdrawableBidId = withdrawable.json<{ id: string }>().id;
      const withdrawn = await server.inject({
        method: "POST",
        url: `/api/v1/contractor/bids/${withdrawableBidId}/withdraw`,
        headers: customerAuth,
      });
      assert.equal(withdrawn.statusCode, 200);
      assert.equal(withdrawn.json().status, "withdrawn");

      const capability = await pool.query<{ capability: string }>(
        `SELECT capability FROM account_capabilities
         WHERE account_id = $1 AND capability = 'contractor'`,
        [contractorA.accountId],
      );
      assert.equal(capability.rowCount, 1);
    } finally {
      await server.close();
      verifyContract();
    }
  });

  await suite.test("two concurrent confirmations publish exactly one order", async () => {
    await resetDatabase();
    const fixture = createFixture();
    const submitted = await fixture.submit.execute(command);
    const rawToken = fixture.tokens.issue(submitted.submissionId).raw;

    const [first, second] = await Promise.all([
      fixture.confirm.execute(rawToken),
      fixture.confirm.execute(rawToken),
    ]);

    assert.equal(first.accountId, second.accountId);
    assert.equal(first.orderId, second.orderId);
    assert.equal([first.alreadyConfirmed, second.alreadyConfirmed].filter(Boolean).length, 1);

    const counts = await pool.query<{
      accounts: string;
      orders: string;
      sessions: string;
      confirmed: string;
    }>(
      `SELECT
         (SELECT count(*) FROM accounts) AS accounts,
         (SELECT count(*) FROM orders) AS orders,
         (SELECT count(*) FROM sessions) AS sessions,
         (SELECT count(*) FROM order_submissions WHERE status = 'confirmed') AS confirmed`,
    );
    assert.deepEqual(counts.rows[0], {
      accounts: "1",
      orders: "1",
      sessions: "2",
      confirmed: "1",
    });
  });

  await suite.test("confirmation reuses an existing account", async () => {
    await resetDatabase();
    const fixture = createFixture();
    const existing = Account.registerVerified(
      new CryptoIdGenerator().next(),
      Email.create(command.email),
      fixture.clock.now(),
    );
    await fixture.transactions.execute(() => fixture.accounts.save(existing));
    const submitted = await fixture.submit.execute(command);

    const result = await fixture.confirm.execute(fixture.tokens.issue(submitted.submissionId).raw);

    assert.equal(result.accountId, existing.id);
    assert.equal(result.reusedAccount, true);
    const accountCount = await pool.query<{ count: string }>("SELECT count(*) FROM accounts");
    assert.equal(accountCount.rows[0]?.count, "1");
  });

  await suite.test("failed order persistence rolls the entire confirmation back", async () => {
    await resetDatabase();
    const fixture = createFixture();
    const submitted = await fixture.submit.execute(command);
    const failingOrders: OrderRepository = {
      findById: (orderId: string) => fixture.orders.findById(orderId),
      save: async (_order: Order) => {
        throw new Error("simulated order write failure");
      },
    };
    const confirm = new ConfirmGuestOrderHandler({
      submissions: fixture.submissions,
      accounts: fixture.accounts,
      orders: failingOrders,
      sessions: new PgSessionIssuer(fixture.database, fixture.clock),
      tokens: fixture.tokens,
      accountIds: new CryptoIdGenerator(),
      orderIds: new CryptoIdGenerator(),
      clock: fixture.clock,
      transactions: fixture.transactions,
      guestAttachments: fixture.guestAttachments,
    });

    await assert.rejects(
      confirm.execute(fixture.tokens.issue(submitted.submissionId).raw),
      /simulated order write failure/,
    );
    const state = await pool.query<{
      accounts: string;
      orders: string;
      status: string;
    }>(
      `SELECT
         (SELECT count(*) FROM accounts) AS accounts,
         (SELECT count(*) FROM orders) AS orders,
         (SELECT status FROM order_submissions WHERE id = $1) AS status`,
      [submitted.submissionId],
    );
    assert.deepEqual(state.rows[0], { accounts: "0", orders: "0", status: "pending_email" });
  });

  await suite.test("expired token does not create account or order", async () => {
    await resetDatabase();
    const fixture = createFixture();
    const submitted = await fixture.submit.execute(command);
    fixture.clock.current = submitted.expiresAt;

    await assert.rejects(
      fixture.confirm.execute(fixture.tokens.issue(submitted.submissionId).raw),
      (error: unknown) => error instanceof DomainError && error.code === "SUBMISSION_EXPIRED",
    );
    const state = await pool.query<{ accounts: string; orders: string }>(
      `SELECT
         (SELECT count(*) FROM accounts) AS accounts,
         (SELECT count(*) FROM orders) AS orders`,
    );
    assert.deepEqual(state.rows[0], { accounts: "0", orders: "0" });
  });

  await suite.test("outbox worker reconstructs and sends the confirmation token", async () => {
    await resetDatabase();
    const fixture = createFixture();
    const submitted = await fixture.submit.execute(command);
    const email = new RecordingEmailSender();
    const notification = new GuestOrderSubmittedHandler({
      submissions: fixture.submissions,
      tokens: fixture.tokens,
      email,
    });
    const worker = new ProcessOutboxBatchHandler(
      new PgOutboxRepository(fixture.database),
      new Map([["GuestOrderSubmitted", (message) => notification.execute(message)]]),
    );

    const processed = await worker.execute("integration-worker");

    assert.equal(processed, 1);
    assert.equal(email.messages.length, 1);
    assert.equal(email.messages[0]?.email, "customer@example.com");
    assert.equal(email.messages[0]?.rawToken, fixture.tokens.issue(submitted.submissionId).raw);
    const outbox = await pool.query<{ processed_at: Date | null; attempts: number }>(
      "SELECT processed_at, attempts FROM outbox_events",
    );
    assert.ok(outbox.rows[0]?.processed_at instanceof Date);
    assert.equal(outbox.rows[0]?.attempts, 1);
  });
});
