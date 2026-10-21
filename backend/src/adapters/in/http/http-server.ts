import Fastify, {
  LogController,
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
} from "fastify";
import { registerApiDocumentation } from "./api-documentation.ts";
import { checkWithTimeout, httpLogSerializers, newRequestId, registerRequestObservability } from "./observability.ts";
import { safeError } from "../../../shared/safe-error.ts";
import type {
  AuthenticatedAccount,
  SessionAuthenticator,
} from "../../../modules/identity/application/session-authentication.ts";
import type { CustomerOrderPage } from "../../../modules/marketplace/application/ports/customer-order-ports.ts";
import type {
  BidListItem,
  Page,
  PublicOrderListItem,
  PublicOrderSort,
  PublicOrderView,
} from "../../../modules/marketplace/application/ports/bid-ports.ts";
import type {
  BidView,
  SelectBidResult,
  SubmitBidCommand,
} from "../../../modules/marketplace/application/use-cases/marketplace-bids.ts";
import type { CustomerOrderView } from "../../../modules/marketplace/application/use-cases/customer-orders.ts";
import type { UpdateCustomerOrderHandler, UpdateCustomerOrderCommand } from "../../../modules/marketplace/application/use-cases/customer-orders.ts";
import type { CompletedOrderView } from "../../../modules/marketplace/application/use-cases/order-lifecycle.ts";
import type {
  ConfirmGuestOrderHandler,
  ConfirmGuestOrderResult,
} from "../../../modules/marketplace/application/use-cases/confirm-guest-order.ts";
import type {
  SubmitGuestOrderCommand,
  SubmitGuestOrderHandler,
  SubmitGuestOrderResult,
} from "../../../modules/marketplace/application/use-cases/submit-guest-order.ts";
import { DomainError } from "../../../shared/domain/domain-error.ts";
import type { RequestEmailChangeHandler, ConfirmEmailChangeHandler } from "../../../modules/identity/application/email-change.ts";
import type { RequestAccountDeletionHandler, ConfirmAccountDeletionHandler } from "../../../modules/identity/application/account-deletion.ts";
import type { ListNotificationsHandler, ReadNotificationHandler } from "../../../modules/notifications/application/notifications.ts";
import type { GetNotificationPreferencesHandler, UpdateNotificationPreferencesHandler } from "../../../modules/notifications/application/notification-preferences.ts";
import type { NotificationPreferencesInput } from "../../../modules/notifications/domain/notification-preferences.ts";
import type { BidMessaging } from "../../../modules/marketplace/application/bid-messages.ts";
import type {
  PublicContractorProfile,
  PublicContractorPage,
  PublicContractorSort,
  PublicReviewPage,
} from "../../../modules/reputation/application/ports/reputation-ports.ts";
import type {
  ReviewView,
  OrderDealView,
  SubmitReviewCommand,
} from "../../../modules/reputation/application/reputation.ts";
import type {
  UpsertContractorProfileCommand,
} from "../../../modules/contractors/application/contractor-profiles.ts";
import type { ContractorProfileSnapshot } from "../../../modules/contractors/domain/contractor-profile.ts";
import type {
  AttachmentUploadRequest,
  GuestAttachmentUploadRequest,
  RequestAttachmentUploadCommand,
  RequestGuestAttachmentUploadCommand,
} from "../../../modules/attachments/application/attachments.ts";
import type { AttachmentSnapshot } from "../../../modules/attachments/domain/attachment.ts";
import type { GuestUploadAccessPolicy } from "../../../modules/attachments/application/ports/attachment-ports.ts";
import type {
  ConfirmEmailAuthenticationResult,
  RequestEmailAuthenticationCommand,
} from "../../../modules/identity/application/authentication.ts";
import type { WorkCategoryTreeNode } from "../../../modules/catalog/domain/work-category.ts";
import type {
  RussianLocalityView,
  RussianRegionView,
} from "../../../modules/geography/application/russian-locations.ts";

type GuestOrderBody = {
  email: string;
  contactName: string;
  categoryId: string;
  locationId: string;
  title: string;
  description: string;
  budgetMinMinor: number | null;
  budgetMaxMinor: number | null;
  temporaryAttachments?: Array<{ attachmentId: string; claimToken: string }>;
  consentVersion: string;
};

type ConfirmGuestOrderBody = {
  token: string;
};

type CustomerOrderParams = {
  orderId: string;
};

type CustomerOrderListQuery = {
  limit?: number;
  offset?: number;
};

type PublicOrderListQuery = CustomerOrderListQuery & {
  query?: string;
  categoryId?: string;
  regionId?: string;
  locationId?: string;
  budgetMinMinor?: number;
  budgetMaxMinor?: number;
  sort?: PublicOrderSort;
};

type PublicContractorListQuery = CustomerOrderListQuery & {
  query?: string;
  specializationId?: string;
  regionId?: string;
  locationId?: string;
  minRating?: number;
  sort?: PublicContractorSort;
};

type BidBody = {
  message: string;
  priceMinMinor: number | null;
  priceMaxMinor: number | null;
  durationDaysMin: number | null;
  durationDaysMax: number | null;
  visibility: "public" | "private";
};

type BidParams = { bidId: string };
type OrderBidParams = CustomerOrderParams & BidParams;
type ContractorParams = { contractorId: string };
type ReviewBody = { score: number; text: string };
type ContractorProfileBody = Omit<UpsertContractorProfileCommand, "accountId">;
type AttachmentUploadBody = Omit<RequestAttachmentUploadCommand, "ownerId">;
type GuestAttachmentUploadBody = RequestGuestAttachmentUploadCommand & { captchaToken?: string };
type GuestAttachmentConfirmBody = { claimToken: string };
type AttachmentParams = { attachmentId: string };
type EmailAuthenticationBody = { email: string };
type EmailAuthenticationConfirmBody = { token: string };
type RussianLocationSearchQuery = {
  query?: string;
  regionId?: string;
  limit?: number;
};

export interface SubmitGuestOrderUseCase {
  execute(command: SubmitGuestOrderCommand): Promise<SubmitGuestOrderResult>;
}

export interface ConfirmGuestOrderUseCase {
  execute(rawToken: string): Promise<ConfirmGuestOrderResult>;
}

export interface ListCustomerOrdersUseCase {
  execute(
    accountId: string,
    pagination: Readonly<{ limit: number; offset: number }>,
  ): Promise<CustomerOrderPage>;
}

export interface GetCustomerOrderUseCase {
  execute(accountId: string, orderId: string): Promise<CustomerOrderView>;
}

export interface CancelCustomerOrderUseCase {
  execute(accountId: string, orderId: string): Promise<CustomerOrderView>;
}

