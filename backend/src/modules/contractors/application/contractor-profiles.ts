import { assertDomain } from "../../../shared/domain/domain-error.ts";
import type {
  AccountRepository,
  Clock,
  TransactionManager,
} from "../../marketplace/application/ports/guest-order-ports.ts";
import {
  ContractorProfile,
  type ContractorProfileDetails,
  type ContractorProfileSnapshot,
} from "../domain/contractor-profile.ts";
import type { ContractorProfileRepository } from "./ports/contractor-profile-ports.ts";
import type { AttachmentUsagePolicy } from "../../attachments/application/ports/attachment-ports.ts";
import type { WorkCategorySelectionPolicy } from "../../catalog/application/ports/work-category-ports.ts";
import type { RussianLocationSelectionPolicy } from "../../geography/application/ports/russian-location-ports.ts";

export type UpsertContractorProfileCommand = ContractorProfileDetails & Readonly<{
  accountId: string;
}>;

export class UpsertContractorProfileHandler {
  readonly #accounts: AccountRepository;
  readonly #profiles: ContractorProfileRepository;
  readonly #clock: Clock;
  readonly #transactions: TransactionManager;
  readonly #attachments: AttachmentUsagePolicy;
  readonly #categories: WorkCategorySelectionPolicy;
  readonly #locations: RussianLocationSelectionPolicy;

  constructor(dependencies: Readonly<{
    accounts: AccountRepository;
    profiles: ContractorProfileRepository;
    clock: Clock;
    transactions: TransactionManager;
    attachments: AttachmentUsagePolicy;
    categories: WorkCategorySelectionPolicy;
    locations: RussianLocationSelectionPolicy;
  }>) {
    this.#accounts = dependencies.accounts;
    this.#profiles = dependencies.profiles;
    this.#clock = dependencies.clock;
    this.#transactions = dependencies.transactions;
    this.#attachments = dependencies.attachments;
    this.#categories = dependencies.categories;
    this.#locations = dependencies.locations;
  }

  execute(command: UpsertContractorProfileCommand): Promise<ContractorProfileSnapshot> {
    return this.#transactions.execute(async () => {
      const account = await this.#accounts.findById(command.accountId, { forUpdate: true });
      assertDomain(account !== null && account.status === "active", "ACCOUNT_NOT_ACTIVE", "Account is not active");
      await this.#categories.assertSelectable(command.specializationIds);
      await this.#locations.assertSelectable(command.serviceLocationIds);
      const existing = await this.#profiles.findByAccountId(command.accountId, { forUpdate: true });
      await this.#attachments.assertUsable(
        account.id,
        command.avatarAttachmentId === null ? [] : [command.avatarAttachmentId],
        "profile_avatar",
      );
      await this.#attachments.assertUsable(
        account.id,
        command.portfolio.flatMap((item) => item.attachmentIds),
        "portfolio",
      );
      const now = this.#clock.now();
      const details: ContractorProfileDetails = {
        displayName: command.displayName,
        bio: command.bio,
        avatarAttachmentId: command.avatarAttachmentId,
        specializationIds: command.specializationIds,
        serviceLocationIds: command.serviceLocationIds,
        portfolio: command.portfolio,
      };
      const profile = existing ?? ContractorProfile.create(account.id, details, now);
      if (existing) profile.update(details, now);
      account.grantCapability("contractor", now);
      await this.#accounts.save(account);
      await this.#profiles.save(profile);
      return profile.toSnapshot();
    });
  }
}

export class GetOwnContractorProfileHandler {
  readonly #profiles: ContractorProfileRepository;

  constructor(profiles: ContractorProfileRepository) {
    this.#profiles = profiles;
  }

  async execute(accountId: string): Promise<ContractorProfileSnapshot> {
    const profile = await this.#profiles.findByAccountId(accountId);
    assertDomain(profile !== null, "CONTRACTOR_PROFILE_NOT_FOUND", "Contractor profile was not found");
    return profile.toSnapshot();
  }
}
