import assert from "node:assert/strict";
import test from "node:test";
import type { WorkCategoryRepository } from "../../src/modules/catalog/application/ports/work-category-ports.ts";
import {
  ActiveWorkCategorySelectionPolicy,
  ListWorkCategoriesHandler,
} from "../../src/modules/catalog/application/work-categories.ts";
import { WorkCategory } from "../../src/modules/catalog/domain/work-category.ts";
import { DomainError } from "../../src/shared/domain/domain-error.ts";

const categories = [
  WorkCategory.restore({
    id: "renovation",
    parentId: null,
    name: "Ремонт",
    description: "",
    sortOrder: 10,
    active: true,
    selectable: false,
  }),
  WorkCategory.restore({
    id: "tiling",
    parentId: "renovation",
    name: "Укладка плитки",
    description: "",
    sortOrder: 10,
    active: true,
    selectable: true,
  }),
  WorkCategory.restore({
    id: "old-category",
    parentId: "renovation",
    name: "Архивная категория",
    description: "",
    sortOrder: 20,
    active: false,
    selectable: true,
  }),
] as const;

class MemoryCategories implements WorkCategoryRepository {
  async listActive(): Promise<readonly WorkCategory[]> {
    return categories.filter((category) => category.active);
  }

  async findActiveSelectableByIds(ids: readonly string[]): Promise<readonly WorkCategory[]> {
    return categories.filter((category) => ids.includes(category.id) && category.canBeSelected());
  }
}

test("ListWorkCategories returns only the active category tree", async () => {
  const tree = await new ListWorkCategoriesHandler(new MemoryCategories()).execute();
  assert.equal(tree.length, 1);
  assert.deepEqual(tree[0]?.children.map((item) => item.id), ["tiling"]);
});

test("category selection accepts leaves and rejects groups, inactive and unknown IDs", async () => {
  const policy = new ActiveWorkCategorySelectionPolicy(new MemoryCategories());
  await policy.assertSelectable(["tiling"]);

  for (const id of ["renovation", "old-category", "missing"]) {
    await assert.rejects(
      policy.assertSelectable([id]),
      (error: unknown) => error instanceof DomainError
        && error.code === "WORK_CATEGORY_NOT_SELECTABLE"
        && JSON.stringify(error.details.categoryIds) === JSON.stringify([id]),
    );
  }
});
