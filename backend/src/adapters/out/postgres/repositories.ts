import { randomUUID } from "node:crypto";
import type { AttachmentRepository } from "../../../modules/attachments/application/ports/attachment-ports.ts";
import {
  Attachment,
  type AttachmentPurpose,
  type AttachmentStatus,
} from "../../../modules/attachments/domain/attachment.ts";
import type { ContractorProfileRepository } from "../../../modules/contractors/application/ports/contractor-profile-ports.ts";
import {
  ContractorProfile as ContractorProfileAggregate,
  type PortfolioItem,
} from "../../../modules/contractors/domain/contractor-profile.ts";
import { Account, type AccountCapability, type AccountStatus } from "../../../modules/identity/domain/account.ts";
import type { EmailAuthRequestRepository } from "../../../modules/identity/application/ports/authentication-ports.ts";
import {
  EmailAuthRequest,
  type EmailAuthPurpose,
  type EmailAuthRequestStatus,
} from "../../../modules/identity/domain/email-auth-request.ts";
import type {
  BidListItem,
  BidRepository,
  MarketplaceReadRepository,
  Page,
  PublicOrderListItem,
  PublicOrderSearch,
  PublicOrderView,
} from "../../../modules/marketplace/application/ports/bid-ports.ts";
import type {
  CustomerOrderListItem,
  CustomerOrderPage,
  CustomerOrderReadRepository,
} from "../../../modules/marketplace/application/ports/customer-order-ports.ts";
import type {
  AccountRepository,
  OrderRepository,
  OrderSubmissionRepository,
} from "../../../modules/marketplace/application/ports/guest-order-ports.ts";
import {
  OrderSubmission,
  type OrderSubmissionStatus,
} from "../../../modules/marketplace/domain/order-submission.ts";
import { Bid, type BidStatus, type BidVisibility } from "../../../modules/marketplace/domain/bid.ts";
import { Order, type OrderStatus } from "../../../modules/marketplace/domain/order.ts";
import type {
  PublicContractorProfile,
  PublicContractorListItem,
  PublicContractorPage,
  PublicContractorSearch,
  PublicServiceLocation,
  PublicSpecialization,
  PublicReviewListItem,
  PublicReviewPage,
  ReputationReadRepository,
  ReviewRepository,
} from "../../../modules/reputation/application/ports/reputation-ports.ts";
import { Review, type ReviewStatus } from "../../../modules/reputation/domain/review.ts";
import type { WorkCategoryRepository } from "../../../modules/catalog/application/ports/work-category-ports.ts";
import { WorkCategory } from "../../../modules/catalog/domain/work-category.ts";
import type {
  LocalitySearch,
  LocalitySearchItem,
  RussianLocationRepository,
} from "../../../modules/geography/application/ports/russian-location-ports.ts";
import {
  RussianLocation,
  type RussianLocationKind,
} from "../../../modules/geography/domain/russian-location.ts";
import type { AggregateRoot } from "../../../shared/domain/domain-event.ts";
import type { Email } from "../../../shared/domain/value-objects.ts";
import type { PgDatabase } from "./database.ts";

type AccountRow = {
  id: string;
  email: string;
  status: AccountStatus;
  created_at: Date;
  capabilities: AccountCapability[];
};

type WorkCategoryRow = {
  id: string;
  parent_id: string | null;
  name: string;
  description: string;
  sort_order: number;
  active: boolean;
  selectable: boolean;
};

type RussianLocationRow = {
  id: string;
  kind: RussianLocationKind;
  parent_id: string | null;
  name: string;
  slug: string;
  active: boolean;
  latitude: string | null;
  longitude: string | null;
};

type RussianLocalityRow = RussianLocationRow & { region_name: string };

type EmailAuthRequestRow = {
  id: string;
  email: string;
  purpose: EmailAuthPurpose;
  token_hash: string;
  status: EmailAuthRequestStatus;
  created_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
  account_id: string | null;
};

type SubmissionRow = {
  id: string;
  email: string;
  contact_name: string;
  category_id: string;
  location_id: string;
  title: string;
  description: string;
  budget_min_minor: string | null;
  budget_max_minor: string | null;
  budget_currency: string;
  temporary_attachment_ids: string[];
  consent_version: string;
  token_hash: string;
  status: OrderSubmissionStatus;
  created_at: Date;
  expires_at: Date;
  confirmed_at: Date | null;
  account_id: string | null;
  order_id: string | null;
};

type OrderRow = {
  id: string;
  customer_id: string;
  category_id: string;
  location_id: string;
  title: string;
  description: string;
  budget_min_minor: string | null;
  budget_max_minor: string | null;
  budget_currency: string;
  attachment_ids: string[];
  status: OrderStatus;
  selected_bid_id: string | null;
  contractor_id: string | null;
  created_at: Date;
  published_at: Date | null;
  completed_at: Date | null;
};

type CustomerOrderListRow = {
  id: string;
  category_id: string;
  location_id: string;
  title: string;
  budget_min_minor: string | null;
  budget_max_minor: string | null;
  budget_currency: string;
  status: OrderStatus;
  created_at: Date;
  published_at: Date | null;
};

type BidRow = {
  id: string;
  order_id: string;
  contractor_id: string;
  message: string;
  price_min_minor: string | null;
  price_max_minor: string | null;
  price_currency: string;
  duration_days_min: number | null;
  duration_days_max: number | null;
  visibility: BidVisibility;
  status: BidStatus;
  submitted_at: Date;
  decided_at: Date | null;
};

type BidListRow = BidRow & { order_title: string };

type PublicOrderListRow = {
  id: string;
  category_id: string;
  category_name: string;
  location_id: string;
  location_name: string;
  region_id: string;
  region_name: string;
  title: string;
  description_preview: string;
  budget_min_minor: string | null;
  budget_max_minor: string | null;
  budget_currency: string;
  published_at: Date;
  bid_count: string;
};

type PublicOrderRow = Omit<PublicOrderListRow, "description_preview"> & {
  description: string;
  attachment_ids: string[];
};

type PublicContractorListRow = {
  id: string;
  display_name: string;
  bio_preview: string;
  avatar_attachment_id: string | null;
  specialization_ids: string[];
  specializations: PublicSpecialization[];
  service_location_ids: string[];
  service_locations: PublicServiceLocation[];
  member_since: Date;
  rating_average: string | null;
  review_count: string;
  completed_order_count: string;
};

type ReviewRow = {
  id: string;
  order_id: string;
  author_id: string;
  subject_id: string;
  score: number;
  text: string;
  status: ReviewStatus;
  created_at: Date;
};

type ContractorProfileRow = {
  id: string;
  created_at: Date;
  display_name: string | null;
  bio: string | null;
  avatar_attachment_id: string | null;
  specialization_ids: string[] | null;
  specializations: PublicSpecialization[] | null;
  service_location_ids: string[] | null;
  service_locations: PublicServiceLocation[] | null;
  portfolio: PortfolioItem[] | null;
  rating_average: string | null;
  review_count: string;
  completed_order_count: string;
};

type PublicReviewRow = Omit<ReviewRow, "order_id"> & { order_id: string | null; order_title: string | null };

type StoredContractorProfileRow = {
  account_id: string;
  display_name: string;
  bio: string;
  avatar_attachment_id: string | null;
  portfolio: PortfolioItem[];
  created_at: Date;
  updated_at: Date;
};

type StoredContractorProfileWithSelectionsRow = StoredContractorProfileRow & {
  specialization_ids: string[];
  service_location_ids: string[];
};

