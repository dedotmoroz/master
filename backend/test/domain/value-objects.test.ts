import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../../src/shared/domain/domain-error.ts";
import { Email, Money, MoneyRange } from "../../src/shared/domain/value-objects.ts";

test("Email normalizes case and surrounding whitespace", () => {
  assert.equal(Email.create("  User@Example.COM ").value, "user@example.com");
});

test("Email rejects malformed input", () => {
  assert.throws(() => Email.create("not-an-email"), (error: unknown) => {
    assert.ok(error instanceof DomainError);
    assert.equal(error.code, "INVALID_EMAIL");
    return true;
  });
});

test("Money uses integer minor units and rejects float amounts", () => {
  assert.equal(Money.fromMinor(12_345).minor, 12_345);
  assert.throws(() => Money.fromMinor(12.34), /integer minor units/u);
});

test("MoneyRange rejects reversed bounds", () => {
  assert.throws(
    () => MoneyRange.create(Money.fromMinor(20_000), Money.fromMinor(10_000)),
    /Minimum amount exceeds maximum amount/u,
  );
});
