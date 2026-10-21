import { assertDomain } from "../../../shared/domain/domain-error.ts";
import { assertEntityId, assertNonBlank } from "../../../shared/domain/value-objects.ts";

export type WorkCategorySnapshot = Readonly<{
  id: string;
  parentId: string | null;
  name: string;
  description: string;
  sortOrder: number;
  active: boolean;
  selectable: boolean;
}>;

export type WorkCategoryTreeNode = WorkCategorySnapshot & Readonly<{
  children: readonly WorkCategoryTreeNode[];
}>;

export class WorkCategory {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly description: string;
  readonly sortOrder: number;
  readonly active: boolean;
  readonly selectable: boolean;

  private constructor(snapshot: WorkCategorySnapshot) {
    this.id = assertEntityId(snapshot.id, "categoryId");
    this.parentId = snapshot.parentId === null
      ? null
      : assertEntityId(snapshot.parentId, "parentCategoryId");
    assertDomain(this.parentId !== this.id, "CATEGORY_SELF_PARENT", "A category cannot be its own parent");
    this.name = assertNonBlank(snapshot.name, "categoryName", 160);
    this.description = snapshot.description.trim();
    assertDomain(this.description.length <= 2_000, "FIELD_TOO_LONG", "categoryDescription is too long", {
      field: "categoryDescription",
      maxLength: 2_000,
    });
    assertDomain(
      Number.isSafeInteger(snapshot.sortOrder) && snapshot.sortOrder >= 0,
      "INVALID_CATEGORY_SORT_ORDER",
      "Category sort order must be a non-negative integer",
    );
    this.sortOrder = snapshot.sortOrder;
    this.active = snapshot.active;
    this.selectable = snapshot.selectable;
  }

  static restore(snapshot: WorkCategorySnapshot): WorkCategory {
    return new WorkCategory(snapshot);
  }

  canBeSelected(): boolean {
    return this.active && this.selectable;
  }

  toSnapshot(): WorkCategorySnapshot {
    return {
      id: this.id,
      parentId: this.parentId,
      name: this.name,
      description: this.description,
      sortOrder: this.sortOrder,
      active: this.active,
      selectable: this.selectable,
    };
  }
}

function compareCategories(left: WorkCategory, right: WorkCategory): number {
  return left.sortOrder - right.sortOrder
    || left.name.localeCompare(right.name, "ru")
    || left.id.localeCompare(right.id);
}

export function buildWorkCategoryTree(categories: readonly WorkCategory[]): readonly WorkCategoryTreeNode[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  assertDomain(byId.size === categories.length, "DUPLICATE_CATEGORY", "Category identifiers must be unique");

  for (const category of categories) {
    assertDomain(
      category.parentId === null || byId.has(category.parentId),
      "CATEGORY_PARENT_NOT_FOUND",
      "Category parent was not found",
      { categoryId: category.id, parentId: category.parentId },
    );
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const assertAcyclic = (category: WorkCategory): void => {
    if (visited.has(category.id)) return;
    assertDomain(!visiting.has(category.id), "CATEGORY_CYCLE", "Category hierarchy contains a cycle", {
      categoryId: category.id,
    });
    visiting.add(category.id);
    if (category.parentId !== null) assertAcyclic(byId.get(category.parentId)!);
    visiting.delete(category.id);
    visited.add(category.id);
  };
  categories.forEach(assertAcyclic);

  const children = new Map<string | null, WorkCategory[]>();
  for (const category of categories) {
    const siblings = children.get(category.parentId) ?? [];
    siblings.push(category);
    children.set(category.parentId, siblings);
  }

  const makeNode = (category: WorkCategory): WorkCategoryTreeNode => Object.freeze({
    ...category.toSnapshot(),
    children: Object.freeze((children.get(category.id) ?? []).sort(compareCategories).map(makeNode)),
  });

  return Object.freeze((children.get(null) ?? []).sort(compareCategories).map(makeNode));
}