type AttachmentRow = {
  id: string;
  owner_id: string | null;
  purpose: AttachmentPurpose;
  original_file_name: string;
  content_type: string;
  size_bytes: string;
  storage_key: string;
  status: AttachmentStatus;
  created_at: Date;
  expires_at: Date;
  uploaded_at: Date | null;
  processed_at: Date | null;
  safe_storage_key: string | null;
  safe_content_type: string | null;
  safe_size_bytes: string | null;
  preview_storage_key: string | null;
  rejection_reason: string | null;
  guest_claim_token_hash: string | null;
  claimed_submission_id: string | null;
};

function safeInteger(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Database integer is outside JavaScript safe range: ${value}`);
  return parsed;
}

function restoreWorkCategory(row: WorkCategoryRow): WorkCategory {
  return WorkCategory.restore({
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    active: row.active,
    selectable: row.selectable,
  });
}

export class PgWorkCategoryRepository implements WorkCategoryRepository {
  readonly #database: PgDatabase;

  constructor(database: PgDatabase) {
    this.#database = database;
  }

  async listActive(): Promise<readonly WorkCategory[]> {
    const result = await this.#database.query<WorkCategoryRow>(
      `SELECT id, parent_id, name, description, sort_order, active, selectable
       FROM work_categories
       WHERE active = true
       ORDER BY sort_order, name, id`,
    );
    return result.rows.map(restoreWorkCategory);
  }

  async findActiveSelectableByIds(ids: readonly string[]): Promise<readonly WorkCategory[]> {
    if (ids.length === 0) return [];
    const result = await this.#database.query<WorkCategoryRow>(
      `SELECT id, parent_id, name, description, sort_order, active, selectable
       FROM work_categories
       WHERE id = ANY($1::text[]) AND active = true AND selectable = true`,
      [ids],
    );
    return result.rows.map(restoreWorkCategory);
  }
}

function restoreRussianLocation(row: RussianLocationRow): RussianLocation {
  return RussianLocation.restore({
    id: row.id,
    kind: row.kind,
    parentId: row.parent_id,
    name: row.name,
    slug: row.slug,
    active: row.active,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
  });
}

export class PgRussianLocationRepository implements RussianLocationRepository {
  readonly #database: PgDatabase;

  constructor(database: PgDatabase) {
    this.#database = database;
  }

  async listActiveRegions(): Promise<readonly RussianLocation[]> {
    const result = await this.#database.query<RussianLocationRow>(
      `SELECT id, kind, parent_id, name, slug, active,
              latitude::text, longitude::text
       FROM russian_locations
       WHERE kind = 'region' AND active = true
       ORDER BY name, id`,
    );
    return result.rows.map(restoreRussianLocation);
  }

  async searchActiveLocalities(search: LocalitySearch): Promise<readonly LocalitySearchItem[]> {
    const result = await this.#database.query<RussianLocalityRow>(
      `SELECT l.id, l.kind, l.parent_id, l.name, l.slug, l.active,
              l.latitude::text, l.longitude::text, r.name AS region_name
       FROM russian_locations l
       JOIN russian_locations r ON r.id = l.parent_id AND r.kind = 'region' AND r.active = true
       WHERE l.kind = 'locality'
         AND l.active = true
         AND ($1 = '' OR l.name ILIKE '%' || $1 || '%')
         AND ($2::text IS NULL OR r.id = $2)
       ORDER BY
         CASE
           WHEN lower(l.name) = lower($1) THEN 0
           WHEN l.name ILIKE $1 || '%' THEN 1
           ELSE 2
         END,
         l.name,
         r.name,
         l.id
       LIMIT $3`,
      [search.query, search.regionId, search.limit],
    );
    return result.rows.map((row) => ({
      location: restoreRussianLocation(row),
      regionName: row.region_name,
    }));
  }

  async findActiveByIds(ids: readonly string[]): Promise<readonly RussianLocation[]> {
    if (ids.length === 0) return [];
    const result = await this.#database.query<RussianLocationRow>(
      `SELECT id, kind, parent_id, name, slug, active,
              latitude::text, longitude::text
       FROM russian_locations
       WHERE id = ANY($1::text[]) AND active = true`,
      [ids],
    );
    return result.rows.map(restoreRussianLocation);
  }
}

export async function persistEvents(
  database: PgDatabase,
  aggregateType: string,
  aggregate: AggregateRoot,
): Promise<void> {
  for (const event of aggregate.pullEvents()) {
    await database.query(
      `INSERT INTO outbox_events
        (id, event_type, aggregate_type, aggregate_id, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [randomUUID(), event.name, aggregateType, event.aggregateId, JSON.stringify(event.payload), event.occurredAt],
    );
  }
}

export class PgAccountRepository implements AccountRepository {
  readonly #database: PgDatabase;

  constructor(database: PgDatabase) {
    this.#database = database;
  }

  async save(account: Account): Promise<void> {
    const snapshot = account.toSnapshot();
    await this.#database.query(
      `INSERT INTO accounts (id, email, status, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email, status = EXCLUDED.status, updated_at = now()`,
      [snapshot.id, snapshot.email, snapshot.status, snapshot.createdAt],
    );
    await this.#database.query("DELETE FROM account_capabilities WHERE account_id = $1", [snapshot.id]);
    for (const capability of snapshot.capabilities) {
      await this.#database.query(
        "INSERT INTO account_capabilities (account_id, capability) VALUES ($1, $2)",
        [snapshot.id, capability],
      );
    }
    await persistEvents(this.#database, "Account", account);
  }

  async findById(
    accountId: string,
    options: Readonly<{ forUpdate?: boolean }> = {},
  ): Promise<Account | null> {
    if (options.forUpdate) {
      this.#database.requireTransaction("Locking an account");
      const locked = await this.#database.query<{ id: string }>(
        "SELECT id FROM accounts WHERE id = $1 FOR UPDATE",
        [accountId],
      );
      if (!locked.rows[0]) return null;
    }
    const result = await this.#database.query<AccountRow>(
      `SELECT a.id, a.email, a.status, a.created_at,
              COALESCE(array_agg(ac.capability) FILTER (WHERE ac.capability IS NOT NULL), '{}') AS capabilities
       FROM accounts a
       LEFT JOIN account_capabilities ac ON ac.account_id = a.id
       WHERE a.id = $1
       GROUP BY a.id`,
      [accountId],
    );
    const row = result.rows[0];
    return row
      ? Account.restore({
          id: row.id,
          email: row.email,
          status: row.status,
          capabilities: row.capabilities,
          createdAt: row.created_at,
        })
      : null;
  }

  async findByEmail(email: Email): Promise<Account | null> {
    if (this.#database.inTransaction) {
      await this.#database.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [email.value]);
    }
    const result = await this.#database.query<AccountRow>(
      `SELECT a.id, a.email, a.status, a.created_at,
              COALESCE(array_agg(ac.capability) FILTER (WHERE ac.capability IS NOT NULL), '{}') AS capabilities
       FROM accounts a
       LEFT JOIN account_capabilities ac ON ac.account_id = a.id
       WHERE lower(a.email) = $1
       GROUP BY a.id`,
      [email.value],
    );
    const row = result.rows[0];
    return row
      ? Account.restore({
          id: row.id,
          email: row.email,
          status: row.status,
          capabilities: row.capabilities,
          createdAt: row.created_at,
        })
      : null;
  }
}

function restoreEmailAuthRequest(row: EmailAuthRequestRow): EmailAuthRequest {
  return EmailAuthRequest.restore({
    id: row.id,
    email: row.email,
    purpose: row.purpose,
    tokenHash: row.token_hash,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    accountId: row.account_id,
  });
}

