import assert from "node:assert/strict";
import test from "node:test";
import type {
  LocalitySearch,
  RussianLocationRepository,
} from "../../src/modules/geography/application/ports/russian-location-ports.ts";
import {
  ActiveRussianLocationSelectionPolicy,
  ListRussianRegionsHandler,
  SearchRussianLocalitiesHandler,
} from "../../src/modules/geography/application/russian-locations.ts";
import { RussianLocation } from "../../src/modules/geography/domain/russian-location.ts";
import { DomainError } from "../../src/shared/domain/domain-error.ts";

const region = RussianLocation.restore({
  id: "ru-region-43",
  kind: "region",
  parentId: null,
  name: "Московская область",
  slug: "moskovskaya-oblast",
  active: true,
  latitude: null,
  longitude: null,
});

const locality = RussianLocation.restore({
  id: "ru-locality-1",
  kind: "locality",
  parentId: region.id,
  name: "Москва",
  slug: "moskva",
  active: true,
  latitude: 55.7558,
  longitude: 37.6176,
});

class MemoryLocations implements RussianLocationRepository {
  lastSearch: LocalitySearch | null = null;

  async listActiveRegions(): Promise<readonly RussianLocation[]> {
    return [region];
  }

  async searchActiveLocalities(search: LocalitySearch) {
    this.lastSearch = search;
    return [{ location: locality, regionName: region.name }];
  }

  async findActiveByIds(ids: readonly string[]): Promise<readonly RussianLocation[]> {
    return [region, locality].filter((location) => ids.includes(location.id));
  }
}

test("Russian geography handlers expose regions and normalize locality search", async () => {
  const repository = new MemoryLocations();
  const regions = await new ListRussianRegionsHandler(repository).execute();
  const localities = await new SearchRussianLocalitiesHandler(repository).execute({
    query: "  Моск  ",
    regionId: region.id,
  });

  assert.deepEqual(regions.map((item) => item.id), [region.id]);
  assert.deepEqual(repository.lastSearch, { query: "Моск", regionId: region.id, limit: 20 });
  assert.equal(localities[0]?.regionName, region.name);
});

test("locality search requires a query or region and bounds the page size", async () => {
  const handler = new SearchRussianLocalitiesHandler(new MemoryLocations());

  await assert.rejects(
    handler.execute({ query: "М" }),
    (error: unknown) => error instanceof DomainError && error.code === "LOCATION_SEARCH_TOO_BROAD",
  );
  await assert.rejects(
    handler.execute({ regionId: region.id, limit: 51 }),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_PAGE_SIZE",
  );
});

test("location selection accepts active Russian IDs and reports unknown IDs", async () => {
  const policy = new ActiveRussianLocationSelectionPolicy(new MemoryLocations());
  await policy.assertSelectable([region.id, locality.id]);

  await assert.rejects(
    policy.assertSelectable(["ru-locality-missing"]),
    (error: unknown) => error instanceof DomainError
      && error.code === "RUSSIAN_LOCATION_NOT_FOUND"
      && JSON.stringify(error.details.locationIds) === JSON.stringify(["ru-locality-missing"]),
  );
});
