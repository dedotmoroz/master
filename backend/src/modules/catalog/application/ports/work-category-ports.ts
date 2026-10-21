import type { WorkCategory } from "../../domain/work-category.ts";

export interface WorkCategoryRepository {
  listActive(): Promise<readonly WorkCategory[]>;
  findActiveSelectableByIds(ids: readonly string[]): Promise<readonly WorkCategory[]>;
}

export interface WorkCategorySelectionPolicy {
  assertSelectable(categoryIds: readonly string[]): Promise<void>;
}
