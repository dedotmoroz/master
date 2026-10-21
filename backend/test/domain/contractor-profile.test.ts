import assert from "node:assert/strict";
import test from "node:test";
import { ContractorProfile } from "../../src/modules/contractors/domain/contractor-profile.ts";
import { DomainError } from "../../src/shared/domain/domain-error.ts";

const now = new Date("2026-01-01T10:00:00.000Z");
const details = {
  displayName: "  Бригада Мастер  ",
  bio: "  Строим загородные дома под ключ.  ",
  avatarAttachmentId: "avatar-1",
  specializationIds: ["category-house", "category-roof"],
  serviceLocationIds: ["moscow-region"],
  portfolio: [{
    title: "  Дом в Истре  ",
    description: "  Построен за четыре месяца.  ",
    attachmentIds: ["photo-1", "photo-2"],
  }],
} as const;

test("ContractorProfile normalizes public details and records creation", () => {
  const profile = ContractorProfile.create("contractor-1", details, now);
  const snapshot = profile.toSnapshot();

  assert.equal(snapshot.displayName, "Бригада Мастер");
  assert.equal(snapshot.bio, "Строим загородные дома под ключ.");
  assert.equal(snapshot.portfolio[0]?.title, "Дом в Истре");
  assert.deepEqual(profile.pullEvents().map((event) => event.name), ["ContractorProfileCreated"]);
});

test("ContractorProfile update is idempotent for equivalent details", () => {
  const profile = ContractorProfile.create("contractor-1", details, now);
  profile.pullEvents();

  profile.update(details, new Date("2026-01-02T10:00:00.000Z"));
  assert.equal(profile.pullEvents().length, 0);

  profile.update(
    { ...details, displayName: "Мастера Москвы" },
    new Date("2026-01-03T10:00:00.000Z"),
  );
  assert.equal(profile.toSnapshot().displayName, "Мастера Москвы");
  assert.deepEqual(profile.pullEvents().map((event) => event.name), ["ContractorProfileUpdated"]);
});

test("ContractorProfile preserves up to 50 legacy specializations instead of silently discarding them", () => {
  const ids = Array.from({ length: 50 }, (_, i) => `category-${i}`);
  assert.equal(ContractorProfile.create("contractor-1", { ...details, specializationIds: ids }, now).toSnapshot().specializationIds.length, 50);
  assert.throws(() => ContractorProfile.create("contractor-1", { ...details, specializationIds: [...ids, "category-extra"] }, now),
    (error: unknown) => error instanceof DomainError && error.code === "TOO_MANY_ITEMS");
});

test("ContractorProfile rejects duplicate specializations and empty portfolio media", () => {
  assert.throws(
    () => ContractorProfile.create("contractor-1", {
      ...details,
      specializationIds: ["category-house", "category-house"],
    }, now),
    (error: unknown) => error instanceof DomainError && error.code === "DUPLICATE_ITEMS",
  );
  assert.throws(
    () => ContractorProfile.create("contractor-1", {
      ...details,
      portfolio: [{ title: "Объект", description: "", attachmentIds: [] }],
    }, now),
    (error: unknown) => error instanceof DomainError && error.code === "PORTFOLIO_ATTACHMENTS_REQUIRED",
  );
});