export class PgEmailAuthRequestRepository implements EmailAuthRequestRepository {
  readonly #database: PgDatabase;

  constructor(database: PgDatabase) {
    this.#database = database;
  }

  async save(request: EmailAuthRequest): Promise<void> {
    const snapshot = request.toSnapshot();
    await this.#database.query(
      `INSERT INTO email_auth_requests (
         id, email, purpose, token_hash, status, created_at, expires_at, consumed_at, account_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         consumed_at = EXCLUDED.consumed_at,
         account_id = EXCLUDED.account_id`,
      [
        snapshot.id,
        snapshot.email,
        snapshot.purpose,
        snapshot.tokenHash,
        snapshot.status,
        snapshot.createdAt,
        snapshot.expiresAt,
        snapshot.consumedAt,
        snapshot.accountId,
      ],
    );
    await persistEvents(this.#database, "EmailAuthRequest", request);
  }

  async findById(requestId: string): Promise<EmailAuthRequest | null> {
    const result = await this.#database.query<EmailAuthRequestRow>(
      "SELECT * FROM email_auth_requests WHERE id = $1",
      [requestId],
    );
    return result.rows[0] ? restoreEmailAuthRequest(result.rows[0]) : null;
  }

  async findByTokenHash(
    tokenHash: string,
    options: Readonly<{ forUpdate?: boolean }> = {},
  ): Promise<EmailAuthRequest | null> {
    if (options.forUpdate) this.#database.requireTransaction("Locking an email authentication request");
    const result = await this.#database.query<EmailAuthRequestRow>(
      `SELECT * FROM email_auth_requests
       WHERE token_hash = $1${options.forUpdate ? " FOR UPDATE" : ""}`,
      [tokenHash],
    );
    return result.rows[0] ? restoreEmailAuthRequest(result.rows[0]) : null;
  }

  async revokePending(email: Email, purpose: EmailAuthPurpose, _occurredAt: Date): Promise<void> {
    await this.#database.query(
      "DELETE FROM email_auth_requests WHERE email = $1 AND purpose = $2 AND status = 'pending'",
      [email.value, purpose],
    );
  }
}

export class PgOrderSubmissionRepository implements OrderSubmissionRepository {
  readonly #database: PgDatabase;

  constructor(database: PgDatabase) {
    this.#database = database;
  }

  async save(submission: OrderSubmission): Promise<void> {
    const snapshot = submission.toSnapshot();
    await this.#database.query(
      `INSERT INTO order_submissions (
         id, email, contact_name, category_id, location_id, title, description,
         budget_min_minor, budget_max_minor, budget_currency, temporary_attachment_ids,
         consent_version, token_hash, status, created_at, expires_at, confirmed_at, account_id, order_id
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11::jsonb,
         $12, $13, $14, $15, $16, $17, $18, $19
       )
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         confirmed_at = EXCLUDED.confirmed_at,
         account_id = EXCLUDED.account_id,
         order_id = EXCLUDED.order_id,
         updated_at = now()`,
      [
        snapshot.id,
        snapshot.email,
        snapshot.contactName,
        snapshot.categoryId,
        snapshot.locationId,
        snapshot.title,
        snapshot.description,
        snapshot.budgetMinMinor,
        snapshot.budgetMaxMinor,
        snapshot.budgetCurrency,
        JSON.stringify(snapshot.temporaryAttachmentIds),
        snapshot.consentVersion,
        snapshot.tokenHash,
        snapshot.status,
        snapshot.createdAt,
        snapshot.expiresAt,
        snapshot.confirmedAt,
        snapshot.accountId,
        snapshot.orderId,
      ],
    );
    await persistEvents(this.#database, "OrderSubmission", submission);
  }

  async findById(submissionId: string): Promise<OrderSubmission | null> {
    const result = await this.#database.query<SubmissionRow>(
      "SELECT * FROM order_submissions WHERE id = $1",
      [submissionId],
    );
    return result.rows[0] ? this.#map(result.rows[0]) : null;
  }

  async findByTokenHash(
    tokenHash: string,
    options: Readonly<{ forUpdate?: boolean }> = {},
  ): Promise<OrderSubmission | null> {
    if (options.forUpdate) this.#database.requireTransaction("Locking an order submission");
    const result = await this.#database.query<SubmissionRow>(
      `SELECT * FROM order_submissions WHERE token_hash = $1${options.forUpdate ? " FOR UPDATE" : ""}`,
      [tokenHash],
    );
    return result.rows[0] ? this.#map(result.rows[0]) : null;
  }

  #map(row: SubmissionRow): OrderSubmission {
    return OrderSubmission.restore({
      id: row.id,
      email: row.email,
      contactName: row.contact_name,
      categoryId: row.category_id,
      locationId: row.location_id,
      title: row.title,
      description: row.description,
      budgetMinMinor: safeInteger(row.budget_min_minor),
      budgetMaxMinor: safeInteger(row.budget_max_minor),
      budgetCurrency: row.budget_currency,
      temporaryAttachmentIds: row.temporary_attachment_ids,
      consentVersion: row.consent_version,
      tokenHash: row.token_hash,
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      confirmedAt: row.confirmed_at,
      accountId: row.account_id,
      orderId: row.order_id,
    });
  }
}

export class PgOrderRepository implements OrderRepository {
  readonly #database: PgDatabase;

  constructor(database: PgDatabase) {
    this.#database = database;
  }

  async save(order: Order): Promise<void> {
    const snapshot = order.toSnapshot();
    await this.#database.query(
      `INSERT INTO orders (
         id, customer_id, category_id, location_id, title, description,
         budget_min_minor, budget_max_minor, budget_currency, attachment_ids,
         status, selected_bid_id, contractor_id, created_at, published_at, completed_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10::jsonb,
         $11, $12, $13, $14, $15, $16
       )
       ON CONFLICT (id) DO UPDATE SET
         category_id = EXCLUDED.category_id,
         location_id = EXCLUDED.location_id,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         budget_min_minor = EXCLUDED.budget_min_minor,
         budget_max_minor = EXCLUDED.budget_max_minor,
         budget_currency = EXCLUDED.budget_currency,
         attachment_ids = EXCLUDED.attachment_ids,
         status = EXCLUDED.status,
         selected_bid_id = EXCLUDED.selected_bid_id,
         contractor_id = EXCLUDED.contractor_id,
         published_at = EXCLUDED.published_at,
         completed_at = EXCLUDED.completed_at,
         updated_at = now()`,
      [
        snapshot.id,
        snapshot.customerId,
        snapshot.categoryId,
        snapshot.locationId,
        snapshot.title,
        snapshot.description,
        snapshot.budgetMinMinor,
        snapshot.budgetMaxMinor,
        snapshot.budgetCurrency,
        JSON.stringify(snapshot.attachmentIds),
        snapshot.status,
        snapshot.selectedBidId,
        snapshot.contractorId,
        snapshot.createdAt,
        snapshot.publishedAt,
        snapshot.completedAt,
      ],
    );
    await persistEvents(this.#database, "Order", order);
  }

  async findById(
    orderId: string,
    options: Readonly<{ forUpdate?: boolean }> = {},
  ): Promise<Order | null> {
    if (options.forUpdate) this.#database.requireTransaction("Locking an order");
    const result = await this.#database.query<OrderRow>(
      `SELECT * FROM orders WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`,
      [orderId],
    );
    const row = result.rows[0];
    return row
      ? Order.restore({
          id: row.id,
          customerId: row.customer_id,
          categoryId: row.category_id,
          locationId: row.location_id,
          title: row.title,
          description: row.description,
          budgetMinMinor: safeInteger(row.budget_min_minor),
          budgetMaxMinor: safeInteger(row.budget_max_minor),
          budgetCurrency: row.budget_currency,
          attachmentIds: row.attachment_ids,
          status: row.status,
          selectedBidId: row.selected_bid_id,
          contractorId: row.contractor_id,
          createdAt: row.created_at,
          publishedAt: row.published_at,
          completedAt: row.completed_at,
        })
      : null;
  }
}