export interface ListPublicOrdersUseCase {
  execute(input: Readonly<{
    query?: string;
    categoryId?: string;
    regionId?: string;
    locationId?: string;
    budgetMinMinor?: number;
    budgetMaxMinor?: number;
    sort?: PublicOrderSort;
    limit: number;
    offset: number;
  }>): Promise<Page<PublicOrderListItem>>;
}

export interface ListContractorsUseCase {
  execute(input: Readonly<{
    query?: string;
    specializationId?: string;
    regionId?: string;
    locationId?: string;
    minRating?: number;
    sort?: PublicContractorSort;
    limit: number;
    offset: number;
  }>): Promise<PublicContractorPage>;
}

export interface GetPublicOrderUseCase {
  execute(orderId: string): Promise<PublicOrderView>;
}

export interface SubmitBidUseCase {
  execute(command: SubmitBidCommand): Promise<BidView>;
}

export interface WithdrawBidUseCase {
  execute(contractorId: string, bidId: string): Promise<BidView>;
}

export interface ListContractorBidsUseCase {
  execute(
    contractorId: string,
    pagination: Readonly<{ limit: number; offset: number }>,
  ): Promise<Page<BidListItem>>;
}

export interface ListOrderBidsUseCase {
  execute(
    customerId: string,
    orderId: string,
    pagination: Readonly<{ limit: number; offset: number }>,
  ): Promise<Page<BidListItem>>;
}

export interface SelectBidUseCase {
  execute(customerId: string, orderId: string, bidId: string): Promise<SelectBidResult>;
}

export interface CompleteOrderUseCase {
  execute(accountId: string, orderId: string): Promise<CompletedOrderView>;
}

export interface SubmitReviewUseCase {
  execute(command: SubmitReviewCommand): Promise<ReviewView>;
}

export interface GetContractorProfileUseCase {
  execute(contractorId: string): Promise<PublicContractorProfile>;
}

export interface ListContractorReviewsUseCase {
  execute(
    contractorId: string,
    pagination: Readonly<{ limit: number; offset: number }>,
  ): Promise<PublicReviewPage>;
}

export interface UpsertContractorProfileUseCase {
  execute(command: UpsertContractorProfileCommand): Promise<ContractorProfileSnapshot>;
}

export interface GetOwnContractorProfileUseCase {
  execute(accountId: string): Promise<ContractorProfileSnapshot>;
}

export interface RequestAttachmentUploadUseCase {
  execute(command: RequestAttachmentUploadCommand): Promise<AttachmentUploadRequest>;
}

export interface ConfirmAttachmentUploadUseCase {
  execute(ownerId: string, attachmentId: string): Promise<AttachmentSnapshot>;
}

export interface RequestGuestAttachmentUploadUseCase {
  execute(command: RequestGuestAttachmentUploadCommand): Promise<GuestAttachmentUploadRequest>;
}

export interface ConfirmGuestAttachmentUploadUseCase {
  execute(attachmentId: string, claimToken: string): Promise<AttachmentSnapshot>;
}

export interface GetPublicAttachmentUrlUseCase {
  execute(attachmentId: string, ownerId?: string): Promise<Readonly<{
    url: string;
    expiresInSeconds: number;
    contentType: string;
  }>>;
}

export interface RequestEmailAuthenticationUseCase {
  execute(command: RequestEmailAuthenticationCommand): Promise<void>;
}

export interface ConfirmEmailAuthenticationUseCase {
  execute(token: string, purpose: "registration" | "login"): Promise<ConfirmEmailAuthenticationResult>;
}

export interface LogoutUseCase {
  revokeCurrent(rawToken: string): Promise<void>;
  revokeAll(accountId: string): Promise<void>;
}

export interface GetOwnAccountUseCase {
  execute(accountId: string): Promise<Readonly<{
    id: string;
    email: string;
    status: "active" | "suspended" | "deleted";
    capabilities: readonly ("customer" | "contractor" | "admin")[];
    createdAt: Date;
  }>>;
}

export interface ListWorkCategoriesUseCase {
  execute(): Promise<readonly WorkCategoryTreeNode[]>;
}

export interface ListRussianRegionsUseCase {
  execute(): Promise<readonly RussianRegionView[]>;
}

export interface SearchRussianLocalitiesUseCase {
  execute(input: RussianLocationSearchQuery): Promise<readonly RussianLocalityView[]>;
}

export type ReadinessCheck = () => Promise<void>;

export type HttpServerDependencies = Readonly<{
  bidMessaging: Pick<BidMessaging, "list" | "send">;
  getNotificationPreferences: Pick<GetNotificationPreferencesHandler, "execute">;
  updateNotificationPreferences: Pick<UpdateNotificationPreferencesHandler, "execute">;
  requestAccountDeletion: Pick<RequestAccountDeletionHandler, "execute">;
  confirmAccountDeletion: Pick<ConfirmAccountDeletionHandler, "execute">;
  requestEmailChange: Pick<RequestEmailChangeHandler, "execute">;
  confirmEmailChange: Pick<ConfirmEmailChangeHandler, "execute">;
  listNotifications: Pick<ListNotificationsHandler, "execute">;
  readNotification: Pick<ReadNotificationHandler, "execute">;
  listWorkCategories: ListWorkCategoriesUseCase;
  listRussianRegions: ListRussianRegionsUseCase;
  searchRussianLocalities: SearchRussianLocalitiesUseCase;
  submitGuestOrder: SubmitGuestOrderUseCase | SubmitGuestOrderHandler;
  confirmGuestOrder: ConfirmGuestOrderUseCase | ConfirmGuestOrderHandler;
  sessionAuthenticator: SessionAuthenticator;
  listCustomerOrders: ListCustomerOrdersUseCase;
  getCustomerOrder: GetCustomerOrderUseCase;
  updateCustomerOrder: Pick<UpdateCustomerOrderHandler, "execute">;
  cancelCustomerOrder: CancelCustomerOrderUseCase;
  listPublicOrders: ListPublicOrdersUseCase;
  listContractors: ListContractorsUseCase;
  getPublicOrder: GetPublicOrderUseCase;
  submitBid: SubmitBidUseCase;
  withdrawBid: WithdrawBidUseCase;
  listContractorBids: ListContractorBidsUseCase;
  listOrderBids: ListOrderBidsUseCase;
  selectBid: SelectBidUseCase;
  completeOrder: CompleteOrderUseCase;
  getOrderDeal: { execute(accountId: string, orderId: string): Promise<OrderDealView> };
  submitReview: SubmitReviewUseCase;
  getContractorProfile: GetContractorProfileUseCase;
  listContractorReviews: ListContractorReviewsUseCase;
  upsertContractorProfile: UpsertContractorProfileUseCase;
  getOwnContractorProfile: GetOwnContractorProfileUseCase;
  requestAttachmentUpload: RequestAttachmentUploadUseCase;
  confirmAttachmentUpload: ConfirmAttachmentUploadUseCase;
  requestGuestAttachmentUpload: RequestGuestAttachmentUploadUseCase;
  confirmGuestAttachmentUpload: ConfirmGuestAttachmentUploadUseCase;
  guestUploadAccess: GuestUploadAccessPolicy;
  getPublicAttachmentUrl: GetPublicAttachmentUrlUseCase;
  getPublicAttachmentPreviewUrl: GetPublicAttachmentUrlUseCase;
  requestEmailAuthentication: RequestEmailAuthenticationUseCase;
  confirmEmailAuthentication: ConfirmEmailAuthenticationUseCase;
  logout: LogoutUseCase;
  getOwnAccount: GetOwnAccountUseCase;
  readinessCheck: ReadinessCheck;
  readinessTimeoutMs?: number;
  trustedProxyHops?: number;
  logger?: boolean | FastifyBaseLogger;
}>;

