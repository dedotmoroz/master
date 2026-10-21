import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkCategory,
  buildWorkCategoryTree,
} from "../../src/modules/catalog/domain/work-category.ts";
import { DomainError } from "../../src/shared/domain/domain-error.ts";

function category(input: Readonly<{
  id: string;
  parentId?: string | null;
  name?: string;
  sortOrder?: number;
  active?: boolean;
  selectable?: boolean;
}>): WorkCategory {
  return WorkCategory.restore({
    id: input.id,
    parentId: input.parentId ?? null,
    name: input.name ?? input.id,
    description: "",
    sortOrder: input.sortOrder ?? 0,
    active: input.active ?? true,
    selectable: input.selectable ?? true,
  });
}

test("buildWorkCategoryTree builds and sorts a hierarchy", () => {
  const tree = buildWorkCategoryTree([
    category({ id: "tiling", parentId: "renovation", name: "Плитка", sortOrder: 20 }),
    category({ id: "construction", name: "Строительство", sortOrder: 20, selectable: false }),
    category({ id: "renovation", name: "Ремонт", sortOrder: 10, selectable: false }),
    category({ id: "painting", parentId: "renovation", name: "Малярные работы", sortOrder: 10 }),
  ]);

  assert.deepEqual(tree.map((item) => item.id), ["renovation", "construction"]);
  assert.deepEqual(tree[0]?.children.map((item) => item.id), ["painting", "tiling"]);
  assert.equal(tree[0]?.selectable, false);
});

test("work category cannot reference itself as parent", () => {
  assert.throws(
    () => category({ id: "construction", parentId: "construction" }),
    (error: unknown) => error instanceof DomainError && error.code === "CATEGORY_SELF_PARENT",
  );
});

test("category tree rejects missing parents and cycles", () => {
  assert.throws(
    () => buildWorkCategoryTree([category({ id: "tiling", parentId: "missing" })]),
    (error: unknown) => error instanceof DomainError && error.code === "CATEGORY_PARENT_NOT_FOUND",
  );
  assert.throws(
    () => buildWorkCategoryTree([
      category({ id: "one", parentId: "two" }),
      category({ id: "two", parentId: "one" }),
    ]),
    (error: unknown) => error instanceof DomainError && error.code === "CATEGORY_CYCLE",
  );
});