export class PgCustomerOrderReadRepository implements CustomerOrderReadRepository {
  readonly #database: PgDatabase;

  constructor(database: PgDatabase) {
    this.#database = database;
  }

  async listByCustomer(
    customerId: string,
    pagination: Readonly<{ limit: number; offset: number }>,
  ): Promise<CustomerOrderPage> {
    const [orders, count] = await Promise.all([
      this.#database.query<CustomerOrderListRow>(
        `SELECT id, category_id, location_id, title,
                budget_min_minor, budget_max_minor, budget_currency,
                status, created_at, published_at
         FROM orders
         WHERE customer_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2 OFFSET $3`,
        [customerId, pagination.limit, pagination.offset],
      ),
      this.#database.query<{ total: string }>(
        "SELECT count(*) AS total FROM orders WHERE customer_id = $1",
        [customerId],
      ),
    ]);

    const items: CustomerOrderListItem[] = orders.rows.map((row) => ({
      id: row.id,
      categoryId: row.category_id,
      locationId: row.location_id,
      title: row.title,
      budgetMinMinor: safeInteger(row.budget_min_minor),
      budgetMaxMinor: safeInteger(row.budget_max_minor),
      budgetCurrency: row.budget_currency,
      status: row.status,
      createdAt: row.created_at,
      publishedAt: row.published_at,
    }));
    return {
      items,
      total: safeInteger(count.rows[0]?.total ?? "0") as number,
      limit: pagination.limit,
      offset: pagination.offset,
    };
  }
}

function restoreBid(row: BidRow): Bid {
  return Bid.restore({
    id: row.id,
    orderId: row.order_id,
    contractorId: row.contractor_id,
    message: row.message,
    priceMinMinor: safeInteger(row.price_min_minor),
    priceMaxMinor: safeInteger(row.price_max_minor),
    priceCurrency: row.price_currency,
    durationDaysMin: row.duration_days_min,
    durationDaysMax: row.duration_days_max,
    visibility: row.visibility,
    status: row.status,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
  });
}

export class PgBidRepository implements BidRepository {
  readonly #database: PgDatabase;

  constructor(database: PgDatabase) {
    this.#database = database;
  }

  async save(bid: Bid): Promise<void> {
    const snapshot = bid.toSnapshot();
    await this.#database.query(
      `INSERT INTO bids (
         id, order_id, contractor_id, message,
         price_min_minor, price_max_minor, price_currency,
         duration_days_min, duration_days_max, visibility,
         status, submitted_at, decided_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         decided_at = EXCLUDED.decided_at,
         updated_at = now()`,
      [
        snapshot.id,
        snapshot.orderId,
        snapshot.contractorId,
        snapshot.message,
        snapshot.priceMinMinor,
        snapshot.priceMaxMinor,
        snapshot.priceCurrency,
        snapshot.durationDaysMin,
        snapshot.durationDaysMax,
        snapshot.visibility,
        snapshot.status,
        snapshot.submittedAt,
        snapshot.decidedAt,
      ],
    );
    await persistEvents(this.#database, "Bid", bid);
  }

  async findById(
    bidId: string,
    options: Readonly<{ forUpdate?: boolean }> = {},
  ): Promise<Bid | null> {
    if (options.forUpdate) this.#database.requireTransaction("Locking a bid");
    const result = await this.#database.query<BidRow>(
      `SELECT * FROM bids WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`,
      [bidId],
    );
    return result.rows[0] ? restoreBid(result.rows[0]) : null;
  }

  async findActiveByOrderAndContractor(orderId: string, contractorId: string): Promise<Bid | null> {
    const result = await this.#database.query<BidRow>(
      `SELECT * FROM bids
       WHERE order_id = $1 AND contractor_id = $2
         AND status IN ('submitted', 'selected')`,
      [orderId, contractorId],
    );
    return result.rows[0] ? restoreBid(result.rows[0]) : null;
  }

  async findSubmittedByOrder(
    orderId: string,
    options: Readonly<{ forUpdate?: boolean }> = {},
  ): Promise<readonly Bid[]> {
    if (options.forUpdate) this.#database.requireTransaction("Locking order bids");
    const result = await this.#database.query<BidRow>(
      `SELECT * FROM bids
       WHERE order_id = $1 AND status = 'submitted'
       ORDER BY submitted_at, id${options.forUpdate ? " FOR UPDATE" : ""}`,
      [orderId],
    );
    return result.rows.map(restoreBid);
  }
}

function mapBidListItem(row: BidListRow): BidListItem {
  return {
    id: row.id,
    orderId: row.order_id,
    orderTitle: row.order_title,
    contractorId: row.contractor_id,
    message: row.message,
    priceMinMinor: safeInteger(row.price_min_minor),
    priceMaxMinor: safeInteger(row.price_max_minor),
    priceCurrency: row.price_currency,
    durationDaysMin: row.duration_days_min,
    durationDaysMax: row.duration_days_max,
    visibility: row.visibility,
    status: row.status,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
  };
}

export class PgMarketplaceReadRepository implements MarketplaceReadRepository {
  readonly #database: PgDatabase;

  constructor(database: PgDatabase) {
    this.#database = database;
  }

