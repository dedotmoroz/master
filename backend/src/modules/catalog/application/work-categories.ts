import { assertDomain } from "../../../shared/domain/domain-error.ts";
import { assertEntityId } from "../../../shared/domain/value-objects.ts";
import { buildWorkCategoryTree, type WorkCategoryTreeNode } from "../domain/work-category.ts";
import type {
  WorkCategoryRepository,
  WorkCategorySelectionPolicy,
} from "./ports/work-category-ports.ts";

export class ListWorkCategoriesHandler {
  readonly #categories: WorkCategoryRepository;

  constructor(categories: WorkCategoryRepository) {
    this.#categories = categories;
  }

  async execute(): Promise<readonly WorkCategoryTreeNode[]> {
    return buildWorkCategoryTree(await this.#categories.listActive());
  }
}

export class ActiveWorkCategorySelectionPolicy implements WorkCategorySelectionPolicy {
  readonly #categories: WorkCategoryRepository;

  constructor(categories: WorkCategoryRepository) {
    this.#categories = categories;
  }

  async assertSelectable(categoryIds: readonly string[]): Promise<void> {
    const normalized = categoryIds.map((id) => assertEntityId(id, "categoryId"));
    assertDomain(
      new Set(normalized).size === normalized.length,
      "DUPLICATE_ITEMS",
      "categoryIds contains duplicates",
      { field: "categoryIds" },
    );
    if (normalized.length === 0) return;

    const found = await this.#categories.findActiveSelectableByIds(normalized);
    const foundIds = new Set(found.map((category) => category.id));
    const invalidIds = normalized.filter((id) => !foundIds.has(id));
    assertDomain(
      invalidIds.length === 0,
      "WORK_CATEGORY_NOT_SELECTABLE",
      "One or more work categories do not exist or cannot be selected",
      { categoryIds: invalidIds },
    );
  }
}
