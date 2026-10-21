import { assertDomain } from "../../../shared/domain/domain-error.ts";
import { assertEntityId } from "../../../shared/domain/value-objects.ts";
import type { RussianLocationSnapshot } from "../domain/russian-location.ts";
import type {
  RussianLocationRepository,
  RussianLocationSelectionPolicy,
} from "./ports/russian-location-ports.ts";

export type RussianRegionView = RussianLocationSnapshot;

export type RussianLocalityView = RussianLocationSnapshot & Readonly<{
  regionName: string;
}>;

export class ListRussianRegionsHandler {
  readonly #locations: RussianLocationRepository;

  constructor(locations: RussianLocationRepository) {
    this.#locations = locations;
  }

  async execute(): Promise<readonly RussianRegionView[]> {
    return (await this.#locations.listActiveRegions()).map((location) => location.toSnapshot());
  }
}

export class SearchRussianLocalitiesHandler {
  readonly #locations: RussianLocationRepository;

  constructor(locations: RussianLocationRepository) {
    this.#locations = locations;
  }

  async execute(input: Readonly<{
    query?: string;
    regionId?: string;
    limit?: number;
  }>): Promise<readonly RussianLocalityView[]> {
    const query = input.query?.trim() ?? "";
    const regionId = input.regionId ? assertEntityId(input.regionId, "regionId") : null;
    const limit = input.limit ?? 20;
    assertDomain(
      query.length >= 2 || regionId !== null,
      "LOCATION_SEARCH_TOO_BROAD",
      "Specify at least two search characters or a region",
    );
    assertDomain(
      Number.isSafeInteger(limit) && limit >= 1 && limit <= 50,
      "INVALID_PAGE_SIZE",
      "Location search limit must be between 1 and 50",
    );

    return (await this.#locations.searchActiveLocalities({ query, regionId, limit })).map((item) => ({
      ...item.location.toSnapshot(),
      regionName: item.regionName,
    }));
  }
}

export class ActiveRussianLocationSelectionPolicy implements RussianLocationSelectionPolicy {
  readonly #locations: RussianLocationRepository;

  constructor(locations: RussianLocationRepository) {
    this.#locations = locations;
  }

  async assertSelectable(locationIds: readonly string[]): Promise<void> {
    const normalized = locationIds.map((id) => assertEntityId(id, "locationId"));
    assertDomain(
      new Set(normalized).size === normalized.length,
      "DUPLICATE_ITEMS",
      "locationIds contains duplicates",
      { field: "locationIds" },
    );
    if (normalized.length === 0) return;

    const found = await this.#locations.findActiveByIds(normalized);
    const foundIds = new Set(found.map((location) => location.id));
    const invalidIds = normalized.filter((id) => !foundIds.has(id));
    assertDomain(
      invalidIds.length === 0,
      "RUSSIAN_LOCATION_NOT_FOUND",
      "One or more Russian locations do not exist or are inactive",
      { locationIds: invalidIds },
    );
  }
}
