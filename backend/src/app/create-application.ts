import { randomUUID } from "node:crypto";
import { BidMessaging } from "../modules/marketplace/application/bid-messages.ts";
import { PgBidMessageRepository } from "../adapters/out/postgres/bid-message-repository.ts";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { WorkerSnapshot } from "../adapters/out/outbox/polling-worker.ts";
import { safeError } from "../shared/safe-error.ts";
import { Pool } from "pg";
import { createHttpServer } from "../adapters/in/http/http-server.ts";
import {
  DevelopmentConfirmationEmailSender,
  SmtpConfirmationEmailSender,
} from "../adapters/out/email/smtp-confirmation-email-sender.ts";
import { PollingOutboxWorker } from "../adapters/out/outbox/polling-outbox-worker.ts";
import { PgDatabase, PgTransactionManager } from "../adapters/out/postgres/database.ts";
import { runMigrations } from "../adapters/out/postgres/migrations.ts";
import { PgOutboxRepository } from "../adapters/out/postgres/outbox-repository.ts";
import { PgNotificationRepository } from "../adapters/out/postgres/notification-repository.ts";
import { PgNotificationPreferencesRepository } from "../adapters/out/postgres/notification-preferences-repository.ts";
import { GetNotificationPreferencesHandler, UpdateNotificationPreferencesHandler } from "../modules/notifications/application/notification-preferences.ts";
import { PgEmailChangeRepository } from "../adapters/out/postgres/email-change-repository.ts";
import { PgAccountDeletionRepository, PgAccountErasure } from "../adapters/out/postgres/account-deletion-repository.ts";
import { RequestAccountDeletionHandler, ConfirmAccountDeletionHandler, AccountDeletionMailHandler, CleanupDeletedAccountHandler, type AccountDeletionEmailSender } from "../modules/identity/application/account-deletion.ts";
import { RequestEmailChangeHandler, ConfirmEmailChangeHandler, EmailChangeMailHandler, type EmailChangeSender } from "../modules/identity/application/email-change.ts";
import {
  MarketplaceNotificationHandler, SendNotificationEmailHandler,
  ListNotificationsHandler, ReadNotificationHandler, type NotificationEmailSender,
} from "../modules/notifications/application/notifications.ts";
import { PgPublicRateLimiter } from "../adapters/out/postgres/public-rate-limiter.ts";
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
} from "../adapters/out/postgres/repositories.ts";
import {
  CryptoIdGenerator,
  HmacVerificationTokenService,
  PgSessionAuthenticator,
  PgSessionIssuer,
} from "../adapters/out/security/crypto-services.ts";
import type { Clock } from "../modules/marketplace/application/ports/guest-order-ports.ts";
import type { AuthenticationEmailSender } from "../modules/identity/application/ports/authentication-ports.ts";
import {
  ConfirmEmailAuthenticationHandler,
  EmailAuthenticationRequestedHandler,
  GetOwnAccountHandler,
  LogoutHandler,
  RequestEmailAuthenticationHandler,
} from "../modules/identity/application/authentication.ts";
import { RateLimitedAuthenticationRequestAccess } from "../modules/identity/application/authentication-request-access.ts";
import { ConfirmGuestOrderHandler } from "../modules/marketplace/application/use-cases/confirm-guest-order.ts";
import {
  CancelCustomerOrderHandler,
  GetCustomerOrderHandler,
  ListCustomerOrdersHandler,
  UpdateCustomerOrderHandler,
} from "../modules/marketplace/application/use-cases/customer-orders.ts";
import {
  GetPublicOrderHandler,
  ListContractorBidsHandler,
  ListOrderBidsHandler,
  ListPublicOrdersHandler,
  SelectBidHandler,
  SubmitBidHandler,
  WithdrawBidHandler,
} from "../modules/marketplace/application/use-cases/marketplace-bids.ts";
import { SubmitGuestOrderHandler } from "../modules/marketplace/application/use-cases/submit-guest-order.ts";
import { CompleteOrderHandler } from "../modules/marketplace/application/use-cases/order-lifecycle.ts";
import {
  GuestOrderSubmittedHandler,
  ProcessOutboxBatchHandler,
  type ConfirmationEmailSender,
} from "../modules/notifications/application/process-outbox.ts";
import type { AppConfig } from "./config.ts";
import {
  GetOwnContractorProfileHandler,
  UpsertContractorProfileHandler,
} from "../modules/contractors/application/contractor-profiles.ts";
import {
  GetContractorProfileHandler,
  ListContractorsHandler,
  ListContractorReviewsHandler,
  SubmitReviewHandler,
  GetOrderDealHandler,
} from "../modules/reputation/application/reputation.ts";
import {
  ConfirmAttachmentUploadHandler,
  ConfirmGuestAttachmentUploadHandler,
  GetPublicAttachmentPreviewUrlHandler,
  GetPublicAttachmentUrlHandler,
  GuestAttachmentClaimsService,
  RequestAttachmentUploadHandler,
  RequestGuestAttachmentUploadHandler,
  UploadedAttachmentUsagePolicy,
} from "../modules/attachments/application/attachments.ts";
import { ProcessAttachmentHandler } from "../modules/attachments/application/process-attachment.ts";
import { S3ObjectStorage } from "../adapters/out/storage/s3-object-storage.ts";
import { SharpImageSanitizer } from "../adapters/out/media/sharp-image-sanitizer.ts";
import { AllowAllMalwareScanner, ClamAvMalwareScanner } from "../adapters/out/security/clamav-malware-scanner.ts";
import { TurnstileHumanVerification } from "../adapters/out/security/turnstile-human-verification.ts";
import {
  AllowAllHumanVerification,
  ProtectedGuestUploadAccess,
} from "../modules/attachments/application/guest-upload-protection.ts";
import { CleanupExpiredGuestAttachmentsHandler } from "../modules/attachments/application/cleanup-attachments.ts";
import { CleanupUnusedAccountAttachmentsHandler } from "../modules/attachments/application/cleanup-account-attachments.ts";
import { PollingAttachmentCleanupWorker } from "../adapters/out/storage/polling-attachment-cleanup-worker.ts";
import {
  ActiveWorkCategorySelectionPolicy,
  ListWorkCategoriesHandler,
} from "../modules/catalog/application/work-categories.ts";
import {
  ActiveRussianLocationSelectionPolicy,
  ListRussianRegionsHandler,
  SearchRussianLocalitiesHandler,
} from "../modules/geography/application/russian-locations.ts";