  async listPublishedOrders(input: PublicOrderSearch): Promise<Page<PublicOrderListItem>> {
    const conditions = ["o.status = 'published'", "EXISTS (SELECT 1 FROM accounts owner WHERE owner.id = o.customer_id AND owner.status = 'active')"];
    const filterValues: unknown[] = [];
    let searchQueryPosition: number | null = null;
    if (input.query) {
      filterValues.push(input.query);
      searchQueryPosition = filterValues.length;
      conditions.push(
        `to_tsvector('russian', coalesce(o.title, '') || ' ' || coalesce(o.description, ''))
         @@ websearch_to_tsquery('russian', $${searchQueryPosition})`,
      );
    }
    if (input.categoryId) {
      filterValues.push(input.categoryId);
      conditions.push(`o.category_id = $${filterValues.length}`);
    }
    if (input.regionId) {
      filterValues.push(input.regionId);
      conditions.push(`r.id = $${filterValues.length}`);
    }
    if (input.locationId) {
      filterValues.push(input.locationId);
      conditions.push(`o.location_id = $${filterValues.length}`);
    }
    if (input.budgetMinMinor !== undefined) {
      filterValues.push(input.budgetMinMinor);
      conditions.push(`COALESCE(o.budget_max_minor, o.budget_min_minor) >= $${filterValues.length}`);
    }
    if (input.budgetMaxMinor !== undefined) {
      filterValues.push(input.budgetMaxMinor);
      conditions.push(`COALESCE(o.budget_min_minor, o.budget_max_minor) <= $${filterValues.length}`);
    }
    const where = conditions.join(" AND ");
    const limitPosition = filterValues.length + 1;
    const offsetPosition = filterValues.length + 2;
    const orderBy = input.sort === "budget_asc"
      ? "COALESCE(o.budget_min_minor, o.budget_max_minor) ASC NULLS LAST, o.published_at DESC, o.id DESC"
      : input.sort === "budget_desc"
        ? "COALESCE(o.budget_max_minor, o.budget_min_minor) DESC NULLS LAST, o.published_at DESC, o.id DESC"
        : input.sort === "popular"
          ? "bid_stats.bid_count DESC, o.published_at DESC, o.id DESC"
          : input.sort === "relevance" && searchQueryPosition !== null
            ? `ts_rank_cd(
                 to_tsvector('russian', coalesce(o.title, '') || ' ' || coalesce(o.description, '')),
                 websearch_to_tsquery('russian', $${searchQueryPosition})
               ) DESC, o.published_at DESC, o.id DESC`
            : "o.published_at DESC, o.id DESC";
    const joins = `
      JOIN work_categories wc ON wc.id = o.category_id
      JOIN russian_locations l ON l.id = o.location_id
      JOIN russian_locations r ON r.id = CASE WHEN l.kind = 'region' THEN l.id ELSE l.parent_id END`;
    const [orders, count] = await Promise.all([
      this.#database.query<PublicOrderListRow>(
        `SELECT o.id, o.category_id, wc.name AS category_name,
                o.location_id, l.name AS location_name,
                r.id AS region_id, r.name AS region_name,
                o.title,
                left(o.description, 300) AS description_preview,
                o.budget_min_minor, o.budget_max_minor, o.budget_currency,
                o.published_at,
                bid_stats.bid_count
         FROM orders o
         ${joins}
         CROSS JOIN LATERAL (
           SELECT count(*) AS bid_count
           FROM bids b
           WHERE b.order_id = o.id AND b.status = 'submitted'
         ) bid_stats
         WHERE ${where}
         ORDER BY ${orderBy}
         LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
        [...filterValues, input.limit, input.offset],
      ),
      this.#database.query<{ total: string }>(
        `SELECT count(*) AS total FROM orders o ${joins} WHERE ${where}`,
        filterValues,
      ),
    ]);
    return {
      items: orders.rows.map((row) => ({
        id: row.id,
        categoryId: row.category_id,
        categoryName: row.category_name,
        locationId: row.location_id,
        locationName: row.location_name,
        regionId: row.region_id,
        regionName: row.region_name,
        title: row.title,
        descriptionPreview: row.description_preview,
        budgetMinMinor: safeInteger(row.budget_min_minor),
        budgetMaxMinor: safeInteger(row.budget_max_minor),
        budgetCurrency: row.budget_currency,
        publishedAt: row.published_at,
        bidCount: safeInteger(row.bid_count) as number,
      })),
      total: safeInteger(count.rows[0]?.total ?? "0") as number,
      limit: input.limit,
      offset: input.offset,
    };
  }

  async findPublishedOrder(orderId: string): Promise<PublicOrderView | null> {
    const result = await this.#database.query<PublicOrderRow>(
      `SELECT o.id, o.category_id, wc.name AS category_name,
              o.location_id, l.name AS location_name,
              r.id AS region_id, r.name AS region_name,
              o.title, o.description,
              o.budget_min_minor, o.budget_max_minor, o.budget_currency,
              o.attachment_ids, o.published_at,
              (SELECT count(*) FROM bids b
               WHERE b.order_id = o.id AND b.status = 'submitted') AS bid_count
       FROM orders o
       JOIN work_categories wc ON wc.id = o.category_id
       JOIN russian_locations l ON l.id = o.location_id
       JOIN russian_locations r ON r.id = CASE WHEN l.kind = 'region' THEN l.id ELSE l.parent_id END
       WHERE o.id = $1 AND o.status = 'published'
         AND EXISTS (SELECT 1 FROM accounts owner WHERE owner.id = o.customer_id AND owner.status = 'active')`,
      [orderId],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          categoryId: row.category_id,
          categoryName: row.category_name,
          locationId: row.location_id,
          locationName: row.location_name,
          regionId: row.region_id,
          regionName: row.region_name,
          title: row.title,
          description: row.description,
          budgetMinMinor: safeInteger(row.budget_min_minor),
          budgetMaxMinor: safeInteger(row.budget_max_minor),
          budgetCurrency: row.budget_currency,
          attachmentIds: row.attachment_ids,
          publishedAt: row.published_at,
          bidCount: safeInteger(row.bid_count) as number,
        }
      : null;
  }

  listOrderBids(
    orderId: string,
    pagination: Readonly<{ limit: number; offset: number }>,
  ): Promise<Page<BidListItem>> {
    return this.#listBids("b.order_id", orderId, pagination);
  }

  listContractorBids(
    contractorId: string,
    pagination: Readonly<{ limit: number; offset: number }>,
  ): Promise<Page<BidListItem>> {
    return this.#listBids("b.contractor_id", contractorId, pagination);
  }

  async #listBids(
    column: "b.order_id" | "b.contractor_id",
    value: string,
    pagination: Readonly<{ limit: number; offset: number }>,
  ): Promise<Page<BidListItem>> {
    const [bids, count] = await Promise.all([
      this.#database.query<BidListRow>(
        `SELECT b.*, o.title AS order_title
         FROM bids b
         JOIN orders o ON o.id = b.order_id
         WHERE ${column} = $1
         ORDER BY b.submitted_at DESC, b.id DESC
         LIMIT $2 OFFSET $3`,
        [value, pagination.limit, pagination.offset],
      ),
      this.#database.query<{ total: string }>(
        `SELECT count(*) AS total FROM bids b WHERE ${column} = $1`,
        [value],
      ),
    ]);
    return {
      items: bids.rows.map(mapBidListItem),
      total: safeInteger(count.rows[0]?.total ?? "0") as number,
      limit: pagination.limit,
      offset: pagination.offset,
    };
  }
}

function restoreReview(row: ReviewRow): Review {
  return Review.restore({
    id: row.id,
    orderId: row.order_id,
    authorId: row.author_id,
    subjectId: row.subject_id,
    score: row.score,
    text: row.text,
    status: row.status,
    createdAt: row.created_at,
  });
}

export class PgReviewRepository implements ReviewRepository {
  readonly #database: PgDatabase;

  constructor(database: PgDatabase) {
    this.#database = database;
  }

  async save(review: Review): Promise<void> {
    const snapshot = review.toSnapshot();
    await this.#database.query(
      `INSERT INTO reviews
         (id, order_id, author_id, subject_id, score, text, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         updated_at = now()`,
      [
        snapshot.id,
        snapshot.orderId,
        snapshot.authorId,
        snapshot.subjectId,
        snapshot.score,
        snapshot.text,
        snapshot.status,
        snapshot.createdAt,
      ],
    );
    await persistEvents(this.#database, "Review", review);
  }

  async findByOrderAndAuthor(orderId: string, authorId: string): Promise<Review | null> {
    const result = await this.#database.query<ReviewRow>(
      "SELECT * FROM reviews WHERE order_id = $1 AND author_id = $2",
      [orderId, authorId],
    );
    return result.rows[0] ? restoreReview(result.rows[0]) : null;
  }
}

export class PgReputationReadRepository implements ReputationReadRepository {
  readonly #database: PgDatabase;

  constructor(database: PgDatabase) {
    this.#database = database;
  }

  async listContractors(search: PublicContractorSearch): Promise<PublicContractorPage> {
    const conditions = ["a.status = 'active'"];
    const filterValues: unknown[] = [];
    let searchQueryPosition: number | null = null;
    if (search.query) {
      filterValues.push(search.query);
      searchQueryPosition = filterValues.length;
      conditions.push(
        `to_tsvector('russian', coalesce(cp.display_name, '') || ' ' || coalesce(cp.bio, ''))
         @@ websearch_to_tsquery('russian', $${searchQueryPosition})`,
      );
    }
    if (search.specializationId) {
      filterValues.push(search.specializationId);
      conditions.push(
        `EXISTS (
           SELECT 1 FROM contractor_profile_specializations cps_filter
           WHERE cps_filter.account_id = cp.account_id
             AND cps_filter.category_id = $${filterValues.length}
         )`,
      );
    }
    if (search.regionId) {
      filterValues.push(search.regionId);
      conditions.push(
        `EXISTS (
           SELECT 1
           FROM contractor_service_areas csa_filter
           JOIN russian_locations rl_filter ON rl_filter.id = csa_filter.location_id
           WHERE csa_filter.account_id = cp.account_id
             AND CASE
               WHEN rl_filter.kind = 'region' THEN rl_filter.id
               ELSE rl_filter.parent_id
             END = $${filterValues.length}
         )`,
      );
    }
    if (search.locationId) {
      filterValues.push(search.locationId);
      conditions.push(
        `EXISTS (
           SELECT 1 FROM contractor_service_areas csa_filter
           WHERE csa_filter.account_id = cp.account_id
             AND csa_filter.location_id = $${filterValues.length}
         )`,
      );
    }
    if (search.minRating !== undefined) {
      filterValues.push(search.minRating);
      conditions.push(`COALESCE(review_stats.rating_average, 0) >= $${filterValues.length}`);
    }
    const where = conditions.join(" AND ");
    const limitPosition = filterValues.length + 1;
    const offsetPosition = filterValues.length + 2;
    const orderBy = search.sort === "completed"
      ? "order_stats.completed_order_count DESC, review_stats.rating_average DESC NULLS LAST, a.id"
      : search.sort === "newest"
        ? "a.created_at DESC, a.id DESC"
        : search.sort === "relevance" && searchQueryPosition !== null
          ? `ts_rank_cd(
               to_tsvector('russian', coalesce(cp.display_name, '') || ' ' || coalesce(cp.bio, '')),
               websearch_to_tsquery('russian', $${searchQueryPosition})
             ) DESC, review_stats.rating_average DESC NULLS LAST, a.id`
          : "review_stats.rating_average DESC NULLS LAST, review_stats.review_count DESC, order_stats.completed_order_count DESC, a.id";
    const from = `
      FROM accounts a
      JOIN account_capabilities ac
        ON ac.account_id = a.id AND ac.capability = 'contractor'
      JOIN contractor_profiles cp ON cp.account_id = a.id
      LEFT JOIN LATERAL (
        SELECT round(avg(r.score)::numeric, 2) AS rating_average, count(*) AS review_count
        FROM reputation_reviews r
        WHERE r.subject_id = a.id AND r.status = 'published'
      ) review_stats ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS completed_order_count
        FROM orders o
        WHERE o.contractor_id = a.id AND o.status = 'completed'
      ) order_stats ON true`;
    const [contractors, count] = await Promise.all([
      this.#database.query<PublicContractorListRow>(
        `SELECT a.id, cp.display_name, left(cp.bio, 300) AS bio_preview,
                cp.avatar_attachment_id, a.created_at AS member_since,
                COALESCE((
                  SELECT array_agg(cps.category_id ORDER BY wc.sort_order, wc.name, wc.id)
                  FROM contractor_profile_specializations cps
                  JOIN work_categories wc ON wc.id = cps.category_id
                  WHERE cps.account_id = cp.account_id
                ), ARRAY[]::text[]) AS specialization_ids,
                COALESCE((
                  SELECT jsonb_agg(
                    jsonb_build_object('id', cps.category_id, 'name', wc.name)
                    ORDER BY wc.sort_order, wc.name, wc.id
                  )
                  FROM contractor_profile_specializations cps
                  JOIN work_categories wc ON wc.id = cps.category_id
                  WHERE cps.account_id = cp.account_id
                ), '[]'::jsonb) AS specializations,
                COALESCE((
                  SELECT array_agg(csa.location_id ORDER BY rl.kind, rl.name, rl.id)
                  FROM contractor_service_areas csa
                  JOIN russian_locations rl ON rl.id = csa.location_id
                  WHERE csa.account_id = cp.account_id
                ), ARRAY[]::text[]) AS service_location_ids,
                COALESCE((
                  SELECT jsonb_agg(
                    jsonb_build_object(
                      'id', csa.location_id,
                      'name', rl.name,
                      'kind', rl.kind,
                      'regionId', region.id,
                      'regionName', region.name
                    ) ORDER BY rl.kind, rl.name, rl.id
                  )
                  FROM contractor_service_areas csa
                  JOIN russian_locations rl ON rl.id = csa.location_id
                  JOIN russian_locations region
                    ON region.id = CASE WHEN rl.kind = 'region' THEN rl.id ELSE rl.parent_id END
                  WHERE csa.account_id = cp.account_id
                ), '[]'::jsonb) AS service_locations,
                review_stats.rating_average::text,
                review_stats.review_count,
                order_stats.completed_order_count
         ${from}
         WHERE ${where}
         ORDER BY ${orderBy}
         LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
        [...filterValues, search.limit, search.offset],
      ),
      this.#database.query<{ total: string }>(
        `SELECT count(*) AS total ${from} WHERE ${where}`,
        filterValues,
      ),
    ]);
    const items: PublicContractorListItem[] = contractors.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      bioPreview: row.bio_preview,
      avatarAttachmentId: row.avatar_attachment_id,
      specializationIds: row.specialization_ids,
      specializations: row.specializations,
      serviceLocationIds: row.service_location_ids,
      serviceLocations: row.service_locations,
      memberSince: row.member_since,
      ratingAverage: row.rating_average === null ? null : Number(row.rating_average),
      reviewCount: safeInteger(row.review_count) as number,
      completedOrderCount: safeInteger(row.completed_order_count) as number,
    }));
    return {
      items,
      total: safeInteger(count.rows[0]?.total ?? "0") as number,
      limit: search.limit,
      offset: search.offset,
    };
  }

  async findContractorProfile(contractorId: string): Promise<PublicContractorProfile | null> {
    const result = await this.#database.query<ContractorProfileRow>(
      `SELECT a.id, a.created_at,
              cp.display_name, cp.bio, cp.avatar_attachment_id,
              COALESCE((
                SELECT array_agg(cps.category_id ORDER BY wc.sort_order, wc.name, wc.id)
                FROM contractor_profile_specializations cps
                JOIN work_categories wc ON wc.id = cps.category_id
                WHERE cps.account_id = cp.account_id
              ), ARRAY[]::text[]) AS specialization_ids,
              COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object('id', cps.category_id, 'name', wc.name)
                  ORDER BY wc.sort_order, wc.name, wc.id
                )
                FROM contractor_profile_specializations cps
                JOIN work_categories wc ON wc.id = cps.category_id
                WHERE cps.account_id = cp.account_id
              ), '[]'::jsonb) AS specializations,
              COALESCE((
                SELECT array_agg(csa.location_id ORDER BY rl.kind, rl.name, rl.id)
                FROM contractor_service_areas csa
                JOIN russian_locations rl ON rl.id = csa.location_id
                WHERE csa.account_id = cp.account_id
              ), ARRAY[]::text[]) AS service_location_ids,
              COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', csa.location_id,
                    'name', rl.name,
                    'kind', rl.kind,
                    'regionId', region.id,
                    'regionName', region.name
                  ) ORDER BY rl.kind, rl.name, rl.id
                )
                FROM contractor_service_areas csa
                JOIN russian_locations rl ON rl.id = csa.location_id
                JOIN russian_locations region
                  ON region.id = CASE WHEN rl.kind = 'region' THEN rl.id ELSE rl.parent_id END
                WHERE csa.account_id = cp.account_id
              ), '[]'::jsonb) AS service_locations,
              cp.portfolio,
              (SELECT round(avg(r.score)::numeric, 2)::text
               FROM reputation_reviews r
               WHERE r.subject_id = a.id AND r.status = 'published') AS rating_average,
              (SELECT count(*) FROM reputation_reviews r
               WHERE r.subject_id = a.id AND r.status = 'published') AS review_count,
              (SELECT count(*) FROM orders o
               WHERE o.contractor_id = a.id AND o.status = 'completed') AS completed_order_count
       FROM accounts a
       JOIN account_capabilities ac
         ON ac.account_id = a.id AND ac.capability = 'contractor'
       LEFT JOIN contractor_profiles cp ON cp.account_id = a.id
       WHERE a.id = $1 AND a.status = 'active'`,
      [contractorId],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          displayName: row.display_name,
          bio: row.bio ?? "",
          avatarAttachmentId: row.avatar_attachment_id,
          specializationIds: row.specialization_ids ?? [],
          specializations: row.specializations ?? [],
          serviceLocationIds: row.service_location_ids ?? [],
          serviceLocations: row.service_locations ?? [],
          portfolio: row.portfolio ?? [],
          memberSince: row.created_at,
          ratingAverage: row.rating_average === null ? null : Number(row.rating_average),
          reviewCount: safeInteger(row.review_count) as number,
          completedOrderCount: safeInteger(row.completed_order_count) as number,
        }
      : null;
  }

  async listPublishedReviews(
    contractorId: string,
    pagination: Readonly<{ limit: number; offset: number }>,
  ): Promise<PublicReviewPage> {
    const [reviews, count] = await Promise.all([
      this.#database.query<PublicReviewRow>(
        `SELECT r.*, o.title AS order_title
         FROM reputation_reviews r
         LEFT JOIN orders o ON o.id = r.order_id
         WHERE r.subject_id = $1 AND r.status = 'published'
         ORDER BY r.created_at DESC, r.id DESC, r.origin DESC
         LIMIT $2 OFFSET $3`,
        [contractorId, pagination.limit, pagination.offset],
      ),
      this.#database.query<{ total: string }>(
        "SELECT count(*) AS total FROM reputation_reviews WHERE subject_id = $1 AND status = 'published'",
        [contractorId],
      ),
    ]);
    const items: PublicReviewListItem[] = reviews.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      orderTitle: row.order_title,
      authorId: row.author_id,
      score: row.score,
      text: row.text,
      createdAt: row.created_at,
    }));
    return {
      items,
      total: safeInteger(count.rows[0]?.total ?? "0") as number,
      limit: pagination.limit,
      offset: pagination.offset,
    };
  }
}

