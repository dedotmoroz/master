import type { Bid, BidStatus, BidVisibility } from "../../domain/bid.ts";

export interface BidRepository {
  save(bid: Bid): Promise<void>;
  findById(
    bidId: string,
    options?: Readonly<{ forUpdate?: boolean }>,
  ): Promise<Bid | null>;
  findActiveByOrderAndContractor(orderId: string, contractorId: string): Promise<Bid | null>;
  findSubmittedByOrder(
    orderId: string,
    options?: Readonly<{ forUpdate?: boolean }>,
  ): Promise<readonly Bid[]>;
}

export type PublicOrderListItem = Readonly<{
  id: string;
  categoryId: string;
  categoryName: string;
  locationId: string;
  locationName: string;
  regionId: string;
  regionName: string;
  title: string;
  descriptionPreview: string;
  budgetMinMinor: number | null;
  budgetMaxMinor: number | null;
  budgetCurrency: string;
  publishedAt: Date;
  bidCount: number;
}>;

export type PublicOrderView = Readonly<{
  id: string;
  categoryId: string;
  categoryName: string;
  locationId: string;
  locationName: string;
  regionId: string;
  regionName: string;
  title: string;
  description: string;
  budgetMinMinor: number | null;
  budgetMaxMinor: number | null;
  budgetCurrency: string;
  attachmentIds: readonly string[];
  publishedAt: Date;
  bidCount: number;
}>;

export type BidListItem = Readonly<{
  id: string;
  orderId: string;
  orderTitle: string;
  contractorId: string;
  message: string;
  priceMinMinor: number | null;
  priceMaxMinor: number | null;
  priceCurrency: string;
  durationDaysMin: number | null;
  durationDaysMax: number | null;
  visibility: BidVisibility;
  status: BidStatus;
  submittedAt: Date;
  decidedAt: Date | null;
}>;

export type Page<T> = Readonly<{
  items: readonly T[];
  total: number;
  limit: number;
  offset: number;
}>;

export type PublicOrderSort = "newest" | "budget_asc" | "budget_desc" | "popular" | "relevance";

export type PublicOrderSearch = Readonly<{
  query?: string;
  categoryId?: string;
  regionId?: string;
  locationId?: string;
  budgetMinMinor?: number;
  budgetMaxMinor?: number;
  sort: PublicOrderSort;
  limit: number;
  offset: number;
}>;

export interface MarketplaceReadRepository {
  listPublishedOrders(input: PublicOrderSearch): Promise<Page<PublicOrderListItem>>;
  findPublishedOrder(orderId: string): Promise<PublicOrderView | null>;
  listOrderBids(
    orderId: string,
    pagination: Readonly<{ limit: number; offset: number }>,
  ): Promise<Page<BidListItem>>;
  listContractorBids(
    contractorId: string,
    pagination: Readonly<{ limit: number; offset: number }>,
  ): Promise<Page<BidListItem>>;
}
