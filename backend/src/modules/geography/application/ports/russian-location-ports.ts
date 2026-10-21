import type { RussianLocation } from "../../domain/russian-location.ts";

export type LocalitySearch = Readonly<{
  query: string;
  regionId: string | null;
  limit: number;
}>;

export type LocalitySearchItem = Readonly<{
  location: RussianLocation;
  regionName: string;
}>;

export interface RussianLocationRepository {
  listActiveRegions(): Promise<readonly RussianLocation[]>;
  searchActiveLocalities(search: LocalitySearch): Promise<readonly LocalitySearchItem[]>;
  findActiveByIds(ids: readonly string[]): Promise<readonly RussianLocation[]>;
}

export interface RussianLocationSelectionPolicy {
  assertSelectable(locationIds: readonly string[]): Promise<void>;
}