export class PgContractorProfileRepository implements ContractorProfileRepository {
  readonly #database: PgDatabase;

  constructor(database: PgDatabase) {
    this.#database = database;
  }

  async save(profile: ContractorProfileAggregate): Promise<void> {
    this.#database.requireTransaction("Saving a contractor profile");
    const snapshot = profile.toSnapshot();
    await this.#database.query(
      `INSERT INTO contractor_profiles (
         account_id, display_name, bio, avatar_attachment_id, portfolio, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (account_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         bio = EXCLUDED.bio,
         avatar_attachment_id = EXCLUDED.avatar_attachment_id,
         portfolio = EXCLUDED.portfolio,
         updated_at = EXCLUDED.updated_at`,
      [
        snapshot.accountId,
        snapshot.displayName,
        snapshot.bio,
        snapshot.avatarAttachmentId,
        JSON.stringify(snapshot.portfolio),
        snapshot.createdAt,
        snapshot.updatedAt,
      ],
    );
    await this.#database.query(
      "DELETE FROM contractor_profile_specializations WHERE account_id = $1",
      [snapshot.accountId],
    );
    if (snapshot.specializationIds.length > 0) {
      await this.#database.query(
        `INSERT INTO contractor_profile_specializations (account_id, category_id)
         SELECT $1, category_id
         FROM unnest($2::text[]) AS category_id`,
        [snapshot.accountId, snapshot.specializationIds],
      );
    }
    await this.#database.query(
      "DELETE FROM contractor_service_areas WHERE account_id = $1",
      [snapshot.accountId],
    );
    if (snapshot.serviceLocationIds.length > 0) {
      await this.#database.query(
        `INSERT INTO contractor_service_areas (account_id, location_id)
         SELECT $1, location_id
         FROM unnest($2::text[]) AS location_id`,
        [snapshot.accountId, snapshot.serviceLocationIds],
      );
    }
    await persistEvents(this.#database, "ContractorProfile", profile);
  }

  async findByAccountId(
    accountId: string,
    options: Readonly<{ forUpdate?: boolean }> = {},
  ): Promise<ContractorProfileAggregate | null> {
    if (options.forUpdate) this.#database.requireTransaction("Locking a contractor profile");
    const result = await this.#database.query<StoredContractorProfileWithSelectionsRow>(
      `SELECT cp.*,
              COALESCE((
                SELECT array_agg(cps.category_id ORDER BY wc.sort_order, wc.name, wc.id)
                FROM contractor_profile_specializations cps
                JOIN work_categories wc ON wc.id = cps.category_id
                WHERE cps.account_id = cp.account_id
              ), ARRAY[]::text[]) AS specialization_ids,
              COALESCE((
                SELECT array_agg(csa.location_id ORDER BY rl.kind, rl.name, rl.id)
                FROM contractor_service_areas csa
                JOIN russian_locations rl ON rl.id = csa.location_id
                WHERE csa.account_id = cp.account_id
              ), ARRAY[]::text[]) AS service_location_ids
       FROM contractor_profiles cp
       WHERE cp.account_id = $1${options.forUpdate ? " FOR UPDATE OF cp" : ""}`,
      [accountId],
    );
    const row = result.rows[0];
    return row
      ? ContractorProfileAggregate.restore({
          accountId: row.account_id,
          displayName: row.display_name,
          bio: row.bio,
          avatarAttachmentId: row.avatar_attachment_id,
          specializationIds: row.specialization_ids,
          serviceLocationIds: row.service_location_ids,
          portfolio: row.portfolio,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })
      : null;
  }
}

