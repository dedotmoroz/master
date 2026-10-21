import type { ContractorProfile } from "../../domain/contractor-profile.ts";

export interface ContractorProfileRepository {
  save(profile: ContractorProfile): Promise<void>;
  findByAccountId(
    accountId: string,
    options?: Readonly<{ forUpdate?: boolean }>,
  ): Promise<ContractorProfile | null>;
}