class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export type Application = Readonly<{
  server: FastifyInstance;
  start(): Promise<void>;
  close(): Promise<void>;
  workerDiagnostics(): Readonly<{ outbox: WorkerSnapshot; attachmentCleanup: WorkerSnapshot }>;
}>;

function createEmailSender(config: AppConfig): ConfirmationEmailSender & AuthenticationEmailSender & NotificationEmailSender & EmailChangeSender & AccountDeletionEmailSender {
  if (config.mail.transport === "development") {
    return new DevelopmentConfirmationEmailSender(config.publicWebUrl);
  }

  return new SmtpConfirmationEmailSender({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    from: config.mail.from,
    publicWebUrl: config.publicWebUrl,
    ...(config.mail.user && config.mail.password
      ? { user: config.mail.user, password: config.mail.password }
      : {}),
  });
}

export async function createApplication(config: AppConfig): Promise<Application> {
  const pool = new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 2_000 });
  const healthPool = new Pool({ connectionString: config.databaseUrl, max: 1,
    connectionTimeoutMillis: 1_000, statement_timeout: 1_000, query_timeout: 1_500 });
  for (const databasePool of [pool, healthPool]) {
    databasePool.on("error", (error) => console.error(JSON.stringify({
      message: "Idle PostgreSQL connection failed", failure: safeError(error),
    })));
  }
  try {
    if (config.runMigrationsOnStart) {
      await runMigrations(pool, fileURLToPath(new URL("../../migrations", import.meta.url)));
    }

    const database = new PgDatabase(pool);
    const transactions = new PgTransactionManager(database);
    const submissions = new PgOrderSubmissionRepository(database);
    const accounts = new PgAccountRepository(database);
    const orders = new PgOrderRepository(database);
    const bids = new PgBidRepository(database);
    const customerOrderReads = new PgCustomerOrderReadRepository(database);
    const marketplaceReads = new PgMarketplaceReadRepository(database);
    const reviews = new PgReviewRepository(database);
    const reputationReads = new PgReputationReadRepository(database);
    const contractorProfiles = new PgContractorProfileRepository(database);
    const attachments = new PgAttachmentRepository(database);
    const emailAuthRequests = new PgEmailAuthRequestRepository(database);
    const emailChanges = new PgEmailChangeRepository(database);
    const deletionRequests = new PgAccountDeletionRepository(database);
    const accountErasure = new PgAccountErasure(database);
    const workCategories = new PgWorkCategoryRepository(database);
    const russianLocations = new PgRussianLocationRepository(database);
    const outbox = new PgOutboxRepository(database);
    const notifications = new PgNotificationRepository(database);
    const notificationPreferences = new PgNotificationPreferencesRepository(database);
    const tokens = new HmacVerificationTokenService(config.verificationTokenSecret);
    const ids = new CryptoIdGenerator();
    const clock = new SystemClock();
    const sessionAuthenticator = new PgSessionAuthenticator(database, clock);
    const sessions = new PgSessionIssuer(database, clock);
    const email = createEmailSender(config);
    const storage = new S3ObjectStorage(config.storage);
    const malwareScanner = config.malwareScanner.provider === "clamav"
      ? new ClamAvMalwareScanner(config.malwareScanner)
      : new AllowAllMalwareScanner();
    const attachmentUsage = new UploadedAttachmentUsagePolicy(attachments);
    const guestAttachments = new GuestAttachmentClaimsService({ attachments, tokens, clock });
    const humanVerification = config.uploadProtection.humanVerification.provider === "turnstile"
      ? new TurnstileHumanVerification(config.uploadProtection.humanVerification)
      : new AllowAllHumanVerification();
    const publicRateLimiter = new PgPublicRateLimiter(database, config.verificationTokenSecret);
    const guestUploadAccess = new ProtectedGuestUploadAccess({
      rateLimiter: publicRateLimiter,
      humanVerification,
      clock,
      limit: config.uploadProtection.rateLimit,
      windowSeconds: config.uploadProtection.rateLimitWindowSeconds,
    });
    const authenticationAccess = new RateLimitedAuthenticationRequestAccess({
      rateLimiter: publicRateLimiter,
      clock,
      ipLimit: config.authentication.rateLimitPerIp,
      emailLimit: config.authentication.rateLimitPerEmail,
      windowSeconds: config.authentication.rateLimitWindowSeconds,
    });
    const requestEmailAuthentication = new RequestEmailAuthenticationHandler({
      requests: emailAuthRequests,
      accounts,
      access: authenticationAccess,
      tokens,
      ids,
      clock,
      transactions,
      ttlMs: config.authentication.requestTtlSeconds * 1_000,
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
    const requestEmailChange = new RequestEmailChangeHandler({
      requests: emailChanges, accounts, access: authenticationAccess, tokens, ids, clock, transactions,
      ttlMs: config.authentication.requestTtlSeconds * 1000,
    });
    const confirmEmailChange = new ConfirmEmailChangeHandler({
      requests: emailChanges, accounts, tokens, clock, transactions, sessions,
      authenticationRequests: emailAuthRequests,
    });
    const emailChangeMail = new EmailChangeMailHandler({ requests: emailChanges, tokens, email, clock });
    const requestAccountDeletion = new RequestAccountDeletionHandler({
      requests: deletionRequests, accounts, erasure: accountErasure, transactions, tokens, clock,
      ids, access: authenticationAccess, ttlMs: config.authentication.requestTtlSeconds * 1000,
    });
    const confirmAccountDeletion = new ConfirmAccountDeletionHandler({
      requests: deletionRequests, accounts, erasure: accountErasure, transactions, tokens, clock,
      sessions, authenticationRequests: emailAuthRequests, emailChanges,
    });
    const accountDeletionMail = new AccountDeletionMailHandler({ requests: deletionRequests, accounts, tokens, clock, email });
    const cleanupDeletedAccount = new CleanupDeletedAccountHandler(accountErasure, storage);
    const getOwnAccount = new GetOwnAccountHandler(accounts);
    const listWorkCategories = new ListWorkCategoriesHandler(workCategories);
    const categorySelection = new ActiveWorkCategorySelectionPolicy(workCategories);
    const listRussianRegions = new ListRussianRegionsHandler(russianLocations);
    const searchRussianLocalities = new SearchRussianLocalitiesHandler(russianLocations);
    const locationSelection = new ActiveRussianLocationSelectionPolicy(russianLocations);

    const submitGuestOrder = new SubmitGuestOrderHandler({
      submissions,
      tokens,
      ids,
      clock,
      transactions,
      guestAttachments,
      categories: categorySelection,
      locations: locationSelection,
    });
    const confirmGuestOrder = new ConfirmGuestOrderHandler({
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
    const listCustomerOrders = new ListCustomerOrdersHandler(customerOrderReads);
    const getCustomerOrder = new GetCustomerOrderHandler(orders);
    const updateCustomerOrder = new UpdateCustomerOrderHandler({
      orders, categories: categorySelection, locations: locationSelection,
      attachments: attachmentUsage, clock, transactions,
    });
    const cancelCustomerOrder = new CancelCustomerOrderHandler({ orders, bids, clock, transactions });
    const listPublicOrders = new ListPublicOrdersHandler(marketplaceReads);
    const getPublicOrder = new GetPublicOrderHandler(marketplaceReads);
    const submitBid = new SubmitBidHandler({
      orders,
      bids,
      accounts,
      ids,
      clock,
      transactions,
    });
    const withdrawBid = new WithdrawBidHandler({ bids, clock, transactions });
    const listContractorBids = new ListContractorBidsHandler(marketplaceReads);
    const listOrderBids = new ListOrderBidsHandler(orders, marketplaceReads);
    const bidMessaging = new BidMessaging({ accounts, bids, orders, messages: new PgBidMessageRepository(database),
      transactions, notifications, ids, clock, rateLimiter: publicRateLimiter });
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
      uploadUrlTtlSeconds: config.storage.uploadUrlTtlSeconds,
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
      uploadUrlTtlSeconds: config.storage.uploadUrlTtlSeconds,
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
      downloadUrlTtlSeconds: config.storage.downloadUrlTtlSeconds,
    });
    const getPublicAttachmentPreviewUrl = new GetPublicAttachmentPreviewUrlHandler({
      attachments,
      storage,
      downloadUrlTtlSeconds: config.storage.downloadUrlTtlSeconds,
    });
    const processAttachment = new ProcessAttachmentHandler({
      attachments,
      storage,
      scanner: malwareScanner,
      images: new SharpImageSanitizer(),
      transactions,
      clock,
    });
    const guestOrderSubmitted = new GuestOrderSubmittedHandler({ submissions, tokens, email });
    const marketplaceNotification = new MarketplaceNotificationHandler({ orders, accounts, notifications, transactions, ids });
    const sendNotificationEmail = new SendNotificationEmailHandler({ notifications, accounts, email, clock, preferences: notificationPreferences });
    const getNotificationPreferences = new GetNotificationPreferencesHandler({ accounts, preferences: notificationPreferences });
    const updateNotificationPreferences = new UpdateNotificationPreferencesHandler({ accounts, preferences: notificationPreferences, transactions });
    const listNotifications = new ListNotificationsHandler(notifications);
    const readNotification = new ReadNotificationHandler(notifications, clock);
    const emailAuthenticationRequested = new EmailAuthenticationRequestedHandler({
      requests: emailAuthRequests,
      tokens,
      email,
    });
    let closed = false;
    const processOutbox = new ProcessOutboxBatchHandler(
      outbox,
      new Map([
        ["GuestOrderSubmitted", (message) => guestOrderSubmitted.execute(message)],
        ["BidSubmitted", (message) => marketplaceNotification.execute(message)],
        ["BidSelected", (message) => marketplaceNotification.execute(message)],
        ["OrderCompleted", (message) => marketplaceNotification.execute(message)],
        ["NotificationEmailRequested", (message) => sendNotificationEmail.execute(message.aggregateId)],
        ["AttachmentProcessingRequested", (message) => processAttachment.execute(message.aggregateId)],
        ["EmailAuthenticationRequested", (message) => emailAuthenticationRequested.execute(message.aggregateId)],
        ["EmailChangeRequested", (message) => emailChangeMail.requested(message.aggregateId)],
        ["AccountEmailChanged", (message) => emailChangeMail.changed(message)],
        ["AccountDeletionRequested", (message) => accountDeletionMail.execute(message.aggregateId)],
        ["AccountDeleted", (message) => cleanupDeletedAccount.execute(message.aggregateId)],
      ]),
      60_000,
      (failure) => server.log.error({ worker: "outbox", ...failure }, "Outbox event failed; retry scheduled"),
    );
    const server = createHttpServer({
      bidMessaging,
      getNotificationPreferences,
      updateNotificationPreferences,
      requestAccountDeletion,
      confirmAccountDeletion,
      requestEmailChange,
      confirmEmailChange,
      listNotifications,
      readNotification,
      listWorkCategories,
      listRussianRegions,
      searchRussianLocalities,
      submitGuestOrder,
      confirmGuestOrder,
      sessionAuthenticator,
      listCustomerOrders,
      getCustomerOrder,
      updateCustomerOrder,
      cancelCustomerOrder,
      listPublicOrders,
      listContractors,
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
      listContractorReviews,
      upsertContractorProfile,
      getOwnContractorProfile,
      requestAttachmentUpload,
      confirmAttachmentUpload,
      requestGuestAttachmentUpload,
      confirmGuestAttachmentUpload,
      guestUploadAccess,
      getPublicAttachmentUrl,
      getPublicAttachmentPreviewUrl,
      requestEmailAuthentication,
      confirmEmailAuthentication,
      logout,
      getOwnAccount,
      readinessCheck: async () => {
        if (closed) throw new Error("Application is shutting down");
        await healthPool.query("SELECT 1");
      },
      trustedProxyHops: config.trustedProxyHops,
      logger: config.environment !== "test",
    });
    const worker = new PollingOutboxWorker(processOutbox, server.log, {
      workerId: `api-${randomUUID()}`,
      pollIntervalMs: config.outboxPollIntervalMs,
      batchSize: config.outboxBatchSize,
    });
    const guestCleanup = new CleanupExpiredGuestAttachmentsHandler({
        attachments,
        storage,
        transactions,
        clock,
        unclaimedRetentionMs: config.uploadProtection.unclaimedRetentionSeconds * 1_000,
      });
    const accountCleanup = new CleanupUnusedAccountAttachmentsHandler({attachments, unused: attachments, storage, transactions, clock});
    const cleanupWorker = new PollingAttachmentCleanupWorker(
      {execute: async (id, limit) => await guestCleanup.execute(id, limit)
        + (config.uploadProtection.accountCleanupEnabled ? await accountCleanup.execute(id, limit) : 0)},
      server.log,
      {
        workerId: `attachments-${randomUUID()}`,
        intervalMs: config.uploadProtection.cleanupIntervalMs,
        batchSize: config.uploadProtection.cleanupBatchSize,
      },
    );
    let started = false;

    return {
      server,
      workerDiagnostics: () => ({ outbox: worker.snapshot(), attachmentCleanup: cleanupWorker.snapshot() }),
      async start(): Promise<void> {
        if (started) return;
        await server.listen({ host: config.host, port: config.port });
        started = true;
        worker.start();
        cleanupWorker.start();
      },
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        await Promise.all([worker.stop(), cleanupWorker.stop()]);
        await server.close();
        storage.destroy();
        await Promise.all([pool.end(), healthPool.end()]);
      },
    };
  } catch (error) {
    await Promise.all([pool.end(), healthPool.end()]);
    throw error;
  }
}
