import assert from "node:assert/strict";
import test from "node:test";
import type {
  MarketplaceReadRepository,
  PublicOrderSearch,
} from "../../src/modules/marketplace/application/ports/bid-ports.ts";
import { ListPublicOrdersHandler } from "../../src/modules/marketplace/application/use-cases/marketplace-bids.ts";
import { DomainError } from "../../src/shared/domain/domain-error.ts";

class RecordingMarketplaceReads implements MarketplaceReadRepository {
  search: PublicOrderSearch | null = null;

  async listPublishedOrders(search: PublicOrderSearch) {
    this.search = search;
    return { items: [], total: 0, limit: search.limit, offset: search.offset };
  }

  async findPublishedOrder() { return null; }
  async listOrderBids(_orderId: string, pagination: Readonly<{ limit: number; offset: number }>) {
    return { items: [], total: 0, ...pagination };
  }
  async listContractorBids(_contractorId: string, pagination: Readonly<{ limit: number; offset: number }>) {
    return { items: [], total: 0, ...pagination };
  }
}

test("public order search normalizes text and defaults to relevance", async () => {
  const reads = new RecordingMarketplaceReads();
  await new ListPublicOrdersHandler(reads).execute({
    query: "  ремонт квартиры  ",
    categoryId: "apartment-renovation",
    regionId: "ru-region-1",
    budgetMinMinor: 100_000,
    budgetMaxMinor: 500_000,
    limit: 20,
    offset: 0,
  });

  assert.deepEqual(reads.search, {
    query: "ремонт квартиры",
    categoryId: "apartment-renovation",
    regionId: "ru-region-1",
    budgetMinMinor: 100_000,
    budgetMaxMinor: 500_000,
    sort: "relevance",
    limit: 20,
    offset: 0,
  });
});

test("public order search rejects short text and reversed budget", async () => {
  const handler = new ListPublicOrdersHandler(new RecordingMarketplaceReads());
  assert.throws(
    () => handler.execute({ query: "я", limit: 20, offset: 0 }),
    (error: unknown) => error instanceof DomainError && error.code === "SEARCH_QUERY_TOO_SHORT",
  );
  assert.throws(
    () => handler.execute({ budgetMinMinor: 500, budgetMaxMinor: 100, limit: 20, offset: 0 }),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_BUDGET_FILTER",
  );
});