const nullableMoneySchema = {
  type: "integer", nullable: true, minimum: 0, maximum: Number.MAX_SAFE_INTEGER,
} as const;

const russianLocationSearchSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", maxLength: 160 },
      regionId: { type: "string", minLength: 1, maxLength: 100 },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
  },
} as const;

const submitGuestOrderSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: [
      "email",
      "contactName",
      "categoryId",
      "locationId",
      "title",
      "description",
      "budgetMinMinor",
      "budgetMaxMinor",
      "consentVersion",
    ],
    properties: {
      email: { type: "string", minLength: 3, maxLength: 254 },
      contactName: { type: "string", minLength: 1, maxLength: 120 },
      categoryId: { type: "string", minLength: 1, maxLength: 100 },
      locationId: { type: "string", minLength: 1, maxLength: 100 },
      title: { type: "string", minLength: 1, maxLength: 160 },
      description: { type: "string", minLength: 1, maxLength: 10_000 },
      budgetMinMinor: nullableMoneySchema,
      budgetMaxMinor: nullableMoneySchema,
      temporaryAttachments: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["attachmentId", "claimToken"],
          properties: {
            attachmentId: { type: "string", minLength: 1, maxLength: 100 },
            claimToken: { type: "string", minLength: 1, maxLength: 1_000 },
          },
        },
      },
      consentVersion: { type: "string", minLength: 1, maxLength: 100 },
    },
  },
} as const;

const confirmGuestOrderSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["token"],
    properties: {
      token: { type: "string", minLength: 1, maxLength: 1_000 },
    },
  },
} as const;

const emailAuthenticationSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["email"],
    properties: {
      email: { type: "string", minLength: 3, maxLength: 254 },
    },
  },
} as const;

const emailAuthenticationConfirmSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["token"],
    properties: {
      token: { type: "string", minLength: 1, maxLength: 1_000 },
    },
  },
} as const;

const customerOrderParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["orderId"],
  properties: {
    orderId: { type: "string", minLength: 1, maxLength: 100 },
  },
} as const;

const updateCustomerOrderSchema = {
  params: customerOrderParamsSchema,
  body: {
    type: "object", additionalProperties: false,
    required: ["categoryId", "locationId", "title", "description", "budgetMinMinor", "budgetMaxMinor", "attachmentIds"],
    properties: {
      categoryId: { type: "string", minLength: 1, maxLength: 100 },
      locationId: { type: "string", minLength: 1, maxLength: 100 },
      title: { type: "string", minLength: 1, maxLength: 160 },
      description: { type: "string", minLength: 1, maxLength: 10_000 },
      budgetMinMinor: nullableMoneySchema,
      budgetMaxMinor: nullableMoneySchema,
      attachmentIds: { type: "array", maxItems: 10, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 100 } },
    },
  },
} as const;

const customerOrderListSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0, maximum: 1_000_000 },
    },
  },
} as const;

const notificationPreferencesSchema = {
  body: {
    type: "object", additionalProperties: false, required: ["email"],
    properties: {
      email: {
        type: "object", additionalProperties: false,
        required: ["bidSubmitted", "bidSelected", "orderCompleted"],
        properties: {
          bidSubmitted: { type: "boolean" }, bidSelected: { type: "boolean" }, orderCompleted: { type: "boolean" },
          messageReceived: { type: "boolean" },
        },
      },
    },
  },
} as const;

const publicOrderListSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", minLength: 2, maxLength: 200 },
      categoryId: { type: "string", minLength: 1, maxLength: 100 },
      regionId: { type: "string", minLength: 1, maxLength: 100 },
      locationId: { type: "string", minLength: 1, maxLength: 100 },
      budgetMinMinor: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      budgetMaxMinor: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      sort: { type: "string", enum: ["newest", "budget_asc", "budget_desc", "popular", "relevance"] },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0, maximum: 1_000_000 },
    },
  },
} as const;

const publicContractorListSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", minLength: 2, maxLength: 200 },
      specializationId: { type: "string", minLength: 1, maxLength: 100 },
      regionId: { type: "string", minLength: 1, maxLength: 100 },
      locationId: { type: "string", minLength: 1, maxLength: 100 },
      minRating: { type: "number", minimum: 1, maximum: 5 },
      sort: { type: "string", enum: ["rating", "completed", "newest", "relevance"] },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0, maximum: 1_000_000 },
    },
  },
} as const;

const bidParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["bidId"],
  properties: { bidId: { type: "string", minLength: 1, maxLength: 100 } },
} as const;

const orderBidParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["orderId", "bidId"],
  properties: {
    orderId: { type: "string", minLength: 1, maxLength: 100 },
    bidId: { type: "string", minLength: 1, maxLength: 100 },
  },
} as const;

const submitBidSchema = {
  params: customerOrderParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    required: [
      "message",
      "priceMinMinor",
      "priceMaxMinor",
      "durationDaysMin",
      "durationDaysMax",
      "visibility",
    ],
    properties: {
      message: { type: "string", minLength: 1, maxLength: 5_000 },
      priceMinMinor: nullableMoneySchema,
      priceMaxMinor: nullableMoneySchema,
      durationDaysMin: {
        type: "integer", nullable: true, minimum: 1, maximum: 100_000,
      },
      durationDaysMax: {
        type: "integer", nullable: true, minimum: 1, maximum: 100_000,
      },
      visibility: { type: "string", enum: ["public", "private"] },
    },
  },
} as const;

const contractorParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["contractorId"],
  properties: {
    contractorId: { type: "string", minLength: 1, maxLength: 100 },
  },
} as const;

const submitReviewSchema = {
  params: customerOrderParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    required: ["score", "text"],
    properties: {
      score: { type: "integer", minimum: 1, maximum: 5 },
      text: { type: "string", minLength: 1, maxLength: 5_000 },
    },
  },
} as const;

const contractorProfileSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: [
      "displayName",
      "bio",
      "avatarAttachmentId",
      "specializationIds",
      "serviceLocationIds",
      "portfolio",
    ],
    properties: {
      displayName: { type: "string", minLength: 1, maxLength: 120 },
      bio: { type: "string", maxLength: 5_000 },
      avatarAttachmentId: {
        anyOf: [
          { type: "string", minLength: 1, maxLength: 100 },
          { type: "null" },
        ],
      },
      specializationIds: {
        type: "array",
        maxItems: 50,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 100 },
      },
      serviceLocationIds: {
        type: "array",
        maxItems: 50,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 100 },
      },
      portfolio: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "description", "attachmentIds"],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 160 },
            description: { type: "string", maxLength: 2_000 },
            attachmentIds: {
              type: "array",
              minItems: 1,
              maxItems: 10,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 100 },
            },
          },
        },
      },
    },
  },
} as const;

const attachmentParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["attachmentId"],
  properties: {
    attachmentId: { type: "string", minLength: 1, maxLength: 100 },
  },
} as const;

const attachmentUploadSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["purpose", "originalFileName", "contentType", "sizeBytes"],
    properties: {
      purpose: { type: "string", enum: ["profile_avatar", "portfolio", "order"] },
      originalFileName: { type: "string", minLength: 1, maxLength: 255 },
      contentType: {
        type: "string",
        enum: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      },
      sizeBytes: { type: "integer", minimum: 1, maximum: 20 * 1024 * 1024 },
    },
  },
} as const;

const guestAttachmentUploadSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["originalFileName", "contentType", "sizeBytes"],
    properties: {
      originalFileName: { type: "string", minLength: 1, maxLength: 255 },
      contentType: {
        type: "string",
        enum: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      },
      sizeBytes: { type: "integer", minimum: 1, maximum: 20 * 1024 * 1024 },
      captchaToken: { type: "string", minLength: 1, maxLength: 2_048 },
    },
  },
} as const;

const guestAttachmentConfirmSchema = {
  params: attachmentParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    required: ["claimToken"],
    properties: {
      claimToken: { type: "string", minLength: 1, maxLength: 1_000 },
    },
  },
} as const;

const conflictCodes = new Set([
  "CONVERSATION_READ_ONLY", "MESSAGE_IDEMPOTENCY_CONFLICT",
  "ACCOUNT_NOT_ACTIVE",
  "SUBMISSION_ALREADY_CONFIRMED",
  "SUBMISSION_NOT_PENDING",
  "ORDER_NOT_CANCELLABLE",
  "EMAIL_ALREADY_IN_USE",
  "ACCOUNT_HAS_ONGOING_ORDERS",
  "ORDER_NOT_EDITABLE",
  "ORDER_NOT_ACCEPTING_BIDS",
  "ORDER_NOT_ACCEPTING_SELECTION",
  "BID_ALREADY_EXISTS",
  "BID_NOT_SELECTABLE",
  "BID_NOT_WITHDRAWABLE",
  "ORDER_NOT_COMPLETABLE",
  "ORDER_NOT_COMPLETED",
  "REVIEW_ALREADY_EXISTS",
  "ATTACHMENT_OBJECT_NOT_FOUND",
  "ATTACHMENT_MISMATCH",
  "GUEST_ATTACHMENT_ALREADY_CLAIMED",
]);

function domainStatus(error: DomainError): number {
  if (error.code === "AUTHENTICATION_REQUIRED") return 401;
  if (error.code === "ORDER_FORBIDDEN" || error.code === "HUMAN_VERIFICATION_FAILED") return 403;
  if (error.code === "RATE_LIMIT_EXCEEDED") return 429;
  if (
    error.code === "INVALID_CONFIRMATION_TOKEN"
    || error.code === "INVALID_AUTHENTICATION_TOKEN"
    || error.code === "INVALID_EMAIL_CHANGE_TOKEN"
    || error.code === "INVALID_DELETION_TOKEN"
    || error.code === "ORDER_NOT_FOUND"
    || error.code === "BID_NOT_FOUND"
    || error.code === "CONTRACTOR_NOT_FOUND"
    || error.code === "CONTRACTOR_PROFILE_NOT_FOUND"
    || error.code === "ATTACHMENT_NOT_FOUND"
    || error.code === "NOTIFICATION_NOT_FOUND"
  ) return 404;
  if (error.code === "SUBMISSION_EXPIRED") return 410;
  if (error.code === "AUTHENTICATION_TOKEN_EXPIRED") return 410;
  if (error.code === "EMAIL_CHANGE_EXPIRED") return 410;
  if (error.code === "DELETION_TOKEN_EXPIRED") return 410;
  if (error.code === "ATTACHMENT_UPLOAD_EXPIRED") return 410;
  if (conflictCodes.has(error.code)) return 409;
  return 422;
}

async function authenticateRequest(
  authorization: string | undefined,
  authenticator: SessionAuthenticator,
): Promise<AuthenticatedAccount> {
  const token = bearerToken(authorization);
  const account = await authenticator.authenticate(token);
  if (!account) {
    throw new DomainError("AUTHENTICATION_REQUIRED", "A valid Bearer session is required");
  }
  return account;
}

function bearerToken(authorization: string | undefined): string {
  const match = authorization?.match(/^Bearer\s+(\S+)$/iu);
  if (!match?.[1]) throw new DomainError("AUTHENTICATION_REQUIRED", "A valid Bearer session is required");
  return match[1];
}

function presentCustomerOrder(order: CustomerOrderView) {
  return {
    ...order,
    createdAt: order.createdAt.toISOString(),
    publishedAt: order.publishedAt?.toISOString() ?? null,
    completedAt: order.completedAt?.toISOString() ?? null,
  };
}

function presentBid(bid: BidView) {
  return {
    ...bid,
    submittedAt: bid.submittedAt.toISOString(),
    decidedAt: bid.decidedAt?.toISOString() ?? null,
  };
}

function presentBidListItem(bid: BidListItem) {
  return {
    id: bid.id,
    orderId: bid.orderId,
    orderTitle: bid.orderTitle,
    contractorId: bid.contractorId,
    message: bid.message,
    price: {
      minMinor: bid.priceMinMinor,
      maxMinor: bid.priceMaxMinor,
      currency: bid.priceCurrency,
    },
    durationDaysMin: bid.durationDaysMin,
    durationDaysMax: bid.durationDaysMax,
    visibility: bid.visibility,
    status: bid.status,
    submittedAt: bid.submittedAt.toISOString(),
    decidedAt: bid.decidedAt?.toISOString() ?? null,
  };
}

function presentReview(review: ReviewView) {
  return { ...review, createdAt: review.createdAt.toISOString() };
}

