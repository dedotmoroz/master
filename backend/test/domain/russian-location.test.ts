import assert from "node:assert/strict";
import test from "node:test";
import { RussianLocation } from "../../src/modules/geography/domain/russian-location.ts";
import { DomainError } from "../../src/shared/domain/domain-error.ts";

test("RussianLocation restores a region and a locality", () => {
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

  assert.equal(region.parentId, null);
  assert.equal(locality.parentId, region.id);
  assert.equal(locality.toSnapshot().latitude, 55.7558);
});

test("RussianLocation enforces hierarchy and complete coordinates", () => {
  assert.throws(
    () => RussianLocation.restore({
      id: "ru-locality-1",
      kind: "locality",
      parentId: null,
      name: "Москва",
      slug: "moskva",
      active: true,
      latitude: null,
      longitude: null,
    }),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_LOCATION_HIERARCHY",
  );

  assert.throws(
    () => RussianLocation.restore({
      id: "ru-region-43",
      kind: "region",
      parentId: null,
      name: "Московская область",
      slug: "moskovskaya-oblast",
      active: true,
      latitude: 55.7,
      longitude: null,
    }),
    (error: unknown) => error instanceof DomainError && error.code === "INCOMPLETE_COORDINATES",
  );
});
