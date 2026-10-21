import assert from "node:assert/strict";
import test from "node:test";
import type { ContractorProfileRepository } from "../../src/modules/contractors/application/ports/contractor-profile-ports.ts";
import {
  GetOwnContractorProfileHandler,
  UpsertContractorProfileHandler,
} from "../../src/modules/contractors/application/contractor-profiles.ts";
import type { ContractorProfile } from "../../src/modules/contractors/domain/contractor-profile.ts";
import type { AttachmentUsagePolicy } from "../../src/modules/attachments/application/ports/attachment-ports.ts";
import { Account } from "../../src/modules/identity/domain/account.ts";
import type {
  AccountRepository,
  Clock,
  TransactionManager,
} from "../../src/modules/marketplace/application/ports/guest-order-ports.ts";
import { DomainError } from "../../src/shared/domain/domain-error.ts";
import { Email } from "../../src/shared/domain/value-objects.ts";
import type { WorkCategorySelectionPolicy } from "../../src/modules/catalog/application/ports/work-category-ports.ts";
import type { RussianLocationSelectionPolicy } from "../../src/modules/geography/application/ports/russian-location-ports.ts";

const now = new Date("2026-01-02T10:00:00.000Z");

class Services implements Clock, TransactionManager {
  now(): Date { return new Date(now); }
  execute<T>(work: () => Promise<T>): Promise<T> { return work(); }
}

class MemoryAccounts implements AccountRepository {
  readonly account: Account | null;
  constructor(account: Account | null) { this.account = account; }
  async save(): Promise<void> {}
  async findById(id: string): Promise<Account | null> {
    return this.account?.id === id ? this.account : null;
  }
  async findByEmail(): Promise<Account | null> { return this.account; }
}

class MemoryProfiles implements ContractorProfileRepository {
  profile: ContractorProfile | null = null;
  locked = false;
  async save(profile: ContractorProfile): Promise<void> { this.profile = profile; }
  async findByAccountId(
    accountId: string,
    options: Readonly<{ forUpdate?: boolean }> = {},
  ): Promise<ContractorProfile | null> {
    this.locked ||= options.forUpdate === true;
    return this.profile?.accountId === accountId ? this.profile : null;
  }
}

const allowAttachments: AttachmentUsagePolicy = {
  assertUsable: async () => undefined,
};

const allowCategories: WorkCategorySelectionPolicy = {
  assertSelectable: async () => undefined,
};

const allowLocations: RussianLocationSelectionPolicy = {
  assertSelectable: async () => undefined,
};

const command = {
  accountId: "contractor-1",
  displayName: "Бригада Мастер",
  bio: "Строим дома под ключ.",
  avatarAttachmentId: null,
  specializationIds: ["house-building"],
  serviceLocationIds: ["moscow-region"],
  portfolio: [{
    title: "Дом в Истре",
    description: "Газобетонный дом.",
    attachmentIds: ["photo-1"],
  }],
} as const;

test("UpsertContractorProfile creates a profile and grants contractor capability", async () => {
  const account = Account.registerVerified(
    "contractor-1",
    Email.create("contractor@example.com"),
    now,
  );
  const profiles = new MemoryProfiles();
  const services = new Services();
  const handler = new UpsertContractorProfileHandler({
    accounts: new MemoryAccounts(account),
    profiles,
    clock: services,
    transactions: services,
    attachments: allowAttachments,
    categories: allowCategories,
    locations: allowLocations,
  });

  const profile = await handler.execute(command);

  assert.equal(profile.displayName, "Бригада Мастер");
  assert.equal(account.hasCapability("contractor"), true);
  assert.equal(profiles.locked, true);
  assert.equal((await new GetOwnContractorProfileHandler(profiles).execute(account.id)).accountId, account.id);
});

test("UpsertContractorProfile rejects a missing or inactive account", async () => {
  const services = new Services();
  const handler = new UpsertContractorProfileHandler({
    accounts: new MemoryAccounts(null),
    profiles: new MemoryProfiles(),
    clock: services,
    transactions: services,
    attachments: allowAttachments,
    categories: allowCategories,
    locations: allowLocations,
  });

  await assert.rejects(
    handler.execute(command),
    (error: unknown) => error instanceof DomainError && error.code === "ACCOUNT_NOT_ACTIVE",
  );
});

test("GetOwnContractorProfile returns 404 semantics when no profile exists", async () => {
  await assert.rejects(
    new GetOwnContractorProfileHandler(new MemoryProfiles()).execute("contractor-1"),
    (error: unknown) => error instanceof DomainError && error.code === "CONTRACTOR_PROFILE_NOT_FOUND",
  );
});