function presentContractorProfile(profile: ContractorProfileSnapshot) {
  return {
    ...profile,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

function presentAttachment(attachment: AttachmentSnapshot) {
  return {
    id: attachment.id,
    ownerId: attachment.ownerId,
    purpose: attachment.purpose,
    originalFileName: attachment.originalFileName,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    status: attachment.status,
    createdAt: attachment.createdAt.toISOString(),
    expiresAt: attachment.expiresAt.toISOString(),
    uploadedAt: attachment.uploadedAt?.toISOString() ?? null,
    processedAt: attachment.processedAt?.toISOString() ?? null,
    previewAvailable: attachment.previewStorageKey !== null,
    rejectionReason: attachment.rejectionReason,
  };
}

function validationDetails(error: FastifyError): Readonly<Record<string, unknown>> {
  if (!error.validation) return {};
  return {
    violations: error.validation.map((item) => ({
      path: item.instancePath || item.params.missingProperty || "body",
      message: item.message ?? "is invalid",
    })),
  };
}

function isValidationError(error: unknown): error is FastifyError {
  return error instanceof Error
    && "validation" in error
    && Array.isArray((error as FastifyError).validation);
}

export function createHttpServer(dependencies: HttpServerDependencies): FastifyInstance {
  const trustedProxyHops = dependencies.trustedProxyHops ?? 0;
  const server = Fastify({
    ajv: { customOptions: { removeAdditional: false } },
    ...(typeof dependencies.logger === "object"
      ? { loggerInstance: dependencies.logger }
      : { logger: dependencies.logger ? { serializers: httpLogSerializers } : false }),
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
    genReqId: newRequestId,
    bodyLimit: 64 * 1024,
    requestTimeout: 15_000,
    trustProxy: trustedProxyHops > 0
      ? (_address: string, hop: number) => hop < trustedProxyHops
      : false,
  });

  registerRequestObservability(server);
  registerApiDocumentation(server);
  server.register(async (applicationRoutes) => registerHttpRoutes(applicationRoutes, dependencies));
  return server;
}

function registerHttpRoutes(server: FastifyInstance, dependencies: HttpServerDependencies): void {
  const messageParams = { type: "object", additionalProperties: false, required: ["bidId"],
    properties: { bidId: { type: "string", format: "uuid" } } } as const;
  server.get<{ Params: BidParams; Querystring: CustomerOrderListQuery }>("/api/v1/bids/:bidId/messages", {
    schema: { params: messageParams, querystring: customerOrderListSchema.querystring },
  }, async (request) => {
    const account = await authenticateRequest(request.headers.authorization, dependencies.sessionAuthenticator);
    const page = await dependencies.bidMessaging.list(account.accountId, request.params.bidId,
      { limit: request.query.limit ?? 20, offset: request.query.offset ?? 0 });
    return { ...page, items: page.items.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })) };
  });
  server.post<{ Params: BidParams; Body: { text: string; clientMessageId: string } }>("/api/v1/bids/:bidId/messages", {
    schema: { params: messageParams, body: { type: "object", additionalProperties: false, required: ["text", "clientMessageId"],
      properties: { text: { type: "string", minLength: 1, maxLength: 5000 }, clientMessageId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    const account = await authenticateRequest(request.headers.authorization, dependencies.sessionAuthenticator);
    const message = await dependencies.bidMessaging.send({ ...request.body, bidId: request.params.bidId, accountId: account.accountId });
    return reply.code(201).send({ ...message, createdAt: message.createdAt.toISOString() });
  });

  server.get("/health/live", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return { status: "ok" };
  });

  server.get("/api/v1/notification-preferences", async (request) => {
    const account = await authenticateRequest(request.headers.authorization, dependencies.sessionAuthenticator);
    return dependencies.getNotificationPreferences.execute(account.accountId);
  });
  server.put<{ Body: NotificationPreferencesInput }>(
    "/api/v1/notification-preferences", { schema: notificationPreferencesSchema },
    async (request) => {
      const account = await authenticateRequest(request.headers.authorization, dependencies.sessionAuthenticator);
      return dependencies.updateNotificationPreferences.execute(account.accountId, request.body);
    },
  );

  server.get<{ Querystring: CustomerOrderListQuery }>(
    "/api/v1/notifications", { schema: customerOrderListSchema },
    async (request) => {
      const account = await authenticateRequest(request.headers.authorization, dependencies.sessionAuthenticator);
      const page = await dependencies.listNotifications.execute(account.accountId, {
        limit: request.query.limit ?? 20, offset: request.query.offset ?? 0,
      });
      return {
        ...page,
        items: page.items.map((item) => ({
          id: item.id, kind: item.kind, orderId: item.orderId, bidId: item.bidId ?? null, title: item.title, text: item.text,
          createdAt: item.createdAt.toISOString(), readAt: item.readAt?.toISOString() ?? null,
        })),
      };
    },
  );

  server.post<{ Params: { notificationId: string } }>(
    "/api/v1/notifications/:notificationId/read",
    { schema: { params: {
      type: "object", additionalProperties: false, required: ["notificationId"],
      properties: { notificationId: { type: "string", format: "uuid" } },
    } } },
    async (request, reply) => {
      const account = await authenticateRequest(request.headers.authorization, dependencies.sessionAuthenticator);
      await dependencies.readNotification.execute(account.accountId, request.params.notificationId);
      return reply.code(204).send();
    },
  );

  server.get("/api/v1/work-categories", async () => ({
    items: await dependencies.listWorkCategories.execute(),
  }));

  server.get("/api/v1/regions", async () => ({
    countryCode: "RU",
    items: await dependencies.listRussianRegions.execute(),
  }));

  server.get<{ Querystring: RussianLocationSearchQuery }>(
    "/api/v1/locations",
    { schema: russianLocationSearchSchema },
    async (request) => ({
      countryCode: "RU",
      items: await dependencies.searchRussianLocalities.execute(request.query),
    }),
  );

  server.get("/health/ready", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    try {
      await checkWithTimeout(dependencies.readinessCheck, dependencies.readinessTimeoutMs ?? 2_000);
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });

  const requestEmailAuthentication = async (
    body: EmailAuthenticationBody,
    clientAddress: string,
    purpose: "registration" | "login",
  ): Promise<Readonly<{ status: "pending_email" }>> => {
    await dependencies.requestEmailAuthentication.execute({
      email: body.email,
      purpose,
      clientAddress,
    });
    return { status: "pending_email" };
  };

  const confirmEmailAuthentication = async (
    token: string,
    purpose: "registration" | "login",
  ) => {
    const result = await dependencies.confirmEmailAuthentication.execute(token, purpose);
    return {
      account: {
        id: result.accountId,
        email: result.email,
        capabilities: result.capabilities,
      },
      createdAccount: result.createdAccount,
      session: { type: "Bearer", token: result.sessionToken },
    };
  };

  server.post<{ Body: EmailAuthenticationBody }>(
    "/api/v1/auth/registrations",
    { schema: emailAuthenticationSchema },
    async (request, reply) => reply.code(202).send(
      await requestEmailAuthentication(request.body, request.ip, "registration"),
    ),
  );

  server.post<{ Body: EmailAuthenticationConfirmBody }>(
    "/api/v1/auth/registrations/confirm",
    { schema: emailAuthenticationConfirmSchema },
    async (request) => confirmEmailAuthentication(request.body.token, "registration"),
  );

  server.post<{ Body: EmailAuthenticationBody }>(
    "/api/v1/auth/login-requests",
    { schema: emailAuthenticationSchema },
    async (request, reply) => reply.code(202).send(
      await requestEmailAuthentication(request.body, request.ip, "login"),
    ),
  );

  server.post<{ Body: EmailAuthenticationConfirmBody }>(
    "/api/v1/auth/login-requests/confirm",
    { schema: emailAuthenticationConfirmSchema },
    async (request) => confirmEmailAuthentication(request.body.token, "login"),
  );

  server.get("/api/v1/auth/me", async (request) => {
    const authenticated = await authenticateRequest(request.headers.authorization, dependencies.sessionAuthenticator);
    const account = await dependencies.getOwnAccount.execute(authenticated.accountId);
    return { ...account, createdAt: account.createdAt.toISOString() };
  });

  server.post("/api/v1/auth/account-deletion-requests", async (request, reply) => {
    const account = await authenticateRequest(request.headers.authorization, dependencies.sessionAuthenticator);
    await dependencies.requestAccountDeletion.execute({ accountId: account.accountId, clientAddress: request.ip });
    return reply.code(202).send({ status: "pending_email" });
  });
  server.post<{ Body: EmailAuthenticationConfirmBody }>(
    "/api/v1/auth/account-deletion-requests/confirm", { schema: emailAuthenticationConfirmSchema },
    async (request, reply) => {
      await dependencies.confirmAccountDeletion.execute(request.body.token);
      return reply.code(204).send();
    },
  );

  server.post<{ Body: EmailAuthenticationBody }>(
    "/api/v1/auth/email-change-requests", { schema: emailAuthenticationSchema },
    async (request, reply) => {
      const account = await authenticateRequest(request.headers.authorization, dependencies.sessionAuthenticator);
      await dependencies.requestEmailChange.execute({
        accountId: account.accountId, email: request.body.email, clientAddress: request.ip,
      });
      return reply.code(202).send({ status: "pending_email" });
    },
  );
  server.post<{ Body: EmailAuthenticationConfirmBody }>(
    "/api/v1/auth/email-change-requests/confirm", { schema: emailAuthenticationConfirmSchema },
    async (request, reply) => {
      await dependencies.confirmEmailChange.execute(request.body.token);
      return reply.code(204).send();
    },
  );

  server.delete("/api/v1/auth/session", async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    await authenticateRequest(request.headers.authorization, dependencies.sessionAuthenticator);
    await dependencies.logout.revokeCurrent(token);
    return reply.code(204).send();
  });

  server.delete("/api/v1/auth/sessions", async (request, reply) => {
    const authenticated = await authenticateRequest(request.headers.authorization, dependencies.sessionAuthenticator);
    await dependencies.logout.revokeAll(authenticated.accountId);
    return reply.code(204).send();
  });

  server.post<{ Body: GuestOrderBody }>(
    "/api/v1/guest-orders",
    { schema: submitGuestOrderSchema },
    async (request, reply) => {
      const result = await dependencies.submitGuestOrder.execute(request.body);
      return reply.code(202).send({
        submissionId: result.submissionId,
        status: "pending_email",
        expiresAt: result.expiresAt.toISOString(),
      });
    },
  );

  server.post<{ Body: ConfirmGuestOrderBody }>(
    "/api/v1/guest-orders/confirm",
    { schema: confirmGuestOrderSchema },
    async (request) => {
      const result = await dependencies.confirmGuestOrder.execute(request.body.token);
      return {
        accountId: result.accountId,
        orderId: result.orderId,
        reusedAccount: result.reusedAccount,
        alreadyConfirmed: result.alreadyConfirmed,
        session: {
          type: "Bearer",
          token: result.sessionToken,
        },
      };
    },
  );

  server.post<{ Body: GuestAttachmentUploadBody }>(
    "/api/v1/guest-attachments/upload-requests",
    { schema: guestAttachmentUploadSchema },
    async (request, reply) => {
      await dependencies.guestUploadAccess.assertAllowed({
        clientAddress: request.ip,
        humanVerificationToken: request.body.captchaToken ?? null,
      });
      const { captchaToken: _captchaToken, ...upload } = request.body;
      const result = await dependencies.requestGuestAttachmentUpload.execute(upload);
      return reply.code(201).send({
        attachment: presentAttachment(result.attachment),
        claimToken: result.claimToken,
        uploadUrl: result.uploadUrl,
        uploadHeaders: result.uploadHeaders,
      });
    },
  );

  server.post<{ Params: AttachmentParams; Body: GuestAttachmentConfirmBody }>(
    "/api/v1/guest-attachments/:attachmentId/confirm",
    { schema: guestAttachmentConfirmSchema },
    async (request) => presentAttachment(
      await dependencies.confirmGuestAttachmentUpload.execute(
        request.params.attachmentId,
        request.body.claimToken,
      ),
    ),
  );

  server.get<{ Querystring: PublicOrderListQuery }>(
    "/api/v1/orders",
    { schema: publicOrderListSchema },
    async (request) => {
      const page = await dependencies.listPublicOrders.execute({
        limit: request.query.limit ?? 20,
        offset: request.query.offset ?? 0,
        ...(request.query.query ? { query: request.query.query } : {}),
        ...(request.query.categoryId ? { categoryId: request.query.categoryId } : {}),
        ...(request.query.regionId ? { regionId: request.query.regionId } : {}),
        ...(request.query.locationId ? { locationId: request.query.locationId } : {}),
        ...(request.query.budgetMinMinor !== undefined ? { budgetMinMinor: request.query.budgetMinMinor } : {}),
        ...(request.query.budgetMaxMinor !== undefined ? { budgetMaxMinor: request.query.budgetMaxMinor } : {}),
        ...(request.query.sort ? { sort: request.query.sort } : {}),
      });
      return {
        ...page,
        items: page.items.map((order) => ({
          id: order.id,
          categoryId: order.categoryId,
          categoryName: order.categoryName,
          locationId: order.locationId,
          locationName: order.locationName,
          regionId: order.regionId,
          regionName: order.regionName,
          title: order.title,
          descriptionPreview: order.descriptionPreview,
          budget: {
            minMinor: order.budgetMinMinor,
            maxMinor: order.budgetMaxMinor,
            currency: order.budgetCurrency,
          },
          publishedAt: order.publishedAt.toISOString(),
          bidCount: order.bidCount,
        })),
      };
    },
  );

  server.get<{ Params: CustomerOrderParams }>(
    "/api/v1/orders/:orderId",
    { schema: { params: customerOrderParamsSchema } },
    async (request) => {
      const order = await dependencies.getPublicOrder.execute(request.params.orderId);
      return {
        id: order.id,
        categoryId: order.categoryId,
        categoryName: order.categoryName,
        locationId: order.locationId,
        locationName: order.locationName,
        regionId: order.regionId,
        regionName: order.regionName,
        title: order.title,
        description: order.description,
        budget: {
          minMinor: order.budgetMinMinor,
          maxMinor: order.budgetMaxMinor,
          currency: order.budgetCurrency,
        },
        attachmentIds: order.attachmentIds,
        publishedAt: order.publishedAt.toISOString(),
        bidCount: order.bidCount,
      };
    },
  );

  server.post<{ Params: CustomerOrderParams; Body: BidBody }>(
    "/api/v1/orders/:orderId/bids",
    { schema: submitBidSchema },
    async (request, reply) => {
      const account = await authenticateRequest(
        request.headers.authorization,
        dependencies.sessionAuthenticator,
      );
      const bid = await dependencies.submitBid.execute({
        orderId: request.params.orderId,
        contractorId: account.accountId,
        ...request.body,
      });
      return reply.code(201).send(presentBid(bid));
    },
  );

  server.post<{ Body: AttachmentUploadBody }>(
    "/api/v1/attachments/upload-requests",
    { schema: attachmentUploadSchema },
    async (request, reply) => {
      const account = await authenticateRequest(
        request.headers.authorization,
        dependencies.sessionAuthenticator,
      );
      const result = await dependencies.requestAttachmentUpload.execute({
        ownerId: account.accountId,
        ...request.body,
      });
      return reply.code(201).send({
        attachment: presentAttachment(result.attachment),
        uploadUrl: result.uploadUrl,
        uploadHeaders: result.uploadHeaders,
      });
    },
  );

  server.post<{ Params: AttachmentParams }>(
    "/api/v1/attachments/:attachmentId/confirm",
    { schema: { params: attachmentParamsSchema } },
    async (request) => {
      const account = await authenticateRequest(
        request.headers.authorization,
        dependencies.sessionAuthenticator,
      );
      const attachment = await dependencies.confirmAttachmentUpload.execute(
        account.accountId,
        request.params.attachmentId,
      );
      return presentAttachment(attachment);
    },
  );

  server.get<{ Params: AttachmentParams }>(
    "/api/v1/attachments/:attachmentId/download-url",
    { schema: { params: attachmentParamsSchema } },
    async (request) => dependencies.getPublicAttachmentUrl.execute(request.params.attachmentId),
  );

  for (const action of ["preview", "download"] as const) {
    server.get<{ Params: AttachmentParams }>(
      `/api/v1/attachments/:attachmentId/owner-${action}-url`,
      { schema: { params: attachmentParamsSchema } },
      async request => {
        const account = await authenticateRequest(request.headers.authorization, dependencies.sessionAuthenticator);
        const handler = action === "preview" ? dependencies.getPublicAttachmentPreviewUrl : dependencies.getPublicAttachmentUrl;
        return handler.execute(request.params.attachmentId, account.accountId);
      },
    );
  }

  server.get<{ Params: AttachmentParams }>(
    "/api/v1/attachments/:attachmentId/preview-url",
    { schema: { params: attachmentParamsSchema } },
    async (request) => dependencies.getPublicAttachmentPreviewUrl.execute(request.params.attachmentId),
  );

  server.get<{ Params: CustomerOrderParams }>("/api/v1/orders/:orderId/deal", {
    schema: { params: customerOrderParamsSchema },
  }, async request => {
    const account = await authenticateRequest(request.headers.authorization, dependencies.sessionAuthenticator);
    const result = await dependencies.getOrderDeal.execute(account.accountId, request.params.orderId);
    return { ...result, completedAt: result.completedAt?.toISOString() ?? null,
      ownReview: result.ownReview ? presentReview(result.ownReview) : null };
  });

  server.post<{ Params: CustomerOrderParams }>(
    "/api/v1/orders/:orderId/complete",
    { schema: { params: customerOrderParamsSchema } },
    async (request) => {
      const account = await authenticateRequest(
        request.headers.authorization,
        dependencies.sessionAuthenticator,
      );
      const result = await dependencies.completeOrder.execute(
        account.accountId,
        request.params.orderId,
      );
      return { ...result, completedAt: result.completedAt.toISOString() };
    },
  );

  server.post<{ Params: CustomerOrderParams; Body: ReviewBody }>(
    "/api/v1/orders/:orderId/reviews",
    { schema: submitReviewSchema },
    async (request, reply) => {
      const account = await authenticateRequest(
        request.headers.authorization,
        dependencies.sessionAuthenticator,
      );
      const review = await dependencies.submitReview.execute({
        orderId: request.params.orderId,
        authorId: account.accountId,
        ...request.body,
      });
      return reply.code(201).send(presentReview(review));
    },
  );

  server.get<{ Querystring: PublicContractorListQuery }>(
    "/api/v1/contractors",
    { schema: publicContractorListSchema },
    async (request) => {
      const page = await dependencies.listContractors.execute({
        limit: request.query.limit ?? 20,
        offset: request.query.offset ?? 0,
        ...(request.query.query ? { query: request.query.query } : {}),
        ...(request.query.specializationId ? { specializationId: request.query.specializationId } : {}),
        ...(request.query.regionId ? { regionId: request.query.regionId } : {}),
        ...(request.query.locationId ? { locationId: request.query.locationId } : {}),
        ...(request.query.minRating !== undefined ? { minRating: request.query.minRating } : {}),
        ...(request.query.sort ? { sort: request.query.sort } : {}),
      });
      return {
        ...page,
        items: page.items.map((contractor) => ({
          ...contractor,
          memberSince: contractor.memberSince.toISOString(),
        })),
      };
    },
  );

  server.get<{ Params: ContractorParams }>(
    "/api/v1/contractors/:contractorId",
    { schema: { params: contractorParamsSchema } },
    async (request) => {
      const profile = await dependencies.getContractorProfile.execute(request.params.contractorId);
      return { ...profile, memberSince: profile.memberSince.toISOString() };
    },
  );

  server.get<{ Params: ContractorParams; Querystring: CustomerOrderListQuery }>(
    "/api/v1/contractors/:contractorId/reviews",
    {
      schema: {
        params: contractorParamsSchema,
        querystring: customerOrderListSchema.querystring,
      },
    },
    async (request) => {
      const page = await dependencies.listContractorReviews.execute(
        request.params.contractorId,
        { limit: request.query.limit ?? 20, offset: request.query.offset ?? 0 },
      );
      return {
        ...page,
        items: page.items.map((review) => ({
          ...review,
          createdAt: review.createdAt.toISOString(),
        })),
      };
    },
  );

  server.get<{ Querystring: CustomerOrderListQuery }>(
    "/api/v1/customer/orders",
    { schema: customerOrderListSchema },
    async (request) => {
      const account = await authenticateRequest(
        request.headers.authorization,
        dependencies.sessionAuthenticator,
      );
      const page = await dependencies.listCustomerOrders.execute(account.accountId, {
        limit: request.query.limit ?? 20,
        offset: request.query.offset ?? 0,
      });
      return {
        ...page,
        items: page.items.map((order) => ({
          id: order.id,
          categoryId: order.categoryId,
          locationId: order.locationId,
          title: order.title,
          budget: {
            minMinor: order.budgetMinMinor,
            maxMinor: order.budgetMaxMinor,
            currency: order.budgetCurrency,
          },
          status: order.status,
          createdAt: order.createdAt.toISOString(),
          publishedAt: order.publishedAt?.toISOString() ?? null,
        })),
      };
    },
  );

  server.get<{ Params: CustomerOrderParams }>(
    "/api/v1/customer/orders/:orderId",
    { schema: { params: customerOrderParamsSchema } },
    async (request) => {
      const account = await authenticateRequest(
        request.headers.authorization,
        dependencies.sessionAuthenticator,
      );
      const order = await dependencies.getCustomerOrder.execute(
        account.accountId,
        request.params.orderId,
      );
      return presentCustomerOrder(order);
    },
  );

  server.put<{ Params: CustomerOrderParams; Body: Omit<UpdateCustomerOrderCommand, "accountId" | "orderId"> }>(
    "/api/v1/customer/orders/:orderId",
    { schema: updateCustomerOrderSchema },
    async (request) => {
      const account = await authenticateRequest(request.headers.authorization, dependencies.sessionAuthenticator);
      const order = await dependencies.updateCustomerOrder.execute({
        ...request.body, accountId: account.accountId, orderId: request.params.orderId,
      });
      return presentCustomerOrder(order);
    },
  );

  server.post<{ Params: CustomerOrderParams }>(
    "/api/v1/customer/orders/:orderId/cancel",
    { schema: { params: customerOrderParamsSchema } },
    async (request) => {
      const account = await authenticateRequest(
        request.headers.authorization,
        dependencies.sessionAuthenticator,
      );
      const order = await dependencies.cancelCustomerOrder.execute(
        account.accountId,
        request.params.orderId,
      );
      return presentCustomerOrder(order);
    },
  );

  server.get<{ Params: CustomerOrderParams; Querystring: CustomerOrderListQuery }>(
    "/api/v1/customer/orders/:orderId/bids",
    {
      schema: {
        params: customerOrderParamsSchema,
        querystring: customerOrderListSchema.querystring,
      },
    },
    async (request) => {
      const account = await authenticateRequest(
        request.headers.authorization,
        dependencies.sessionAuthenticator,
      );
      const page = await dependencies.listOrderBids.execute(
        account.accountId,
        request.params.orderId,
        { limit: request.query.limit ?? 20, offset: request.query.offset ?? 0 },
      );
      return { ...page, items: page.items.map(presentBidListItem) };
    },
  );

  server.post<{ Params: OrderBidParams }>(
    "/api/v1/customer/orders/:orderId/bids/:bidId/select",
    { schema: { params: orderBidParamsSchema } },
    async (request) => {
      const account = await authenticateRequest(
        request.headers.authorization,
        dependencies.sessionAuthenticator,
      );
      return dependencies.selectBid.execute(
        account.accountId,
        request.params.orderId,
        request.params.bidId,
      );
    },
  );

  server.get<{ Querystring: CustomerOrderListQuery }>(
    "/api/v1/contractor/bids",
    { schema: customerOrderListSchema },
    async (request) => {
      const account = await authenticateRequest(
        request.headers.authorization,
        dependencies.sessionAuthenticator,
      );
      const page = await dependencies.listContractorBids.execute(account.accountId, {
        limit: request.query.limit ?? 20,
        offset: request.query.offset ?? 0,
      });
      return { ...page, items: page.items.map(presentBidListItem) };
    },
  );

  server.get(
    "/api/v1/contractor/profile",
    async (request) => {
      const account = await authenticateRequest(
        request.headers.authorization,
        dependencies.sessionAuthenticator,
      );
      const profile = await dependencies.getOwnContractorProfile.execute(account.accountId);
      return presentContractorProfile(profile);
    },
  );

  server.put<{ Body: ContractorProfileBody }>(
    "/api/v1/contractor/profile",
    { schema: contractorProfileSchema },
    async (request) => {
      const account = await authenticateRequest(
        request.headers.authorization,
        dependencies.sessionAuthenticator,
      );
      const profile = await dependencies.upsertContractorProfile.execute({
        accountId: account.accountId,
        ...request.body,
      });
      return presentContractorProfile(profile);
    },
  );

  server.post<{ Params: BidParams }>(
    "/api/v1/contractor/bids/:bidId/withdraw",
    { schema: { params: bidParamsSchema } },
    async (request) => {
      const account = await authenticateRequest(
        request.headers.authorization,
        dependencies.sessionAuthenticator,
      );
      const bid = await dependencies.withdrawBid.execute(account.accountId, request.params.bidId);
      return presentBid(bid);
    },
  );

  server.setNotFoundHandler(async (request, reply) =>
    reply.code(404).send({
      error: {
        code: "ROUTE_NOT_FOUND",
        message: "Route not found",
        requestId: request.id,
      },
    }),
  );

  server.setErrorHandler(async (error, request, reply) => {
    if (isValidationError(error)) {
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "Request is invalid",
          requestId: request.id,
          details: validationDetails(error),
        },
      });
    }

    if (error instanceof DomainError) {
      if (error.code === "AUTHENTICATION_REQUIRED") {
        reply.header("www-authenticate", "Bearer");
      }
      if (error.code === "RATE_LIMIT_EXCEEDED") {
        const retryAfter = error.details.retryAfterSeconds;
        if (typeof retryAfter === "number") reply.header("retry-after", String(retryAfter));
      }
      return reply.code(domainStatus(error)).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
          details: error.details,
        },
      });
    }

    request.log.error({ failure: safeError(error) }, "Unhandled request error");
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        requestId: request.id,
      },
    });
  });

}
