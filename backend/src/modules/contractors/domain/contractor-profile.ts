import { AggregateRoot } from "../../../shared/domain/domain-event.ts";
import { assertDomain } from "../../../shared/domain/domain-error.ts";
import { assertEntityId, assertNonBlank } from "../../../shared/domain/value-objects.ts";

export type PortfolioItem = Readonly<{
  title: string;
  description: string;
  attachmentIds: readonly string[];
}>;

export type ContractorProfileDetails = Readonly<{
  displayName: string;
  bio: string;
  avatarAttachmentId: string | null;
  specializationIds: readonly string[];
  serviceLocationIds: readonly string[];
  portfolio: readonly PortfolioItem[];
}>;

export type ContractorProfileSnapshot = ContractorProfileDetails & Readonly<{
  accountId: string;
  createdAt: Date;
  updatedAt: Date;
}>;

function optionalText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  assertDomain(normalized.length <= maxLength, "FIELD_TOO_LONG", `${field} is too long`, {
    field,
    maxLength,
  });
  return normalized;
}

function uniqueIds(values: readonly string[], field: string, maxItems: number): readonly string[] {
  assertDomain(values.length <= maxItems, "TOO_MANY_ITEMS", `${field} has too many items`, {
    field,
    maxItems,
  });
  const normalized = values.map((value) => assertEntityId(value, field));
  assertDomain(new Set(normalized).size === normalized.length, "DUPLICATE_ITEMS", `${field} contains duplicates`, {
    field,
  });
  return Object.freeze(normalized);
}

function normalizeDetails(input: ContractorProfileDetails): ContractorProfileDetails {
  assertDomain(input.portfolio.length <= 20, "TOO_MANY_ITEMS", "portfolio has too many items", {
    field: "portfolio",
    maxItems: 20,
  });
  return {
    displayName: assertNonBlank(input.displayName, "displayName", 120),
    bio: optionalText(input.bio, "bio", 5_000),
    avatarAttachmentId: input.avatarAttachmentId === null
      ? null
      : assertEntityId(input.avatarAttachmentId, "avatarAttachmentId"),
    specializationIds: uniqueIds(input.specializationIds, "specializationIds", 50),
    serviceLocationIds: uniqueIds(input.serviceLocationIds, "serviceLocationIds", 50),
    portfolio: Object.freeze(input.portfolio.map((item, index) => {
      const attachmentIds = uniqueIds(item.attachmentIds, `portfolio[${index}].attachmentIds`, 10);
      assertDomain(attachmentIds.length > 0, "PORTFOLIO_ATTACHMENTS_REQUIRED", "A portfolio item needs an attachment");
      return Object.freeze({
        title: assertNonBlank(item.title, `portfolio[${index}].title`, 160),
        description: optionalText(item.description, `portfolio[${index}].description`, 2_000),
        attachmentIds,
      });
    })),
  };
}

function sameDetails(left: ContractorProfileDetails, right: ContractorProfileDetails): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class ContractorProfile extends AggregateRoot {
  readonly accountId: string;
  readonly createdAt: Date;
  #details: ContractorProfileDetails;
  #updatedAt: Date;

  private constructor(snapshot: ContractorProfileSnapshot) {
    super();
    this.accountId = assertEntityId(snapshot.accountId, "accountId");
    this.#details = normalizeDetails(snapshot);
    this.createdAt = new Date(snapshot.createdAt);
    this.#updatedAt = new Date(snapshot.updatedAt);
  }

  static create(
    accountId: string,
    details: ContractorProfileDetails,
    occurredAt: Date,
  ): ContractorProfile {
    const profile = new ContractorProfile({
      accountId,
      ...details,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });
    profile.record({
      name: "ContractorProfileCreated",
      aggregateId: accountId,
      occurredAt,
      payload: {},
    });
    return profile;
  }

  static restore(snapshot: ContractorProfileSnapshot): ContractorProfile {
    return new ContractorProfile(snapshot);
  }

  update(details: ContractorProfileDetails, occurredAt: Date): void {
    const normalized = normalizeDetails(details);
    if (sameDetails(this.#details, normalized)) return;
    this.#details = normalized;
    this.#updatedAt = new Date(occurredAt);
    this.record({
      name: "ContractorProfileUpdated",
      aggregateId: this.accountId,
      occurredAt,
      payload: {},
    });
  }

  toSnapshot(): ContractorProfileSnapshot {
    return {
      accountId: this.accountId,
      displayName: this.#details.displayName,
      bio: this.#details.bio,
      avatarAttachmentId: this.#details.avatarAttachmentId,
      specializationIds: this.#details.specializationIds,
      serviceLocationIds: this.#details.serviceLocationIds,
      portfolio: this.#details.portfolio,
      createdAt: new Date(this.createdAt),
      updatedAt: new Date(this.#updatedAt),
    };
  }
}
