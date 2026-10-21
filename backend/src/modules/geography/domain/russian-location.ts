import { assertDomain } from "../../../shared/domain/domain-error.ts";
import { assertEntityId, assertNonBlank } from "../../../shared/domain/value-objects.ts";

export type RussianLocationKind = "region" | "locality";

export type RussianLocationSnapshot = Readonly<{
  id: string;
  kind: RussianLocationKind;
  parentId: string | null;
  name: string;
  slug: string;
  active: boolean;
  latitude: number | null;
  longitude: number | null;
}>;

const SLUG_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u;

export class RussianLocation {
  readonly id: string;
  readonly kind: RussianLocationKind;
  readonly parentId: string | null;
  readonly name: string;
  readonly slug: string;
  readonly active: boolean;
  readonly latitude: number | null;
  readonly longitude: number | null;

  private constructor(snapshot: RussianLocationSnapshot) {
    this.id = assertEntityId(snapshot.id, "locationId");
    this.kind = snapshot.kind;
    this.parentId = snapshot.parentId === null ? null : assertEntityId(snapshot.parentId, "parentLocationId");
    this.name = assertNonBlank(snapshot.name, "locationName", 160);
    this.slug = assertNonBlank(snapshot.slug, "locationSlug", 160).toLowerCase();
    this.active = snapshot.active;
    this.latitude = snapshot.latitude;
    this.longitude = snapshot.longitude;

    assertDomain(SLUG_PATTERN.test(this.slug), "INVALID_LOCATION_SLUG", "Location slug is invalid");
    assertDomain(
      (this.kind === "region" && this.parentId === null)
        || (this.kind === "locality" && this.parentId !== null),
      "INVALID_LOCATION_HIERARCHY",
      "A region must be a root and a locality must belong to a region",
    );
    assertDomain(
      this.latitude === null || (Number.isFinite(this.latitude) && this.latitude >= -90 && this.latitude <= 90),
      "INVALID_LATITUDE",
      "Latitude is invalid",
    );
    assertDomain(
      this.longitude === null || (Number.isFinite(this.longitude) && this.longitude >= -180 && this.longitude <= 180),
      "INVALID_LONGITUDE",
      "Longitude is invalid",
    );
    assertDomain(
      (this.latitude === null) === (this.longitude === null),
      "INCOMPLETE_COORDINATES",
      "Latitude and longitude must be specified together",
    );
  }

  static restore(snapshot: RussianLocationSnapshot): RussianLocation {
    return new RussianLocation(snapshot);
  }

  toSnapshot(): RussianLocationSnapshot {
    return {
      id: this.id,
      kind: this.kind,
      parentId: this.parentId,
      name: this.name,
      slug: this.slug,
      active: this.active,
      latitude: this.latitude,
      longitude: this.longitude,
    };
  }
}