function restoreAttachment(row: AttachmentRow): Attachment {
  return Attachment.restore({
    id: row.id,
    ownerId: row.owner_id,
    purpose: row.purpose,
    originalFileName: row.original_file_name,
    contentType: row.content_type,
    sizeBytes: safeInteger(row.size_bytes) as number,
    storageKey: row.storage_key,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    uploadedAt: row.uploaded_at,
    processedAt: row.processed_at,
    safeStorageKey: row.safe_storage_key,
    safeContentType: row.safe_content_type,
    safeSizeBytes: safeInteger(row.safe_size_bytes),
    previewStorageKey: row.preview_storage_key,
    rejectionReason: row.rejection_reason,
    guestClaimTokenHash: row.guest_claim_token_hash,
    claimedSubmissionId: row.claimed_submission_id,
  });
}

// All statuses count: draft and cancelled orders retain their files too.
const attachmentReferenceSql = `
  EXISTS (SELECT 1 FROM contractor_profiles cp WHERE cp.avatar_attachment_id = a.id::text)
  OR EXISTS (SELECT 1 FROM contractor_profiles cp
    CROSS JOIN LATERAL jsonb_array_elements(cp.portfolio) item(value)
    CROSS JOIN LATERAL jsonb_array_elements_text(item.value->'attachmentIds') media(value)
    WHERE media.value = a.id::text)
  OR EXISTS (SELECT 1 FROM orders o
    CROSS JOIN LATERAL jsonb_array_elements_text(o.attachment_ids) media(value)
    WHERE media.value = a.id::text)`;
