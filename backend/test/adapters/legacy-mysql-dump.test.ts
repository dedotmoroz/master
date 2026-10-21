import assert from "node:assert/strict";
import test from "node:test";
import { readMysqlDump } from "../../scripts/legacy/mysql-dump.ts";

test("legacy reader handles multi-row INSERT, comments, SQL escapes and exact numeric strings", () => {
  const tables = readMysqlDump("-- header\nCREATE TABLE `empty` (`id` int);\n" +
    "INSERT INTO `sample` (`id`, `text`, `optional`) VALUES\n" +
    "(9007199254740993, 'x; -- not comment, (nested) \\'quoted\\' \\n \\\\', NULL)," +
    "(2, 'it''s /* text */', 123.45); /* ignored */");
  assert.deepEqual(tables.get("empty"), []);
  assert.deepEqual(tables.get("sample"), [
    { id: "9007199254740993", text: "x; -- not comment, (nested) 'quoted' \n \\", optional: null },
    { id: "2", text: "it's /* text */", optional: "123.45" },
  ]);
});

test("legacy reader fails on malformed and unsupported input without exposing values", () => {
  for (const sql of ["INSERT INTO `t` (`x`) VALUES (private_secret);", "INSERT INTO `t` (`x`) SELECT 1;",
    "INSERT INTO `t` (`x`) VALUES ('private_secret', 2);", "INSERT INTO `t` (`x`) VALUES ('private_secret);"]) {
    assert.throws(() => readMysqlDump(sql), (error: unknown) => error instanceof Error && !error.message.includes("private_secret"));
  }
});
