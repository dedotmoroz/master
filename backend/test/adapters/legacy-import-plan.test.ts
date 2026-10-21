import assert from "node:assert/strict";
import test from "node:test";
import { legacyId, minorUnits, legacyText } from "../../scripts/legacy/import-plan.ts";

test("legacy identifiers are stable and table-scoped; decimals never use float rounding", () => {
  assert.equal(legacyId("sed_users", "1"), legacyId("sed_users", "1"));
  assert.notEqual(legacyId("sed_users", "1"), legacyId("sed_projects", "1"));
  assert.equal(minorUnits("123.45"), 12345);
  assert.equal(minorUnits("0.01"), 1);
  assert.equal(minorUnits("0"), null);
  assert.equal(minorUnits(null), null);
  assert.throws(() => minorUnits("1.234"), /INVALID_DECIMAL/);
  assert.throws(() => minorUnits("-1"), /INVALID_DECIMAL/);
  assert.equal(legacyText("<p>Text<br>Next</p>"), "Text\nNext");
});