const managedAccountAttachmentSql = `a.owner_id IS NOT NULL AND
  (a.storage_key = 'attachments/' || a.owner_id::text || '/' || a.id::text
   OR a.storage_key = 'guest-attachments/' || a.id::text)`;

export class PgAttachmentRepository implements AttachmentRepository {
  readonly #database: PgDatabase;

  constructor(database: PgDatabase) {
    this.#database = database;
  }

  async save(attachment: Attachment): Promise<void> {
    const snapshot = attachment.toSnapshot();
    await this.#database.query(
      `INSERT INTO attachments (
         id, owner_id, purpose, original_file_name, content_type,
         size_bytes, storage_key, status, created_at, expires_at, uploaded_at,
         processed_at, safe_storage_key, safe_content_type, safe_size_bytes,
         preview_storage_key, rejection_reason, guest_claim_token_hash, claimed_submission_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (id) DO UPDATE SET
         owner_id = EXCLUDED.owner_id,
         status = EXCLUDED.status,
         uploaded_at = EXCLUDED.uploaded_at,
         processed_at = EXCLUDED.processed_at,
         safe_storage_key = EXCLUDED.safe_storage_key,
         safe_content_type = EXCLUDED.safe_content_type,
         safe_size_bytes = EXCLUDED.safe_size_bytes,
         preview_storage_key = EXCLUDED.preview_storage_key,
         rejection_reason = EXCLUDED.rejection_reason,
         guest_claim_token_hash = EXCLUDED.guest_claim_token_hash,
         claimed_submission_id = EXCLUDED.claimed_submission_id,
         updated_at = now()`,
      [
        snapshot.id,
        snapshot.ownerId,
        snapshot.purpose,
        snapshot.originalFileName,
        snapshot.contentType,
        snapshot.sizeBytes,
        snapshot.storageKey,
        snapshot.status,
        snapshot.createdAt,
        snapshot.expiresAt,
        snapshot.uploadedAt,
        snapshot.processedAt,
        snapshot.safeStorageKey,
        snapshot.safeContentType,
        snapshot.safeSizeBytes,
        snapshot.previewStorageKey,
        snapshot.rejectionReason,
        snapshot.guestClaimTokenHash,
        snapshot.claimedSubmissionId,
      ],
    );
    await persistEvents(this.#database, "Attachment", attachment);
  }

  async findById(
    attachmentId: string,
    options: Readonly<{ forUpdate?: boolean }> = {},
  ): Promise<Attachment | null> {
    if (options.forUpdate) this.#database.requireTransaction("Locking an attachment");
    const result = await this.#database.query<AttachmentRow>(
      `SELECT * FROM attachments WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`,
      [attachmentId],
    );
    return result.rows[0] ? restoreAttachment(result.rows[0]) : null;
  }

  async findByIds(attachmentIds: readonly string[], options: Readonly<{ forUpdate?: boolean }> = {}): Promise<readonly Attachment[]> {
    if (attachmentIds.length === 0) return [];
    if (options.forUpdate) this.#database.requireTransaction("Locking attachment usage");
    const result = await this.#database.query<AttachmentRow>(
      `SELECT * FROM attachments WHERE id = ANY($1::uuid[]) ORDER BY id${options.forUpdate ? " FOR UPDATE" : ""}`,
      [attachmentIds],
    );
    if (options.forUpdate) await this.#database.query(
      "UPDATE attachments SET unreferenced_since = NULL WHERE id = ANY($1::uuid[])", [attachmentIds],
    );
    return result.rows.map(restoreAttachment);
  }

  async isReferenced(attachmentId: string): Promise<boolean> {
    const result = await this.#database.query<{referenced: boolean}>(
      `SELECT (${attachmentReferenceSql}) AS referenced FROM attachments a WHERE a.id = $1`, [attachmentId],
    );
    return result.rows[0]?.referenced ?? false;
  }

  async observeUnreferenced(now: Date, limit: number): Promise<void> {
    this.#database.requireTransaction("Observing unused account attachments");
    const result = await this.#database.query<{id: string}>(
      `SELECT a.id FROM attachments a WHERE ${managedAccountAttachmentSql}
       AND a.unreferenced_since IS NULL AND a.expires_at < $1
       AND a.status <> 'cleanup_pending' AND NOT (${attachmentReferenceSql})
       ORDER BY a.expires_at, a.id FOR UPDATE OF a SKIP LOCKED LIMIT $2`, [now, limit],
    );
    for (const row of result.rows) {
      // New READ COMMITTED snapshot AFTER acquiring the attachment lock.
      if (!await this.isReferenced(row.id)) await this.#database.query(
        "UPDATE attachments SET unreferenced_since = $2 WHERE id = $1", [row.id, now],
      );
    }
  }

  async findCandidates(cutoff: Date, limit: number): Promise<readonly Attachment[]> {
    this.#database.requireTransaction("Locking unused account attachments");
    const result = await this.#database.query<AttachmentRow>(
      `SELECT a.* FROM attachments a WHERE ${managedAccountAttachmentSql}
       AND (a.status = 'cleanup_pending' OR a.unreferenced_since < $1)
       AND NOT (${attachmentReferenceSql})
       ORDER BY a.unreferenced_since, a.id FOR UPDATE OF a SKIP LOCKED LIMIT $2`, [cutoff, limit],
    );
    return result.rows.map(restoreAttachment);
  }

  async isPubliclyReferenced(attachmentId: string): Promise<boolean> {
    const result = await this.#database.query<{ referenced: boolean }>(
      `SELECT (
         EXISTS (
           SELECT 1 FROM contractor_profiles cp
           WHERE cp.avatar_attachment_id = $1::text
         )
         OR EXISTS (
           SELECT 1
           FROM contractor_profiles cp
           CROSS JOIN LATERAL jsonb_array_elements(cp.portfolio) AS item(value)
           CROSS JOIN LATERAL jsonb_array_elements_text(item.value->'attachmentIds') AS media(value)
           WHERE media.value = $1::text
         )
         OR EXISTS (
           SELECT 1
           FROM orders o
           CROSS JOIN LATERAL jsonb_array_elements_text(o.attachment_ids) AS media(value)
           WHERE o.status IN ('published', 'in_progress', 'completed')
             AND media.value = $1::text
         )
       ) AND EXISTS (
         SELECT 1 FROM attachments a JOIN accounts owner ON owner.id = a.owner_id
         WHERE a.id = $1::uuid AND owner.status = 'active'
       ) AS referenced`,
      [attachmentId],
    );
    return result.rows[0]?.referenced ?? false;
  }

  async findGuestCleanupCandidates(cutoff: Date, limit: number): Promise<readonly Attachment[]> {
    this.#database.requireTransaction("Claiming guest attachments for cleanup");
    const result = await this.#database.query<AttachmentRow>(
      `SELECT *
       FROM attachments
       WHERE purpose = 'guest_order'
         AND owner_id IS NULL
         AND claimed_submission_id IS NULL
         AND (
           status = 'cleanup_pending'
           OR (status IN ('pending_upload', 'processing', 'ready', 'rejected') AND expires_at < $1)
         )
       ORDER BY expires_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT $2`,
      [cutoff, limit],
    );
    return result.rows.map(restoreAttachment);
  }

  async deleteCleanupPending(attachmentId: string): Promise<void> {
    await this.#database.query(
      "DELETE FROM attachments WHERE id = $1 AND status = 'cleanup_pending'",
      [attachmentId],
    );
  }
}
