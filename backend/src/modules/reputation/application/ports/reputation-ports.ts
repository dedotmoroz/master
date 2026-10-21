import type { Review } from "../../domain/review.ts";
import type { PortfolioItem } from "../../../contractors/domain/contractor-profile.ts";

export type PublicSpecialization = Readonly<{ id: string; name: string }>;

export type PublicServiceLocation = Readonly<{
  id: string;
  name: string;
  kind: "region" | "locality";
  regionId: string;
  regionName: string;
}>;

export interface ReviewRepository {
  save(review: Review): Promise<void>;
  findByOrderAndAuthor(orderId: string, authorId: string): Promise<Review | null>;
}

export type PublicContractorProfile = Readonly<{
  id: string;
  displayName: string | null;
  bio: string;
  avatarAttachmentId: string | null;
  specializationIds: readonly string[];
  specializations: readonly PublicSpecialization[];
  serviceLocationIds: readonly string[];
  serviceLocations: readonly PublicServiceLocation[];
  portfolio: readonly PortfolioItem[];
  memberSince: Date;
  ratingAverage: number | null;
  reviewCount: number;
  completedOrderCount: number;
}>;

export type PublicContractorListItem = Readonly<{
  id: string;
  displayName: string;
  bioPreview: string;
  avatarAttachmentId: string | null;
  specializationIds: readonly string[];
  specializations: readonly PublicSpecialization[];
  serviceLocationIds: readonly string[];
  serviceLocations: readonly PublicServiceLocation[];
  memberSince: Date;
  ratingAverage: number | null;
  reviewCount: number;
  completedOrderCount: number;
}>;

export type PublicContractorSort = "rating" | "completed" | "newest" | "relevance";

export type PublicContractorSearch = Readonly<{
  query?: string;
  specializationId?: string;
  regionId?: string;
  locationId?: string;
  minRating?: number;
  sort: PublicContractorSort;
  limit: number;
  offset: number;
}>;

export type PublicContractorPage = Readonly<{
  items: readonly PublicContractorListItem[];
  total: number;
  limit: number;
  offset: number;
}>;

export type PublicReviewListItem = Readonly<{
  id: string;
  orderId: string | null;
  orderTitle: string | null;
  authorId: string;
  score: number;
  text: string;
  createdAt: Date;
}>;

export type PublicReviewPage = Readonly<{
  items: readonly PublicReviewListItem[];
  total: number;
  limit: number;
  offset: number;
}>;

export interface ReputationReadRepository {
  listContractors(search: PublicContractorSearch): Promise<PublicContractorPage>;
  findContractorProfile(contractorId: string): Promise<PublicContractorProfile | null>;
  listPublishedReviews(
    contractorId: string,
    pagination: Readonly<{ limit: number; offset: number }>,
  ): Promise<PublicReviewPage>;
}
